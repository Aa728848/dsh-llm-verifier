# Agent Note: 受控的原生请求级选优（P06 最小实现）

Status: implemented

## Problem

插件此前所有能力都在模型回复**产生之后**：`agent/pre-step` 比较已有的可信候选，停止边界复核进度与交付。
这意味着「候选选择晚于实施」——当一份回复本身就是错的方案时，插件只能复核它、无法改变它。TurboAgent
一类上游通过在 HTTP 代理层保留请求、生成 N 份回复、评审后只回放胜者解决了这个问题。

DSH 已经提供等价的原生拦截点：`llm/stream` waterfall（`(options, next) => AsyncIterable<StreamChunk>`，
`next()` 只应调用一次；prepared-call 与普通派发都汇入同一个 `streamWithRegistration`）。本项交付这个入口的
**最小受控实现**：默认关闭、只处理已定义的故障恢复场景、固定 N=2、每任务一次。

## Decision

新增 `src/process-selection.ts` 并在 `index.ts` 接线，配套一个新配置项 `autoProcessSelection`（默认 `false`）。

**开关与范围**

- 生效条件是 `enabled && autoProcessSelection && autoVerifyMode === 'smart'`；manual/strict 不进入该路径。
- 关闭时**根本不进入代码路径**：无意图、无候选生成、无裁判调用、无响应缓冲。
- 固定 N=2（原回复＝候选 0，新增一份＝候选 1），无 N 的设置项。

**触发与调度**

- 触发唯一：`router.ts` 新增 `inspectRecoverySignal()`，取**最近两次已完成**的验证形状运行
  （`isEvidenceOutput` + `looksLikeVerificationRun` + `EvidenceCall.ok`），两次都失败才成立；任何一次成功都
  断开链条；识别不出（<2 次、输出不像验证运行）一律按未触发处理，**不额外买分类调用**。
- 登记时机：`agent/pre-step` 在尊重 final waterfall 决定、跳过拒绝/取消/新任务/被清空步骤、并**先**处理
  「已有可信候选的早评审」之后，才为下一次真实主请求登记一个意图；已有意图或已购买过周期时不重复登记。
- 绑定时机：`llm/stream` 用 `isAgentLoopRequest(options)`（宿主的主循环标记，模块私有 WeakSet，与宿主同一
  实例）+ `options.sessionId` + 活跃意图三者共同匹配；不匹配就 `return next()`。意图在匹配时即被消费，
  因此不会流入同一会话的第二次请求；TTL、任务变更、设置变更、取消都会使其失效。
- 备选请求由 `buildAlternativeRequest()` 新建：复制有效调用配置（provider/model/messages/system/tools/
  temperature/maxTokens/stop/reasoningEffort）与自己的取消信号，**不复制主循环标记、不带 `sessionId`**，
  因此不会再被本插件拦截，也不冒充主循环请求。

**执行与回放**

- `next()` 恰好调用一次；先缓冲整流原回复（上限 `PROCESS_CANDIDATE_CAP_CHARS` = 1 MiB），再生成备选。
- 原流超限：停止选优，按顺序 flush 已缓冲内容并**继续同一个迭代器**（不 `break`，`for await` 的 break 会
  `return()` 掉下游流），宿主仍拿到一条完整回复。
- 原回复不完整（finish 不是 `stop`/`tool-calls`）、备选失败/超限/不完整、任务读取失败、比较失败、取消、
  阶段超时：**逐块原样回放原回复**，保持宿主自己的失败/重试语义。
- 比较用 `reviewStage: 'proposal'` + P02 的 `PROPOSAL_CRITERIA`（草稿是未经执行的文本），`PROCESS_REPEATS = 2`
  （偶数轮交换 A/B 槽位）；比较视图忽略传输层 callId/usage，只保留文字与「工具名+参数」，两边规范化后相同
  则跳过裁判并记为 `identical-candidate`。
- 只有 `winner === 'B'`（备选胜出）才替换；原胜、并列、相同、失败一律回放原回复。胜者按块原样回放，
  tool-call 的 id/名称/参数、`finish` 的 reason 与 `replayState` 都不改写；未选中的候选一次工具都不执行。
- 生成与比较共用一个 `timeoutMs` 阶段截止时间（不缩短原请求超时，也不靠重发原请求回退）。

**预算、持久化与记账**

- `RoutePhase` 增加内部 `process`，`RouterPolicy` 增加 `maxProcessPerTask`/`maxProcessPerSession`
  （`index.ts` 固定为各 1）：独立计数，不消耗路由尝试，但按 `1 份备选 + 判据数 × 轮次 × 裁判数` 计入同一
  份模型调用预算，并保留最终验收的 `minFinalModelCalls` 底线。
- 话题侧车新增 `verifier/process-selection-v1.json`（`ProcessCycleStore`）：预约后、新增调用前写入开始记录；
  **读不出来就不买**（`lookup().ok === false` 与「已购买」同等处理），写不进去也不买并把已预约的周期
  `fail` 掉；重载后靠这份记录阻止同一任务买第二次。
- 统计把**额外生成 + 裁判**合并成一条行（`verifier_compare`，phase `process`），并把
  `replayed`/`generatedCalls`/`judgeCalls`/`sameCandidate` 记进 `RouteObservation`；
  `cleanRoute`/`cleanVerdict` 是白名单清洗，新字段同步加入。成功比较即 `commit` 并设置
  `finalRequiredFromSeq`——**选优不是验收**，之后的最终验收照常覆盖随后产生的实际工作。

