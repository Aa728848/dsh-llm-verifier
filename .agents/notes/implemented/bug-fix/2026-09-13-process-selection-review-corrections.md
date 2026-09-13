# Agent Note: 过程选优与阶段评审的复核修正（P06/P02/P04 缺陷批次）

Status: implemented

修订：2026-09-13。本批次针对一轮离线复核中**已复现**的六项实现缺陷与一项方案偏离逐条修正。真机评测、0.1.5 目标发行版验证与并发/图片回放证明不在本批次范围内。

## Problem

上一轮交付的 P01–P06 通过了发布门禁，但用离线假模型复核后仍存在下列可复现问题；它们都不会被现有测试捕获，因为当时的断言只覆盖 happy path：

1. **过程选优缺少发送前脱敏。** `renderCandidateView` 的输出直接进入 `verifier.compare`，没有经过 `sanitizeVerifierText`。候选回复里能被默认规则遮盖的模拟密钥原样进入了裁判提示词——脱敏只发生在决策快照落盘时，为时已晚。
2. **裁判看到的动作与宿主执行的动作不一致。** `renderCandidateView` 对工具参数按字符硬截断；备选胜出后宿主却拿到**完整**参数。裁判评的是一个永远不会被执行的中间版本。同时"总量上限"没有被真正执行：把 `autoRouteMaxItemChars`/`autoRouteMaxInputChars` 配成 1000 一档时，实际发出的证据仍有 2682 字符，因为任务本身不参与分摊。
3. **关闭开关或取消后仍可能购买备选。** `handle` 只在进入时读一次设置；父信号在阶段开始前已 abort 时也不会被处理（监听器挂在已派发的事件上），在途周期没有任何取消句柄。复现：原回复完成前关闭开关或取消，选择器仍生成备选、比较并返回 `candidate-selected`。
4. **故障恢复比较缺关键上下文。** `taskStatement` 只返回 `extractSession` 的 `problem`，丢掉了提取出的执行轨迹；原请求的 `system` 约束与 `tools` 定义也没有进入比较视图。裁判看不到"最近两次失败"与约束，无法判断下一步是否针对真实失败。
5. **新增失败路径再次丢失用量。** 生成流报出 123 个输入 token 后抛错，记录写成全零；真实引擎两次裁判成功、第三次失败时，过程行只剩生成的 10 个输入 token，裁判已知的 20 个与 `judgeCalls` 一起丢失。`drainAlternative` 的 chunk 数组是局部的，`partialStats(error)` 没有被合并。
6. **换位后的诊断指向错误候选。** `compare` 的奇数轮交换了 A/B 槽位并把**分数**映射回调用方，但 `diagnostics.evidence` 没有映射：原候选 A 的缺陷被报告成 evidence B。`select` 跨对局聚合时也没有把内部槽位转换为原候选身份。
7. **方案偏离：过程额度。** 计划要求"每任务最多 1 个过程周期，并受现有任务/会话路由额度共同限制"；实现却另设了独立的 `maxProcessPerSession = 1`。复现：同一会话的第二个任务无论路由额度是否空闲都买不到过程选优。

## Decision

**1. 比较视图统一脱敏（`buildProcessView`）**

`ProcessSelectorDeps` 新增 `sanitize(text, maxChars)`（`index.ts` 注入 `sanitizeVerifierText`），任务、上下文、候选文字与**每一条动作**都先脱敏再进提示词。脱敏发生在**计量之前**，因此被遮盖的凭证既不会进入提示词，也不会让预算估算失真。回放仍然不经过任何改写：模型原文里的敏感串只会出现在宿主自己的回复里。

**2. 有界视图：动作原子 + 实测总量**

- 候选预算用 `router.ts` 的 `itemBudget()` 从 `maxInputChars - (task + context)` 里分摊（该函数改为导出）。
- `renderCandidateView(candidate, budget)` 现在返回 `string | undefined`：动作块放不进预算就返回 `undefined`，**绝不截断动作**；只有正文（不会被宿主执行的部分）可以截断并带省略标记。
- 动作的脱敏上限取 `maxItemChars + 1`：被脱敏截断过的动作必然长于单项上限，因此不可能伪装成完整动作混进预算。
- 总量按**渲染后的字符串**实测；task+context 超总预算、任一候选动作放不下、或最后总长仍超预算时，整个周期回退原回复并记 `view-over-budget`，`error` 带上具体字符数与是哪一侧。

**3. 每个决策点重读活状态 + 在途周期可取消**

- `ProcessSelector` 新增 `cycles: Map<sessionId, AbortController>`；`clear(sessionId)`（`agent/disposed`）与 `clearAll()`（任何设置变更）都会 abort 在途周期。`handle` 把父 `options.signal` 链到阶段控制器，并在父信号**已经** abort 时显式补一次 `linkAbort()`（已派发的事件不会再触发）。
- 新增 `staleReason(intent, phase)`：购买前、生成后、比较后各查一次，依次回报 `canceled` / `switch-off` / `task-changed`；命中就 `fail` 预约、回放原回复，并把这些原因写成过程行的 `outcome`。提交前的那次检查就是"回放前"的检查；一旦提交并记账，胜者按整条流回放，不在半途切换。

**4. 过程证据包**

`taskStatement` 改为返回 `{ problem, evidence }`（`evidence` = `extractSession` 的 `trace`，含触发本次周期的失败运行）。`handle` 另外带上原请求的 `system`（约束）与 `renderToolDigest(options.tools)`（工具名、参数名与一行描述）。四段合成 `CONTEXT` 块，由 `buildPairwisePrompt` 的 `PairwisePromptOptions.context` 渲染：与 `TASK`/`PROPOSAL_A`/`PROPOSAL_B` 共用同一个内容派生 nonce；**省略或空白时逐位保持历史提示词**（既有缓存不失效）。`diagnostics` 只承认 `TASK`/`A`/`B`，`CONTEXT` 不进可引用集合。

