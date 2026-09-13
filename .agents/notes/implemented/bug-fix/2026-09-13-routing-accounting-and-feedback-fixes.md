# Agent Note: 路由记账、早评审准入与反馈定位的七项修复

Status: implemented

## Problem

上一轮交付的四批（S01/S03/S04/S02 + S05-A 观测）在复核中暴露了七处真实缺陷，另外 S05-A 的看板展示没有同步：

1. **早评审复活被清空的续步**：`agent/pre-step` 只判断"首步为空"，`next()` 返回空消息（下游监听器清空了原有续步）时仍注入并花了 6 次判官调用。
2. **失败统计丢失已知用量**：`compare`/`track` 在全部 job 完成后才汇总统计，某个 job 抛错会让此前成功调用的用量全部消失——实测 2 次成功 + 1 次失败被记成 1 次尝试、0 token。
3. **纯叙述仍重复消费分类额度**：语义指纹取 `admittedLastSeq`，追加一句不改变任何证据的叙述就换了指纹，同一份提示词被付费分类两次。
4. **长候选 ID 丢失定位**：`locate()` 把 label + id + seq 一起截断，同名候选 + 长 ID 时同时删掉了 ID 的区别部分和事件位置。
5. **周期汇总重复与合并**：同一提升周期的累计预留（1 → 7）被相加成 8；周期 ID 是每个 router 实例从 1 开始的计数器，插件重载后两个不同周期共用一个 ID。
6. **离线评测误报漏触发**：`evaluateSample` 没把最终验收资格计入 `observedTrigger`，实际跑了 6 次最终验收的任务被评为 `miss`。
7. **失败反馈混淆两种情况**："判据全部达标、只是平局"被写成"裁判未提供判据明细"。

## Decision

1. `index.ts` 的 pre-step 用"该步被提供了什么"区分两种空：首步为空，或**被提供了消息但最终决定为空**（下游清空）时保持跳过；只有既没被提供、也没被清空的普通工具后续步才允许注入。
2. `engine.ts` 把每裁判的用量汇总移进 job/repeat 的 worker，在"全失败"抛错前完成，并把共享的 `RunStats` 通过 `PARTIAL_STATS` symbol 挂到抛出的错误上（`partialStats()` 读取）；`scorePairs` 同样按 pair 累计，失败时合并自身 partial 与已有累计。`index.ts` 的失败分支优先使用 `partialStats()`（它已包含失败请求自身的 attempts，不再重复相加），并给 `stats.usageIncomplete` 与 route 观测同时打标。
3. 语义分类先构建证据视图、再预约，指纹改为 **渲染后提示词的哈希 + 模型**（`stableHash({ phase, model, prompt })`）：追加纯叙述不再改变指纹；视图构建失败发生在预约之前，因此不消耗尝试、也不 steering（避免以无预算的 steering 制造活锁）。
4. `locate(ref, budget, ordinal)` 先分配**候选序号**（`[N]`），再分配事件位置，最后才给标签；ID 只在放得下时附带。
5. `router.ts` 的 cycle id = 模块级 epoch + 实例序号 + 预约序号，跨重载唯一；`replay.ts` 的 `reservedCalls` 按 `cycleId` 取**本轮最大值**再求和（提升周期只算一次预留）。
6. `evaluateSample` 在 `eligible` 时同时把 `final` 记入 `observedPhases` 并把 `observedTrigger` 置真——最终验收就是一次评审。
7. `automaticFeedback` 增加 `reportedCriteria` 参数：只有裁判**确实报了 0 条判据**时才说"没有判据明细"；判据全达标时不再出现该行。

另外把 S05-A 的 `route` 观测接进统计看板：记录行新增 `usageIncomplete` / `channelFallbacks`，最近调用里显示路由徽标（stage→destination）、周期/触发点/预留调用/跳过原因，`client-i18n.ts` 中英各补 6 个键。

## Alternatives considered

1. **把"下游决定为空"一律当跳过。** 不采用：真实宿主在工具后续步、且运行时上下文无需更新时同样会返回空消息（`RuntimeContextProjection.project` 返回 `undefined`），一律跳过等于关闭这些步的早评审。用"被提供了什么"区分，才能既尊重清空又不误伤。
2. **给每个被抛出的错误不带累计，只靠 `requestAttempts()`。** 不采用：那只知道失败请求自己的尝试数，2 次成功调用的 token 仍会丢；必须让错误携带引擎的累计。
3. **保留"先预约、后构建视图"以复用 seq 指纹。** 不采用：视图构建要先于指纹，而 view 构建不做模型调用；若保留旧顺序，视图构建失败会消耗一次尝试并触发 strict steering，且无法实现证据去重。
4. **给每个预约生成随机 UUID 当 cycleId。** 不采用：分类与提升后的执行必须共享同一个 cycleId，随机值会让它们对不上；epoch + 实例 + 序号既唯一又保持同周期一致。
5. **让 `deliveryReady` 也计入 `observedTrigger`。** 不采用：最终门控实际由 `evidence.eligible` 把关（index.ts 的两处判断），`deliveryReady` 但没有资格的任务不会真的验收，计入会制造误触发。
6. **为 S05-B 生成"真实"标注样本或模型对比报告。** 不采用：标签必须来自真实任务结果、对比必须先选定数据与调用预算；合成数据只能验证测量管线，不能代替 S05-B 结论。

## Consequences

- 早评审不再可能复活被宿主或下游清空的步；普通工具后续步的注入保持不变（原测试仍覆盖）。
- 失败行现在保留失败前已知的调用数、token 与 attempts，并显式标记 `usageIncomplete`；0 调用的配置错误仍记为 0，不虚报。
- 语义分类按"渲染后的证据"去重：叙述、心跳、无关事件不再重复付费；新证据或新任务仍会重新分类。
- 反馈定位始终带候选序号，长 ID/同名候选也能定位；失败反馈不再把"判据全过"说成"没有明细"。
- 周期汇总的 `reservedCalls` 是每周期预留，跨重载的周期不再合并；看板能直接看到周期、跳过原因与用量不完整。
- **S05-B 仍未完成**：真实标注样本与真实模型对比报告继续待办，`proposed/` 里的计划 Markdown 保持 `proposed`，未调整任何阈值或轮次。
- 本批不改判定逻辑与评分缓存身份（语义指纹只是路由去重键，不参与评分缓存），`lib/` 随本批重建。