**配置与文档**：`Config`/`resolveConfig`/`config.test.ts`、设置页一行、中英字典两份、README 配置表与
「过程选优」章节、AGENTS 的阶段清单与预算解释全部同步。

## Alternatives considered

1. **直接实现 HTTP 代理（照搬 TurboAgent 的接入方式）。** 不采用。DSH 已有原生 `llm/stream` 契约，
   再加一层 HTTP 服务要处理 API 格式、认证路由与部署；对本宿主没有收益。只有将来需要同时服务多个
   客户端时才值得评估。
2. **不调用 `next()`，由中间件自己向目标模型发两次请求。** 不采用。那会绕开宿主对 prepared-call 的配置
   校验与适配器选择，还会丢掉原请求的失败/重试语义；而保留原回复作为候选 0 需要原请求真的跑一遍。
3. **先在 `agent/request` 阶段改 `proposedConfig` 来选优。** 不采用。那是「选模型/配置」，不是「选回复」；
   它无法在两条具体回复之间比较，正是本项要解决的问题。
4. **用现有 `generateCandidate` / best-of-N 文本通道生成备选。** 不采用。那条路只产纯文本，会丢掉
   tool-call 块、`finish` 元数据与 provider replay 状态，宿主拿到的是伪造的流。
5. **对每次主请求都做 N 路生成。** 不采用。默认关闭、N=2、每任务一次是本轮的受控范围；全量接管需要
   P05 的真实任务对照支持。
6. **提高 N、放宽触发条件（单次失败、模型自述「卡住」）。** 不采用。触发条件越宽，成本与行为改动越大，
   而收益尚无数据；本轮只覆盖「连续两次验证失败」这一明确、可观测的场景。
7. **把过程选优做成第六个工具。** 不采用。它不是工具调用，而是请求级入口；增加工具会改变工具集合、
   路由映射与统计口径。内部 `process` 阶段与 `route.trigger = 'llm-stream'` 已足够表达。
8. **用全局布尔开关做重入保护。** 不采用。那会影响其它 Agent 的并发请求；用宿主的主循环标记 + 请求
   局部 WeakSet 才能既准确又不串票。
9. **并列/相同时按「更长的回复」之类的启发式挑一个。** 不采用。并列就是没有胜者，保留原回复并如实
   记录 `tie`/`identical-candidate` 比伪造一个赢家诚实。

## Consequences

- 关闭状态可验证：`index.test.ts` 断言默认配置下 `llm/stream` 一次下游派发、零额外模型调用、原块序列
  不变；strict 与「两次中一次成功」同样不触发。
- 开启后：同一任务最多一次额外生成 + 一次 proposal 比较（默认 3 判据 × 2 轮 = 6 次裁判调用），
  统计行可区分 `replayed`、`generatedCalls`、`judgeCalls`、`sameCandidate` 与各跳过原因。
- 代价必须明说：**输出要等原回复完成、还要等一次生成与比较才可见**，这段串行等待与额外调用成本计入
  延迟与预算。选优也不等于质量提升——备选胜出只代表这次替换了。
- 已知边界（首版有意保留）：图片/其它块与 provider-owned replay 状态按「原样回放胜者」处理，未做无损性
  证明，因此遇到无法可靠处理的块时保留原路径；候选生成的 attempts 记为 1（直连 `ctx.llm.stream`，
  不经插件的重试包装），缺少 usage chunk 时标 `usageIncomplete`；统计行的美元成本按判官单价表估算。
- 未完成项：M0 要求的「实际目标 0.1.5 发行版」契约验证只做了类型层与源码层核对（`typecheck:local` 通过；
  两宿主的 `llm/stream` 签名、标记函数、prepared-call 汇合点已逐字比对），**没有在真实 0.1.5 宿主上跑过**；
  真实收益评测属 P05。未做：并发双 Agent 的串票实测、图片块回放的无损性证明。
- 验证：`process-selection.test.ts`（26 条：渲染/身份、备选请求、侧车读写与不可读、意图绑定与过期、
  备选胜/原胜/并列/相同、原流超限、备选超限、生成失败、侧车不可写、预算拒绝、取消、用量合并、上限边界），
  `router.test.ts`（恢复信号 + `process` 预约计数与 floor）、`statistics.test.ts`（观测字段落盘与
  非法值丢弃）、`config.test.ts`（默认关闭且保存后保持）、`index.test.ts`（真实钩子驱动：关闭态、
  strict 态、一次成功后、开启态生成并回放胜者、每任务一次）。`pnpm run verify:release` 与
  `pnpm run typecheck:local` 均通过。

## 修订（2026-09-13）

后续一轮离线复核发现本笔记的额度决定与计划不一致，并复现了若干实现缺陷。历史决定保留，**实际行为以下列为准**：

- `maxProcessPerSession` 已删除：`process` 周期改为消耗**共享**的任务/会话路由额度（"每任务一次"仍是独立计数），同一会话的第二个任务因此可以购买自己的周期。
- 比较视图改为先脱敏、再按 `itemBudget()` 分摊并实测总量；**工具动作是原子单位**，放不下就回退原回复。
- 开关/取消/任务状态在每个决策点重读，在途周期可被设置变更或 `agent/disposed` 取消。
- 生成与比较失败行保留已经发生的用量；诊断的候选身份随分数一起映射回调用方。
- 裁判视图新增 `CONTEXT` 块：任务、原请求约束、执行轨迹（含失败运行）与工具定义。

理由、替代方案与验收见 [过程选优与阶段评审的复核修正](../bug-fix/2026-09-13-process-selection-review-corrections.md)。