**5. 失败行保留已发生的用量**

- `drainAlternative(source, cap, chunks)` 的 chunk 数组由调用方持有：生成流在抛出前报出的 usage 现在会进入 `generation-failed` 行，并标 `usageIncomplete`（真实调度已发生、后续未知）。
- 比较失败时用 `engine.ts` 的 `partialStats(error)` 合并裁判错误携带的累计用量，并把 `partial.calls` 记进 `judgeCalls`/`observation.judgeCalls`；没有 partial 时标 `usageIncomplete`，而不是报 0。

**6. 诊断的候选身份跟着分数一起映射**

- `core.ts` 新增 `swapDiagnosticEvidence()`；`compare` 的换位轮在映射分数的同一处映射 evidence。
- `select` 在 `recordPair` 聚合前用 `locatePairDiagnostic(diagnostic, a, b)` 把内部槽位改写成 `candidate N`（1 基，与自动反馈里的 `[N]` 同序）。

**7. 过程额度回到计划口径**

- `RouterPolicy` 删除 `maxProcessPerSession`，`RouterState` 删除 `sessionProcessAttempts`；`index.ts` 的 `MAX_PROCESS_PER_SESSION` 一并删除。
- `reserve` 对 `process` 仍用每任务 1 次的 `processAttempts`，但会话边界改用**共享的路由额度**（`routeAttempts`/`sessionRouteAttempts`），并在准入时同时递增它们——一个过程周期就是一次路由周期。于是"每任务一次"与"受既有路由额度约束"同时成立，同一会话的第二个任务可以购买自己的周期（新任务重置每任务计数，会话路由额度仍然记账）。

**文档同步**：README（配置表、过程选优章节、定位诊断章节）、AGENTS（预算条目、P06 四条、P04 诊断条目）、`client-i18n.ts` 中英帮助文案。

## Alternatives considered

1. **只在写决策快照前脱敏（维持原状）。** 不采用。快照是给人看的副本；提示词才是数据外流面。规则 11 说的是"发送给裁判的一切"。
2. **保留动作硬截断，但把"已截断"标注给裁判。** 不采用。裁判无法据此还原真实动作，评分仍然基于伪造内容；回退原回复是唯一不会误导的选项，代价只是这个周期不选优。
3. **对任务与候选各用固定 `maxItemChars` 上限（不共享总预算）。** 不采用。那正是复现中 2682 > 1000 的成因；规则 4 明确要求按 `itemBudget()` 分摊并保持 Σ items ≤ 总上限。
4. **把约束/证据/工具定义塞进 `problem` 字符串（不改 `core.ts`）。** 不采用。任务块会被约束文字淹没，且无法保证每段都走分隔块与同一个 nonce；给 `PairwisePromptOptions` 加可选 `context` 只多几行，且省略时逐位兼容。
5. **在设置变更时只清意图（维持原状）。** 不采用。已经生成的备选与已经发出的裁判请求不会因为意图被清掉而停止，必须持有在途周期的取消句柄。
6. **包一层 try/catch 猜用量，或在失败后重发一次生成以取得 usage。** 不采用。前者是猜测，后者是真金白银的额外调用；把 chunk 缓冲交回调用方即可零成本保留已知用量。
7. **把 `select` 的 diagnostics 保持 `A`/`B` 并在反馈里附上对应对局。** 不采用。工具返回值是给同一个 Agent 读的，附上对局等于要求它自己重算映射；直接写原候选身份更难误读。
8. **把过程周期改回不消耗路由额度、只加一个更大的会话上限。** 不采用。计划的两条约束是并列的（每任务一次 **且** 受既有路由额度限制），另设上限等于绕开路由额度这条约束。

## Consequences

- 过程行新增 `view-over-budget`/`switch-off`/`task-changed` 三种 `outcome`；`switch-off` 与 `task-changed` 也用于购买前的跳过（`purchased: false`）。
- 一个周期在真实环境里会更常回退：只要任务+约束超出总证据预算，或候选动作放不下，就保留原回复。这是有意的取舍——宁可少选一次，也不拿被截断的动作评分。配置默认值（20000/60000）下常见任务与两三条工具调用都在预算内。
- `process` 周期现在会占用一次路由额度：路由尝试更紧张，但过程周期与路由、最终验收的关系与计划一致；`minFinalModelCalls` 底线未被触碰。
- `PairwisePromptOptions.context` 是通用能力：任何 `compare`/`select` 调用（含 `best_of_n` 之外的自定义编排）都可以传上下文；省略时提示词与缓存键逐位不变，**不需要**升 `cache.ts` 的 `version`（`promptHash` 覆盖渲染后的文本）。
- 测试：`core.test.ts`（context 块、nonce、逐位兼容、`swapDiagnosticEvidence`）、`engine.test.ts`（换位轮诊断映射、锦标赛候选身份）、`router.test.ts`（每任务一次、**同一会话第二个任务可购买**、受路由额度约束）、`process-selection.test.ts`（原子动作、实测总量、脱敏、上下文包、开关关闭/取消/清理在途、生成与裁判失败用量）、`index.test.ts`（真实钩子：第二个任务购买、判官提示词已脱敏且含约束/失败证据/工具定义、胜者原样回放敏感串）。`pnpm run verify:release` 与 `pnpm run typecheck:local` 均通过。
- 仍未完成（与本批次无关，保持记录）：P05 的真实标注样本与四组对照、M0 的目标 0.1.5 发行版真机契约验证、并发双 Agent 串票实测、图片块回放的无损性证明。
