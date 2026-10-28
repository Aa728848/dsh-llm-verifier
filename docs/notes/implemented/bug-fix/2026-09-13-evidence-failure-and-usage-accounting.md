# Agent Note: 证据读取失败不再吞掉门控，用量记账覆盖全部执行路径

Status: implemented

## Problem

第二轮复核在上一批修复之后又指出三处缺口：

1. **[P1] 证据读取失败绕过 strict 门控。** 上一批把语义视图构建提前到预约之前，但失败分支直接 `return`。实测图片读取失败后最终验收、阻断反馈、统计记录**全为 0**：它既没有消耗预算，也没有留下任何失败处理，和"预算耗尽"无法区分。
2. **[P2] 失败统计仍只覆盖串行 compare。** 三类场景仍漏记：`select` 的 ring 阶段成功、pivot 阶段失败时丢失前一阶段用量；并发请求在失败落盘后才返回时丢失在途用量；回答返回但解析失败时丢失那次已计费响应的用量。此外取消请求的尝试数、失败请求的重试数、重试成功后的不完整标记、以及失败前已知用量的费用都没有完整保留。
3. **[P2] 诊断周期 ID 跨重载冲突。** Reservation 已经是唯一 ID，但 `nextCycleId()` 仍是每实例从 `diagnostic-1` 开始，两个插件实例的交付阶段跳过记录会被合并。

## Decision

**1. 证据读取失败按失败处理并继续。** 视图构建失败时不再 `return`：用失败指纹预约一次（消耗预算以授权 strict steering）、记一条 `evidence-unreadable` 的跳过行、strict 下 steering 一次，然后**继续落入强制最终验收**。最终验收自身的失败也补记一条 `failed` 行——原先它只在宿主日志留一行，统计同样是 0。

**2. 记账收口到"谁付费谁记账"。**
- 共享的 partial 载体从 `engine.ts` 移到 `caller.ts`（`partialUsage` / `attachUsage`），因为"已计费但不可用"的响应在 caller 层就产生了：`callTextCompletion` 对截断、stream 失败、空文本用 `unusable()` 把该次响应的 usage 挂到错误上；`engine.scoreOne` 对解析失败做同样处理。
- `retrying` 在 abort 时把尝试数挂到真正抛出的 `signal.reason` 上；当某次尝试失败、后续尝试成功时，把返回 completion 的 `usage.usageIncomplete` 置真（那次的 token 永远未知）。`UsageStats` 因此新增可选 `usageIncomplete`。
- `engine.mapLimited` 不再用 `Promise.all` 立即 reject：首个失败后**停止发起新工作**，但等待所有在途调用落地，再对累计 stats 计一次价（`finishStats`）并抛出。并发在途的用量因此保留。
- 失败裁判结果统一走 `accountFailure()`：有已计费用量就合并，否则只记 attempts + retries（不再漏 retries）。成功结果也传播 `usageIncomplete`。
- `select` 在 pivot 阶段之前先把 ring 阶段的 stats 并入累计；pivot 失败时合并错误的 partial、计费、再把累计挂回错误。

**3. 诊断 ID 也带 epoch。** `router.ts` 新增 `nextDiagnosticCycleId()`（`diagnostic-<epoch>-<serial>`），`index.ts` 的 `nextCycleId` 直接复用它。

## Alternatives considered

1. **视图构建失败只记录并 `return`。** 不采用：那样强制最终验收仍被跳过，正是 P1 的问题；"已经记了一条"不等于门控还在。
2. **保留 `Promise.all` 的立即 reject，只取消定时器。** 不采用：在途请求已经付费，丢弃它们的用量等于把真实成本报成 0；等待落地才是正确口径。
3. **只用 attempts 表示"重试成功但不确定"。** 不采用：attempts 是已知请求数，tokens 才是未知项；不置 `usageIncomplete` 会让重试后的行看起来是完整用量。
4. **给诊断行用随机 UUID。** 不采用：epoch + 序号既能跨重载唯一，又保持可读与有序，和 reservation id 的命名空间一致。
5. **把 final 的失败也当成预算失败（不记录）。** 不采用：最终验收失败是"尝试过但没结论"，必须与"从未尝试"区分。

## Consequences

- 图片/附件读取失败现在会留下 `evidence-unreadable` 记录、strict 下给出反馈，并且边界仍然进入最终验收；最终验收若同样失败也会留下 `failed` 行。
- 失败行的 `calls`/tokens/`attempts`/`retries`/`estimatedCostUsd` 覆盖串行、并发、解析失败、重试与取消；`usageIncomplete` 表示"还有未知部分"，而不是"已经完整"。
- `mapLimited` 在失败时会等待在途请求，因此失败路径比之前多等一次网络往返——这是保留真实用量的必要代价。
- 诊断周期 ID 跨插件重载不再合并。
- **S05-B 仍未完成**：真实标注样本与真实模型对比报告继续待办，计划 Markdown 仍留在 `proposed/`，未调整任何阈值。
- 本批不改判定逻辑与评分缓存身份，`lib/` 随本批重建。
