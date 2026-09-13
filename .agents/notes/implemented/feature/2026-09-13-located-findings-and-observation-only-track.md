# Agent Note: 判官定位诊断与 smart 的 track 观察式调度（P04）

Status: implemented

## Problem

自动验收失败时的反馈能说清「哪条判据没过、多少分」，却说不清「具体缺什么、要怎么验证」。Agent 拿到的是
「重新读需求、自己看输出」这类泛化指令，而真正的信息（判官在分析里指出的那一处缺失）被丢掉了——它躺在
决策快照里，而快照按设计**只给人看**，从不进入判定路径。

同一件事在停止边界上更明显：`verifier_track` 无论分数高低都会 steering。分数达标时发「准备最终交付证据」，
分数偏低时发「继续未完成的工作」——后者对已经知道自己在做什么的 Agent 是零信息，而且它把本轮唯一一次
stop-boundary 判定让给了一句套话，真正的判定（最终验收）要等到下一个边界才可能发生。

## Decision

**(a) 同一次调用里的可选定位诊断**

- `core.ts` 新增 findings 契约 `buildFindingContract(target, evidence)` 与 `<finding criterion|checkpoint="…"
  evidence="…" action="…">…</finding>` 格式，**每调用至多 3 条**（`MAX_DIAGNOSTICS`）。契约插在**判据之后、
  评分标记之前**：判据仍是唯一在尾部变化的元素（per-criterion 前缀缓存不受影响），`<score_A>`/`<c1>` 仍是
  回答的最后一段（解析不受影响）。**不额外购买「解释模型」**。
- `parseDiagnostics(text, visible)` **必须传入该提示词实际渲染的** criteria / checkpoints / evidence：属性未知、
  evidence 不在可见集合、criterion（或 checkpoint）没被提供、正文为空、目标缺失的条目**一律丢弃**，
  **绝不回显**给 Agent。解析是 **fail-soft**：丢条目不会让整次验收失败；`extractScore` 的 fail-closed 语义不变。
- 引擎在 `scoreOne`（比较）与 `track`（进度）里解析，按 `diagnosticKey` 去重，整次调用聚合上限
  `MAX_AGGREGATED_DIAGNOSTICS` = 6，字段落在 `CompareResult.diagnostics` / `SelectResult.diagnostics` /
  `track().diagnostics` 上，**永不进入评分算术**。诊断随评分缓存条目一起存取（缓存键＝渲染后的提示词，
  条目只回答它自己那份证据），`CachedPairScore.diagnostics` 为可选字段，旧条目照旧可读，缓存 identity 不变。
- `auto.ts` 的 `automaticFeedback(...)` 追加诊断块；**一条都没有时明确写「判官没有给出可定位的原因」**，
  不编造原因；`renderDiagnostics` 把 locator（criterion/checkpoint + evidence）放在正文之前，整段仍受
  4000 字符反馈上限约束。工具结果新增 `diagnostics`，`compare`/`select`/`track`/`current_session` 的 schema 同步声明。

**(b) smart 的 track 观察式调度（strict 不引入）**

`track` 从「判定」降级为「观察」：

- 未完成且有可定位诊断 → 只发这些诊断（不再附「继续未完成的工作」）；
- 已完成，或分数偏低但**没有**可定位诊断 → **同一停止边界**直接落入最终验收，并记一条
  `track-completed` / `no-diagnostics` 的 skipped 路由观测；
- 若该边界既不满足验收资格、也拿不到诊断（没有可交给门控的东西），**保留**原来的续步提示——
  不允许出现「既不给诊断也不给指引」；
- 落入验收前把本边界的 `forcedFromSeq` 就地补成 `admittedLastSeq`：`commit` 刚刚设了
  `finalRequiredFromSeq`，但本边界读取的是**之前**的值，不补就会因为旧的 `undefined` 而提前 return，
  把验收推到下一个边界，白跑一次停止边界。

低进度**不会**跳过必须进行的最终验收；预算、取消、freshness 检查一律沿用原路径。**strict 保持原样**
（不引入新调度），README 已说明生效模式。

## Alternatives considered

1. **另发一次「请解释失败原因」的模型调用。** 不采用。方案明确禁止为解释再买一轮：同一次调用里已经有过
   逐判据分析，让判官顺手写定位行比再花一次调用便宜得多，也不会引入第二个可能自相矛盾的判决。
2. **让诊断引用自由文本（判官自己写「第 3 步的输出」）。** 不采用。无法校验的引用等于无法定位，还会把
   幻觉直接喂回给 Agent；只接受提示词里真实出现过的 evidence 标签才是可核对的最小集合。
3. **诊断解析失败就整条报错（与评分标记同样 fail closed）。** 不采用。那会因为判官多写一行而判一次真实
   验收失败，惩罚的是任务而不是判官。评分契约仍然 fail closed，诊断是附加信息。
4. **把诊断当成第四条判据参与打分。** 不采用。诊断没有量纲，参与算术会改变验收松紧——那是产品决策，
   不是本轮范围。
5. **没有诊断时由插件根据失败的判据生成一段解释。** 不采用。那正是「编造原因」，与方案要求相反；
   明确说「定位信息不足」才是诚实的。
6. **track 永远不 steering，一律转最终验收。** 不采用。有可定位诊断时那正是最该发出去的内容；
   而无验收资格时可交给门控的东西为零，此时保留续步提示才不会让任务失去指引。
7. **把新调度也用于 strict。** 不采用。strict 的语义是「不确定就阻塞并提示」，方案明确暂不引入。
8. **用 DecisionTrace 快照生成反馈。** 不采用。快照是给人看的观测，按仓库规矩不得进入判定路径；
   反馈只从正式结构化结果（`diagnostics`）生成。

## Consequences

- 默认提示词文本发生变化（新增 findings 契约）→ 既有评分缓存自然失效一次；缓存 **identity 未变**，
  因此不需要升 `cache.ts` 的 `version`。评分、阈值、重复轮次、最终验收规则**都没有改动**。
- 失败反馈现在能说出「哪条判据、引用哪份证据、建议怎么验证」；抓不到定位时明确承认，而不是给一句套话。
- smart 下 track 边界最多省掉一次只有泛化提示的续步：预算与 steering 次数下降，但**验收判定不减少**——
  省掉的只是那句「继续未完成的工作」。这是**实验性**调度：是否长期保留由 P05 的真实对照（arm C/D 对照
  主 Agent 续步数、误阻断、总 token）决定；回退方式是把该分支恢复为无条件 steering。
- 已知未做：诊断**不参与**离线回放（`replay.ts` 只看统计与决策快照），所以「诊断是否改善了后续实施」
  必须靠 P05 重新运行任务来测，与方案一致。
- 验证：`core.test.ts`（契约位置、逐项校验与丢弃、3 条上限、边界截断、渲染预算、「没有可定位原因」文案）、
  `index.test.ts`（当前会话判决带上诊断且过 schema；track 有诊断 → 只发诊断、无泛化提示、不转门控；
  同一 finished state 不被跳过两次 → 第二次真的购买 track 并以门控消息收尾）。
  `pnpm run verify:release` 与 `pnpm run typecheck:local` 均通过。
