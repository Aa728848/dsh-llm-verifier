# Agent Note: 失败费用写回、重试链全程携带与 best-of-N 请求元数据

Status: implemented

## Problem

第四轮复核在记账上又指出三处问题：

1. **[P2] 失败费用计算回退。** `partialStats()` 改成返回归一化副本后，`mapLimited()` 对副本调用 `finishStats()`，价格写在副本上、随即被丢弃；错误上挂的原对象费用仍是 0。实测已知费用应为 $0.00016，落盘仍为 $0。
2. **[P2] 重试最终失败或取消时丢失此前已知 token。** `carried` 只在成功出口合入结果；链条最终失败时错误只带最后一次响应的 usage，等待期间取消时则完全不带。实测三次失败响应共 30 输入 token 只记 10；已有 10 token 后取消记成 0。
3. **[P2] best-of-N 丢失请求元数据。** 无 usage 的失败草稿没有保留 `requestAttempts`（2 次请求只记 1 次尝试）；成功草稿经历过"未知用量的失败重试"时，`addUsage()` 又丢掉它的 `usageIncomplete` 标记。

## Decision

1. **价格写回。** `mapLimited` 在抛出前把 `finishStats(partialStats(failure))` 的结果 **`attachUsage` 回错误**：`partialStats` 返回副本这一事实被显式处理，失败行读到的是已计价的对象。
2. **重试链全程携带。** `retrying` 用 `spent(billed, unknown)` 统一构造"这条逻辑请求目前已知的用量"（`carried` + 本次响应的 usage，attempts/retries 取整条链），并在**每个出口**挂到抛出的错误上：成功时把已返回的 token 加回成功 usage；最终失败时挂 `spent(billed, ...)`；取消（在途或退避等待期间）时挂 `spent(...)`。`unknownFailure` 只由"某次尝试的 token 未返回"置位，因此全部尝试都已返回 usage 时总量是完整值而不是下限。
3. **best-of-N 请求元数据。** 失败草稿额外带回 `requestAttempts(error)`（无载体时补进 `generation.attempts/retries`）；成功草稿改用 `mergeRunStats`（而非 `addUsage`）以便传播 `usageIncomplete`；`unknownDrafts` 由 `billed.usageIncomplete` 判定。

## Alternatives considered

1. **在 `index.ts` 的失败分支自己按单价算费用。** 不采用：单价在引擎里，重复一份计价逻辑会有两处漂移；且 best-of-N 等路径也会各算各的。
2. **让 `partialStats` 在载体已是完整 `RunStats` 时返回原对象。** 不采用：需要检测对象形状，脆弱；显式写回更直接。
3. **任何失败都标 `usageIncomplete`。** 不采用：三次响应都返回了 usage 时总量是已知的，标记不完整会低估可观测性。
4. **best-of-N 只在生成错误路径补 attempts。** 不采用：`requestAttempts` 统一覆盖"没有 usage 载体"的失败，成功草稿的 incomplete 则必须靠 `mergeRunStats` 传播。

## Consequences

- 失败行现在带**已计价**的已知用量（费用不再回退为 0），并且重试链的每一次尝试都会被计入 attempts 与 token——无论链条以成功、最终失败还是取消结束。
- 全部尝试都返回 usage 时 `usageIncomplete` 不置位；只要有一次尝试的 token 未知，总量就被标记为下限。
- best-of-N 的失败草稿保留请求次数；经历过未知用量重试的幸存草稿会把 `usageIncomplete` 带到最终结果。
- **S05-B 仍未完成**：真实标注样本与真实模型对比报告继续待办，计划 Markdown 仍留在 `proposed/`，未调整任何阈值。
- 本批不改判定逻辑与评分缓存身份，`lib/` 随本批重建。
