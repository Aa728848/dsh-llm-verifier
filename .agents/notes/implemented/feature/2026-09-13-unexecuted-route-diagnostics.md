# Agent Note: 未执行路由的诊断记录

Status: implemented

## Problem

F09（P2）的现状之一是：统计已经记录了一部分跳过原因，但"一般预约拒绝、低置信/none、耗尽未验收"仍不完整。具体表现：

- 语义分类返回 `none` 或置信度低于阈值时，代码只是不做任何路由，**不写任何记录**。看板因此只看到"这个任务没有被路由"，给不出原因。
- 自动路由的 reservation 被拒绝（预算不足 / 已有 verifier 在跑 / 同一证据已路由）时，只在宿主日志 `warn` 一行，看板不可见。
- 已有的 `recordSkippedRoute()` 只能按下发工具的种类映射到 `verifier_compare/select/track`，无法表达"这是一次分类决策"。

## Decision

（`index.ts`）

- `recordSkippedRoute(agent, kind, phase, outcome)` 的 `kind` 扩展为 `RoutedVerifierKind | 'none'`：`'none'` 映射到 `verifier_route_classify`，其余仍映射到对应工具。
- 语义分类置信度低于阈值时，记录一条 `verifier_route_classify` 的统计：`outcome` 为 `'low-confidence'`（分类出了 kind 但不够可信）或 `'none'`（分类器认为无可路由对象）。该记录与分类调用本身的 `'classified'` 行并列，因此"调用了分类但没路由"与"分类没跑"在看板上可区分。
- 自动路由的 reservation 被拒绝时，除原有 `logger.warn` 外，再记录一条 `skipped` 统计，`outcome` 为 `'budget-exhausted'` / `'already-routed'` / `'verifier-in-flight'`，与既有 `'dropped-over-budget'` / `'invalid-references'` 并列。

这些记录都是 `emptyRunStats()` 的成功调用行 + 解释性 verdict，不参与任何判定，也不改变门控与预算。

## Alternatives considered

1. **只靠 `ctx.logger.warn`**。不采用。看板是操作者看的地方，宿主日志不是"为什么没验收"的答案。
2. **把低置信分类记为 kind 对应的工具（如 `verifier_compare`）**。不采用。那会把"分类后没有执行"与"真的执行过一次 compare"混在一起；实测也确认了这种混淆。
3. **为这些跳过引入新的 verdict 状态枚举与 UI 组件**。暂不采用。现有 `outcome` 文本已经在 `verdictInfo` 里渲染；本次只补齐数据，不改判定语义与 UI 结构，避免在没有真实标签评测前扩大改动面。
4. **同时实现报告 F09 的 30 样本分层评测与阈值校准**。明确推迟：报告本身把 F09 定为 P2，且其完成标准是"输出按通道/任务分层的真实标签评测"；在没有人工标注样本与真实模型复测的情况下修改默认阈值等于凭空收紧或放松门控。本笔记只落地其中的诊断记录部分。

## Consequences

- 看板现在能解释三类此前不可见的"未执行"：分类低置信、分类为 none、reservation 被拒（含原因）。
- 新增回归：`index.test.ts` 走真实的 `agent/turn-stopping` 钩子与语义分类，断言统计查询里出现 `verifier_route_classify` + `outcome: 'low-confidence'`。
- 已知取舍：跳过记录与分类记录都计入"调用次数"统计，但不计入预算；预约仍不按缓存命中返还，`record()` 的失败分支仍写 `emptyRunStats()`——"预约逻辑调用数 / 已完成评分调用数 / 网络尝试与重试"的彻底分离尚未实现，已在 F09 的待办中保留。
- F09 的评测部分（分层样本、误放行/误阻断率、`0.65 / 0.684 / 0.9` 与轮次的再校准）状态为**未实施**，需要真实标签数据，本次不改默认值。
