# Agent Note: 路由去重、失败证据可见性与最终验收额度

Status: implemented

## Problem

F05、F06、F07（均为 P1）都是"各部件单独可用、连接处不成立"的问题。

- **F05**：`successfulExplicitKinds` 按**工具名**在整条任务里抑制结构化路由。一次显式 `verifier_select` 之后，任何新的候选组都被屏蔽；候选组选择又先取"候选数最多"的组，于是 4 候选旧组会一直遮住 3 候选新组。被 reservation 拒绝后也不会继续找下一组或 track。
- **F06**：`buildEvidenceIndex` 在建索引时排除失败的 `tool/result` 与失败 PTC dispatch。内存复现：先有 `Tests 12 passed`，随后同类命令返回 `FAIL 1 test failed`，再更新 Todo——最新 track 检查点展示的是**旧的通过输出**，最新失败消失。
- **F07**：路由与最终验收虽已分开计数，却仍直接从同一份模型调用余额扣款。默认任务上限 96 时，7 候选/3 判据/1 轮/2 裁判的路线预约 90，最终验收需要 12，于是强制验收被拒；显式 `verifier_select` 的上限检查又用固定两 pivot 的估算值、且漏乘裁判数——16 候选 / 16 pivots / 3 判据 / 2 轮的真实值为 816 次调用，而检查只算出 252。

## Decision

**F05**（`router.ts`、`index.ts`）：

- 新增 `explicitReviewKeys()`：从成功的 `verifier_compare`/`verifier_select` 的**调用参数**里取出候选内容，用 `candidateSetKey()` 做与预算无关的内容指纹（先脱敏再排序）。`analyzeStructuredRoute` 只跳过**指纹相同**的组；候选组改为按 `toSeq` **从新到旧**遍历，并通过新的 `options.processed(fingerprint)` 跳过已 commit 的决策，从而继续尝试下一组。语义路径的 `semanticDecision` 复用同一指纹。完全移除按工具名的 track 抑制。
- `EvidenceCall` 现在记录 `args`，供上述指纹使用。

**F06**（`router.ts`）：

- `EvidenceCall` 增加 `ok: boolean`；失败的 `tool/result` 与失败的 PTC dispatch 都进索引（`ok: false`）。检查点渲染它们并标注 `—— FAILED` / `[FAILED]`；`verificationEvidence` 也会把最新失败运行摆到裁判眼前。
- 候选约束不变：`analyzeStructuredRoute` 的 workflow 组、`semanticDecision` 的候选、`explicitReviewKeys` 都要求 `pair.ok`，失败产物**绝不**进入 select/compare。

**F07**（`router.ts`、`index.ts`）：

- `RouterPolicy.minFinalModelCalls`（判据数 × 最终轮次 × 裁判数）：非 final 的预约要求 `taskModelCalls + expectedCalls + floor` 不超过任务/会话模型调用预算，`budgetExhausted` 同步；final 预约不受该 floor 限制。`index.ts` 的 `routePolicy(selected, minFinalModelCalls)` 由 `configuredCriteria()` 计算。
- `selectComparisonsUpperBound(count, pivots)` 改为"ring + 完整 pivot pairs、不做重叠折扣"的安全上界；显式 select 按 N、K、判据数、轮次、裁判数计算，compare 与 current_session 也使用同一 `MAX_EXPLICIT_PLANNED_CALLS` 上限，超限在**发出任何模型请求之前**报错。select 工具现在真的使用公开的 `pivots` 参数（此前自动路径固定 2，显式路径虽读取但上限不匹配）。

## Alternatives considered

1. **按"某个工具名出现过"继续抑制后续路由**。不采用。它把"同一份输入已评审"与"这一类工作已做过"混为一谈，报告明确要求绑定对象指纹与证据版本。
2. **只跳过已 commit 的 fingerprint，不处理显式评审**。不采用。显式调用不经过 router 的 completed 集合，真正的重复购买正是它造成的。
3. **失败结果只用于 track、不建独立状态**。不采用。报告要求"候选必须成功，检查点必须能看见失败"——索引里没有状态就无法同时满足。
4. **把最终验收额度做成第三套预算计数器**。不采用。报告要求"不引入第三套计费语义"；这里只是给同一份余额加下限。
5. **显式 select 直接拒绝自定义 pivots**。不采用。引擎本就支持 `options.pivots`，正确做法是按其真实规模计算安全上界。

## Consequences

- 新对象不再被旧对象遮挡；显式 select 之后旧组跳过、新组保留；没有新证据时不重复评分；显式 track 不再挡住会话检查点；语义与结构化路径共享同一去重指纹。
- "先通过、后失败"会展示最新失败并标注状态；修复后重新成功恢复为最新证据。
- 90 + 12 的路线在入场时被限制或拒绝，不会再先承诺强制验收再无钱执行；显式 816 次调用的输入在首个请求前被拒绝。
- 回归把三个数字锁成断言：任务/会话预算下限、显式 select 的 pivots/裁判倍数上限、失败证据可见性。
- 已知权衡：被拒绝的路由现在会多写一条 `skipped` 统计记录（见 F09 笔记）；预约仍不按缓存命中返还（保守），报告要求的"预约/实际/重试分离"只在此范围内落地。
