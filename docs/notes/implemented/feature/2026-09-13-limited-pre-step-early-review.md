# Agent Note: 受限的 agent/pre-step 早评审

Status: implemented

## Problem

自动 compare/select 此前只在 `agent/turn-stopping` 执行：候选已经被选出来、下一步行动也已经由主模型决定之后，评审结果才作为 steering 到达，只能等到再下一步才能影响实施。可信的 Workflow 候选信封在结果落库时就已完整，评审却要等整个 step 跑完——同一份候选被"先做后判"，S02 要把它提前到下一次主模型生成之前。

难点是接入顺序：直接代理每个 `llm.stream` 请求会改变 DSH 的模型接入、工具执行与成本结构；在任意写工具前拦截又会与并行工具执行交错。已核对的宿主入口是 `agent/pre-step`（waterfall，返回 `{kind:"enter", messages}` 或 `reject`）：它在上一 step 完成后、下一次模型请求前被 await，自带模型切换提示也通过返回的 messages 注入当前步骤。

## Decision

- `index.ts` 注册受限的 `agent/pre-step` 监听：先 `await next()`，**拒绝就原样返回**（不会用注入消息复活被拒绝或取消的步骤）；仅在插件启用、`smart` 模式、符合子会话策略、signal 未取消时尝试。
- 携带**新的直接用户/团队任务**的 step 不重写（那属于操作者）；`step <= 1` 且宿主消息为空时不注入（宿主本来会结束该轮，注入等于复活它）——工具后续步允许为空，不能一概据此跳过。
- 早评审只处理结构化路由产出的 **compare/select**：不跑语义分类、不跑 `track`、不跑最终验收、不生成候选。候选来源与停止边界共用 `analyzeStructuredRoute` + `processed` 指纹。
- 预约与评分复用停止边界的 `AutoVerifierRouter.reserve/commit/fail`、`compareCandidates`/`selectCandidates`、证据限长与 S04 反馈构造；结论通过返回的 `messages` 交给**当前步骤**，不用 `agent.steer()` 延迟。成功评审照常设置最终验收要求（`commit` 会置 `finalRequiredFromSeq`）。
- 预算被拒、候选已评审、in-flight 冲突或评分失败时返回 undefined，让宿主的 step 决定原样生效（smart 继续工作），只记一条宿主日志；停止边界仍是兜底。
- `RouteObservation.trigger` 取值增加 `pre-step`，成功评分行带 `stage: "execution"`，从而与停止边界的行可区分。

## Alternatives considered

1. **代理每个 `llm.stream` 请求（TurboAgent 全请求管线）。** 不采用：会改变 DSH 的模型接入、工具执行与成本，且要复刻宿主已完成的消息组装；`agent/pre-step` 正是为此提供的官方介入点。
2. **在任意工具完成后做评审，或在每个写工具前拦截。** 不采用：会增加调用并与并行工具执行交错；只处理已完成的 Workflow 候选信封既确定又便宜。
3. **只改工具描述，让 Agent 自己记得先比较再实施。** 作为 README 指引保留，但不作为自动化交付：完成标准必须包含真实钩子的消息顺序。
4. **在 pre-step 里跑完整路由器（含语义分类/track/最终验收）。** 不采用：会把本属于停止边界的强制门控提前到任意 step，且语义分类的线索未必已出现；首版只处理确定性最高的 Workflow 候选信封。
5. **在早入口单独维护一份去重状态。** 不采用：会与停止边界各自消费一次同一候选；共享 fingerprint/in-flight 是"同一份候选只评分一次"的唯一可靠实现。

## Consequences

- Workflow 候选在被记录后的下一步模型请求之前就完成 compare/select，结论直接影响接下来的实施；`index.test.ts` 通过注册的 `agent/pre-step` 钩子锁定事件顺序（评分发生 → 消息携带评审结果进入当前步骤）、共享指纹（随后停止边界不再重复购买同一对候选）、相同候选 0 次调用，以及 reject/首步空消息/新用户任务/子会话/strict/仅 track/评分失败七条不介入路径。
- 早评审会为每个 step 做一次轻量的 `analyzeStructuredRoute` 扫描；没有 Workflow 候选信封时零模型调用。
- 两条宿主线都验证过：npm 锁定的 `@deepseek-ai/dsh-agent` 与本地 `../deepseek-harness` 的 `pnpm run typecheck` / `typecheck:local` 均通过；`lib/` 随本批重建。
