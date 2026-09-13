# Agent Note: 用量载体归一化与全阶段累计

Status: implemented

## Problem

第三轮复核在记账上又指出五处问题：

1. **[P1] 部分裁判失败会产生非法工具输出。** `UsageStats` 被直接当作 `RunStats` 合并：一个裁判正常、另一个截断时，`mergeRunStats` 读取不存在的 `cacheHits` 等字段得到 `NaN`，序列化成 `null`，工具输出 schema 校验失败。
2. **[P2] 并发取消重复累计。** 多个并发请求共用同一个 `signal.reason`；`retrying` 把尝试数挂到这个共享对象上，引擎又把各自的累计对象挂到它上面，于是同一对象被反复合并。实测 3 次请求、1 次成功、10 输入 token 被记成 4 次尝试、2 次成功、20 token。
3. **[P2] track 解析失败漏记。** compare 已在解析失败时保留已计费响应的 usage，track 的进度解析没有：两次响应共 20 输入 token 只记 10。
4. **[P2] 重试链两个遗漏。** 在重试等待期间取消时，已发生的请求记为 0；失败响应已返回 usage、随后重试成功时，前一次的已知 token 被丢弃（20 只记 10）。
5. **[P2] best-of-N 未覆盖完整阶段。** 生成失败时只保留错误消息、丢掉错误对象上的用量；基线评分失败时又丢掉生成与排序阶段的累计。失败前已成功的 3 次、30 输入 token 最终记为 0。

## Decision

1. **载体归一化。** `engine.partialStats()` 统一把载体补成完整 `RunStats`（`blankStats()` 打底 + `?? 0` 补 RunStats 专有计数），`mergeRunStats` 对每个计数 `?? 0` 并拒绝自合并（`source === target`）；`addUsage` 也改为 `+= source[key] ?? 0`。carrier 现在既可以是 caller 层的裸 `UsageStats`，也可以是引擎累计对象，任何调用方都不可能再合出 `NaN`。
2. **每个被取消的请求有自己的错误。** `retrying` 不再注解并抛出共享的 `signal.reason`，而是用 `abortFailure(reason, attempt)` 生成一个新 `Error`（保留 message/name），把尝试数挂在它上面。共享对象不再承载多个累计；`mergeRunStats` 的自合并保护作为第二道防线。
3. **track 与 compare 同样处理解析失败。** 抽出 `attachBilled(error, usage)`：把已计费响应的 usage 挂到解析错误上；`track` 的进度解析与 `scoreOne` 都使用它。
4. **重试链累计。** `retrying` 维护 token 级 `carried`（只累加 token，不重复计 calls/attempts/retries）与 `unknownFailure`：后续成功时把失败尝试已返回的 token 加上，只有"某次失败尝试的 token 未知"时才标 `usageIncomplete`。取消发生在退避等待期间时，用 `abortFailure` 保留已发生的 attempt。
5. **best-of-N 全阶段累计。** 在生成阶段就建立 `generation` 累计：成功草稿计入，失败草稿通过 `partialStats(error)` 计入并在未知时记 `unknownDrafts`；`select` 与基线 `compare` 各自包一层 catch，先把该阶段的 partial 并入 `generation`、再把 `generation`（含费用）挂回错误。`survivors < MIN_BEST_OF_N` 的抛出同样带上 `generation`。最终 `stats` 就是 `finishGeneration()`。

## Alternatives considered

1. **只在 `attachUsage` 时补全 RunStats 字段。** 不采用：carrier 会被多条路径读取（引擎合并、`index.ts` 失败行、best-of-N），在每个写入点补全容易漏；在 `partialStats()` 这一个读入口归一化更稳。
2. **继续抛共享的 `signal.reason`，改用"已合并集合"去重。** 不采用：需要给每个累计对象记录已合并的 error，复杂度高且脆弱；让每个被取消的请求带自己的错误才是根因修复。
3. **重试成功时用 `addUsage` 直接累加失败尝试的完整 `UsageStats`。** 不采用：会重复计 `calls`/`attempts`/`retries`（成功 completion 的 `attempts` 已经是总尝试数）；只累加 token 才对齐"一次逻辑请求"的口径。
4. **best-of-N 只把生成用量加进成功路径。** 不采用：基线失败正是最需要看清"已经花了多少"的时刻；每个阶段失败都要能带走之前的累计。
5. **失败草稿一律标 `usageIncomplete`（沿用旧行为 `failures.length > 0`）。** 不采用：失败响应若已返回 usage，总量是完整的；只有 token 未知的失败才应标记。

## Consequences

- 部分裁判失败、重试、取消、track 解析失败、best-of-N 各阶段失败的统计都保留已知请求、token、attempts/retries 与费用；`NaN`/`null` 计数器不再出现，工具输出 schema 稳定通过。
- 取消错误不再是 `signal.reason` 本身，而是保留 message/name 的包装错误；调用方仍能读到同样的信息与尝试数。
- `usageIncomplete` 的语义更精确：表示"还有未知部分"，而不是"曾经失败过"。
- **S05-B 仍未完成**：真实标注样本与真实模型对比报告继续待办，计划 Markdown 仍留在 `proposed/`，未调整任何阈值。
- 本批不改判定逻辑与评分缓存身份，`lib/` 随本批重建。
