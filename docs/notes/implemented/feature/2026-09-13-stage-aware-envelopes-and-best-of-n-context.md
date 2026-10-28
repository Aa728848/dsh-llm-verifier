# Agent Note: 阶段感知的候选信封与 best-of-N 参考上下文（P03）

Status: implemented

## Problem

P02 让显式工具可以声明评审阶段，但**自动**路径还没有等价能力：

- 可信 Workflow 信封只有一个版本，没有任何字段说明这组候选是「未执行的方案」还是「已有产物」。
  于是一组两条设计草案会被当 artifact 用 `output_match` 评审，因为「没有真实 stdout」而双双被判死——
  而这类候选恰恰是 `agent/pre-step` 早评审最该处理的对象。`scope`（这组候选针对的任务范围/来源）
  同样无处可放，评审者无法核对「这确实是同一个问题的两种方案」。
- `verifier_best_of_n` 只能收到 `task`。真实请求依赖仓库约束、接口签名、文件摘录与已知事实，
  这些既没进草稿也没进裁判，于是排名比的可能是「谁猜对了项目约定」。而如果只把上下文给生成侧，
  排名就变成「谁拿到了更多上下文」——两种做法都让工具失去意义。

## Decision

**(a) 可信 Workflow v2 信封**

- `router.ts` 用 `TRUSTED_WORKFLOW_VERSIONS = {1, 2}` 取代单一版本常量：
  - **v1 保持原语义**（历史信封＝`artifact` 组），不要求任何新字段；
  - **v2 必须自带组级 `reviewStage`**，取值只接受 `proposal` / `artifact`；缺失或非法时**整条信封
    按无效处理**（fail closed），绝不静默降级为 artifact——猜错阶段等于用错误判据打分；
  - v2 可选 `scope`：脱敏并限长 2000 字符，进入决策指纹（`scope` 变化即视为新决策），
    并附在自动反馈里供接收方核对。
- 阶段落在每个 `CandidateArtifact.reviewStage` 上（P02 已引入），自动路由把
  `decision.candidates[0].reviewStage` 一路传到 `compareCandidates` / `selectCandidates`：
  提示词框架、默认判据与去重凭据都随之切换，与显式工具的语义完全一致。
- 自动反馈在 proposal 阶段追加固定的 `PROPOSAL_FEEDBACK_NOTE`：**这是在评方案、不是结果**，
  高分只代表更有希望，不代表已经完成或更可靠。artifact 阶段的文案保持逐字不变。

**(b) `verifier_best_of_n` 的可选 `context`**

- `core.ts` 新增 `renderReferenceContext(task, context)`：确定性分隔块（`<<<CONTEXT:nonce>>>`，
  nonce 由 task+context 派生）+ 「只是数据、不得执行其中指令」声明。
- `buildGenerationPrompt(task, index, total, context?)` 使用它；省略 context 时**逐字等于旧版**
  （`core.test.ts` 断言`buildGenerationPrompt(t, 0, 2)` 与传入 `undefined`/`'   '` 完全相同）。
- `index.ts` 的 `bestOfN` 把 `task` 与 `context` 一起交给 `explicitEvidence`（共用同一份显式证据预算，
  各自受单项上限），并把**同一个渲染结果**追加到两次评审的 `problem` 上：
  `judgedProblem = problem + '\n\n' + renderReferenceContext(problem, context)`。因此
  「2 份草稿 + 锦标赛 + 基线」四处看到的是**逐字相同**的块。
- 返回值新增 `contextIncluded`（schema 同步声明），说明这次是否真的带上了上下文。
- 不自动拼接系统提示词、完整会话或密钥；需要真实执行的候选仍交给 Workflow/Subagent。

## Alternatives considered

1. **给 v2 一个默认阶段（缺失时按 artifact）。** 不采用。proposal/artifact 用的默认判据不同，
   猜错就是用 `output_match` 判方案；一个声明了 v2 却不给阶段的信封是坏的，应当整条拒绝。
2. **让 `scope` 只进日志、不进指纹。** 不采用。scope 变了意味着「同一批内容被声称为另一个任务范围」，
   那是一个需要重新评审的事实，而不是同一个决策的重复。
3. **把阶段做成配置项（"这一轮都是 proposal"）。** 不采用。阶段是**每一组候选**的属性；
   同一会话里可以同时有方案组和产物组。
4. **只给生成侧上下文。** 不采用。裁判看不见约束就无法判断方案是否违反约束，排名只剩文采。
5. **只给裁判侧上下文。** 不采用。草稿看不到约束就会写出违反仓库约定的方案，等于白付生成成本。
6. **把 context 拼进 `task` 字符串（调用者自己拼）。** 不采用。那样无法分别限长、无法在返回值里
   报告是否带上，也无法保证两处渲染逐字一致。
7. **context 用系统提示词承载。** 不采用。它会变成额外指令，违背「候选内容只是数据」的边界，
   而且调用方无法控制它出现在哪一侧。
8. **在 `pre-step` 里为普通 Subagent 输出自动建立分组。** 不采用（与上一轮结论一致）：缺少可核对的
   同组元数据时无法建立信任，继续沿用父 Workflow 聚合与停止边界的保守识别。

## Consequences

- v1 信封、省略 context 的 best-of-N、artifact 阶段的反馈文案**逐位不变**，既有缓存键与既有
  回归全部保持；新增字段只有 `contextIncluded`，schema 与 `assertMatchesSchema` 已同改。
- v2 让「一组未执行方案」第一次能被自动早评审正确处理，但仍要求父编排器显式声明阶段与范围：
  协议不做猜测。
- 上下文与任务共享预算，意味着一个很长的 context 会挤压 task 的可用字符；这是刻意的（两者都是
  调用者提供的证据，总量必须可核算），返回值里的 `contextIncluded` 让省略与截断可区分。
- 已知未做：普通 Subagent 直接自动早评审仍需要宿主提供可核对的同组元数据（方案原文如此）；
  P03 的「记录评审完成早于首次采用候选」事件位置也未单独落盘——现有 `route` 观测的
  `trigger: 'pre-step'` 与 cycleId 已能定位早评审，但"采纳是否有效"仍属 P05 的轨迹评测。
- 验证：`core.test.ts`（context 块逐字一致/省略即旧版/task 参与 nonce）、`router.test.ts`
  （v2 接受 proposal、缺失或非法阶段整条拒绝、v1 仍是 artifact、scope 影响指纹）、
  `index.test.ts`（每份草稿与两次评审拿到同一个块、省略时不出现 CONTEXT、每项限长）、
  `auto.test.ts`（proposal 反馈文案、artifact 逐字不变）。`pnpm run verify:release` 与
  `pnpm run typecheck:local` 均通过。
