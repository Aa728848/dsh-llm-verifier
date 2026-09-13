# Agent Note: 显式会话验收回读契约与语义路由输入边界

Status: implemented

## Problem

本轮的起点是 2026-09-13 上游算法及 TurboAgent 对照评审（`.agents/notes/proposed/architecture/2026-09-13-upstream-routing-tools-review-plan.md`）中的 F01 与 F02，两项都是 P0。

**F01：显式验收的回读契约会漏掉失败判据。** `verifySession` 实际返回 `criteria: [{id, name, score}]`（验收口径，见 `index.ts`），`auto.ts` 的 `parseSessionVerdict` 却只读取 compare 形状的 `item.scoreA`。结果是真实返回值里的判据被**全部过滤**，空 breakdown 在 `failedAcceptanceCriteria` 下自动"全部达标"，于是"某一项判据 0 分"的判决也能解除门控。`auto.test.ts` 的 fixture 恰好用了 `scoreA`，所以既有测试没有暴露这处错位。同一函数还有第二个独立缺口：它以判决**回执**的 seq 判断新旧，而不看被评审区间 `toSeq`——只复核到 seq 2 的通过结论，在任务已经工作到 seq 6 时仍被当作当前验收。第三个缺口是强制标记：自动路线已经设置 `finalRequiredFromSeq` 时，显式通过只影响 `evidence.eligible`，停止钩子仍会再次购买一次完整验收。

**F02：语义分类的输入边界没有闭合。** `router.ts` 的 `buildSemanticRoutePrompt` 对 artifacts 做单项脱敏，却对 Todo 快照直接 `JSON.stringify(todos)`，且首个快照即使超过剩余预算也无条件加入；实测在单项 100 / 总量 1000 的配置下构造出 10877 字符的提示词，其中含未脱敏的合成密钥，也没有使用 `renderDelimitedBlock/evidenceNonce`。引用校验同样查完整会话索引而非本次分类可见列表，因此被预算省略的 ID 仍会被接受。

## Decision

**F01**（`auto.ts`、`router.ts`、`index.ts`）：

- `parseSessionVerdict` 只从真实字段 `score` 读取顶层分数与逐项分数（不再回退 `scoreA`），并额外返回 `criteriaCount`（原始数组长度）以及 `sessionId/fromSeq/toSeq`。
- `analyzeAutoTask(events, policy, sessionId?)` 的通过条件收紧为：判据数组非空且**每个条目都能解析**（`criteria.length === criteriaCount`）、`fromSeq` 为整数且 `<= taskStartSeq`、`toSeq` 为整数、提供了 `sessionId` 时与判决一致、`winner === 'A'`、分数达标、逐项达标，并且**没有 `isConsequential` 工作 settle 在 `toSeq` 之后**。过期判断改用结果事件的 seq（`completedWork`），不再用调用事件或回执 seq。
- 新增 `AutoVerifierRouter.acceptManual()`：在 turn-stopping 钩子里，只要 `evidence.manualVerificationAccepted`，就在**任何路由/团队闸之前**清除 `finalRequiredFromSeq`、`finalPreferred` 与 `strictBlocked` 并直接关闭本轮，不再重复购买验收。

**F02**（`router.ts`、`index.ts`）：

- 新增 `buildSemanticRouteView()`，把 artifacts、Todo 快照与任务陈述合成一个"已脱敏、已限长、可见引用集合"的结果：先收集可用证据，再用 `itemBudget()` 把**同一份**总预算摊到所有条目（每条另计 `SEMANTIC_ITEM_OVERHEAD` 的包装成本），先到先得、最新的证据优先；Todo 内容逐条脱敏后再序列化。
- 提示词改为按条目渲染 `renderDelimitedBlock('ARTIFACT'|'CHECKPOINT', token, …)`，`token = evidenceNonce(所有已渲染内容 + 任务)`——确定性、内容派生，证据里的字面量终止符无法提前闭合数据区，且同一输入产生相同前缀。
- 新增 `semanticReferencesVisible()` 与 `semanticDecision(..., visible?)`：可见集合由 view 提供，引用被预算省略的 ID、未知 ID、协调工具 ID 一律判为非法引用；`index.ts` 用同一个 view 同时渲染提示词与校验引用，strict 下非法引用走 `fail` 路径并消耗既有预算（不无限重试），`none`/低置信则单独记录原因。

## Alternatives considered

1. **只改 `auto.test.ts` 的 fixture、保留 `scoreA` 回退**。不采用。真实工具从始至终只返回 `score`；保留 `scoreA` 回退等于让 compare 形状的载荷继续绕过逐项下限。
2. **把显式通过当作"另一套阈值"直接放行**。不采用。报告要求不默认给评分接口增加第二套阈值；这里复用 `sessionAccepted` 与同一份逐项规则。
3. **保留按工具名的路由屏蔽**（属于 F05，见另一篇）。此处不展开。
4. **对语义路由继续用裸 `maxItemChars` 逐项截断**。不采用，违反"任何新增候选/检查点来源都必须走 `itemBudget()`"的既有硬规矩，且 `boundDecision` 会把整条决策丢掉。
5. **只对 artifact 加分隔块，Todo 继续 `JSON.stringify`**。不采用。注入面与引用校验都要求任务、产物、检查点使用同一套确定性分隔块。

## Consequences

- 真实输出里"某一项 0 分""判据缺失""区间过期""会话不匹配""通过后又改动"都不再能解除门控；恰好达到阈值仍被接受（回归覆盖）。
- 显式通过现在是真正的一次性收益：它会清除强制标记并结束本轮，而不是再触发一次完整验收。
- 语义路由提示词被硬性限制在 `maxInputChars`（含包装开销）内，脱敏覆盖 Todo，注入的伪终止符不能闭合数据区；分类器只能引用本次渲染出的 ID。
- 测试基线从 322 项提升到 346 项（`auto.test.ts` 13、`router.test.ts` 59、`session.test.ts` 12、`index.test.ts` 23），`pnpm run typecheck` 与 `pnpm test` 全绿；`lib/` 已重建。
- 破坏面：`parseSessionVerdict` 不再接受只有 `scoreA` 的判据载荷。这是 fail closed 的预期行为，已在 `AGENTS.md` 与测试中固定。
