# Agent Note: 路由周期计数与可观测用量

Status: implemented

## Problem

前一轮修完了验收回读、证据边界与预算上限等实现缺陷，但自动路由的**计数单位**仍然错误：语义分类与它解析出的 compare/select/track 各自调用一次 `reserve`，先 `commit` 释放分类预约、再为执行重新预约。于是一个逻辑上的"分类＋执行"周期消耗了**两次** `autoRouteMaxPerTask`，而默认值恰好就是 2——"计划预审（1 次）→ 分类（1 次）→ compare"永远拿不到执行额度，只能被拒后静默落到最终验收；离线的复现里此时只用了 2 次模型调用。把两次预约拆开还丢掉了原子性：`commit` 与第二次 `reserve` 之间存在窗口，任务切换、证据变化或并发预约都可能让分类结果与执行额度对不上。

观测侧同样缺口明确：统计记录只有 `verdict.phase/outcome` 与模型调用计数，无法区分"分类完成但执行未发生""同一证据已路由""因预算拒绝"与"已评审"，也无法把**路由周期**、**评分调用**与**传输尝试**分开计数；请求在返回 usage 之前失败时，记录会退化成一次看起来完整的零成本调用。

## Decision

### S01：一个分类与执行周期只消耗一次路由尝试

- `router.ts` 的 `Reservation` 增加 `expectedCalls` 与 `attempt`；新增 `promote()`：仅允许把 in-flight 的 `semantic` 预约提升为 `compare/select/track`，**不触碰**任务/会话尝试计数器，只原子地复核"in-flight 归属 + 同任务 + 决策 fingerprint 未完成 + `taskModelCalls + expectedCalls + minFinalModelCalls` 不超任务/会话上限"。提升成功即把原分类指纹记入 `completed`（分类的钱已经花了，同一快照不再重复分类），并把预约的 phase/fingerprint/`expectedCalls` 改写成执行侧。
- `index.ts` 的停止钩子：语义分支解析出可执行决策后直接 `promote`，成功则把该预约记为 `cycleReservation` 交给执行块复用；执行块用 `cycleReservation ?? reserve(...)`，绝不会为同一个周期再买一次尝试。提升被拒时记录 `classification-only-budget` 并结束周期——既不说成 `none`（对工作没有任何决定），也不说成已评审。`none`、低置信、非法引用、无可行决策、超预算同样消费周期；每条路径都落一条带 `cycleId` 的 `route` 观测。
- 语义路径补上了此前缺失的 `completedFingerprint` 去重（`already-routed`），与结构化路径的 `processed` 回调同口径。

### S05-A：可观测用量与真实周期记录

- `statistics.ts` 新增可选 `RouteObservation`：`cycleId / trigger / stage / destination / attempt / reservedCalls / skipReason / evidenceKept / evidenceOmitted / evidenceChars / usageIncomplete / canceled`。分类行与它提升出的执行行共享同一个 `cycleId`；`cleanRoute` 只做边界与枚举校验，字段非法就整条丢掉而**不连带丢调用记录**；`isRecord` 对 `route` 只做宽松对象检查，旧版没有该字段的 `statistics-v1.json` 照常加载。
- `caller.ts`：最终失败的请求把已花费的尝试次数挂在错误对象上（`requestAttempts`，非枚举 Symbol），通道被 provider 拒绝后回退到显式标签的完成对象带 `channelFallback: true`（仅"真的发过直连请求后被降级"，能力探测发现无路由不算）。
- `engine.ts`：`RunStats` 增加可选 `usageIncomplete` 与 `channelFallbacks`；`compare/select/track` 把失败 judge 的尝试数计入 `attempts` 并置 `usageIncomplete`，把降级次数计入 `channelFallbacks`。`index.ts` 的 `statsFrom` 与五个工具的 `statsSchema`（可选字段）同步；`record()` 的 catch 路径把失败请求的尝试数写进统计并把观测标为 `usageIncomplete`。

计数契约（单裁判、三条判据）：结构化 compare=1 周期/6 次调用；分类→compare=1 周期/1+6；分类→select=1/1+9；分类→none=1/1；分类成功但执行不足=1/仅分类调用；`track`=1/3；计划预审与单个 Team 闸各 1；最终验收不占路由尝试、占最终验收额度。

## Alternatives considered

1. **直接提高 `autoRouteMaxPerTask` 默认值。** 不采用：它不修正"一个周期花两次"的计数错误，只会同步放大最坏成本，也让 `autoMaxModelCallsPerTask` 的预算语义更难解释。
2. **在 `index.ts` 里"不 commit 分类预约、直接改 fingerprint"。** 不采用：这等于把预约状态机的语义泄漏到装配层，任务切换、取消与失败分支很容易留下悬挂的 in-flight 预约；提升必须由持有状态的 `AutoVerifierRouter` 原子完成。
3. **为分类、候选、进度、计划、团队各设一组额度。** 首轮不采用：配置与调度复杂度过高，且不能解决原子性；一个受限周期 + 独立最终验收已经覆盖。
4. **把"用量不完整"做成独立计费字段或单独存储。** 不采用：S05-A 的目标是如实观测，不是新建计费系统；作为可选 `stats` 字段既能让旧记录继续读，也不必改判定路径。
5. **首轮实现预算自动退款（缓存命中/重试后返还）。** 不采用：保守预留与真实观测是两件事，自动退款会让并发预约共享的余额产生透支窗口；统计如实记录实际消费即可。

## Consequences

- 默认 2 次尝试即可完成"计划预审 → 分类＋compare"，且剩余额度仍可支撑第二个独立周期；`router.test.ts` 锁定提升恰好用满、超出 1 次拒绝、`none` 也消费周期、跨任务/非 in-flight 拒绝提升；`index.test.ts` 通过真实注册的 `tools/pre-execute` 与 `agent/turn-stopping` 钩子锁定"分类＋执行共用一个 cycleId"与"分类成功但预算不足"的观测。
- 统计里新增的是**诊断口径**：周期不是模型调用，诊断行不是购买；`usageIncomplete` 明确表示"token 未知"而不是 0，`attempts` 仍保留已知请求。旧 `statistics-v1.json` 无需迁移。
- 提升的原子检查复用了与 `reserve` 相同的最终验收 floor，因此"先分类、再无钱执行"不会把强制验收的额度吃掉。
- 发现但**本批未修**的相邻问题：`installVerifierSettings` 在设置服务缺席时以 `entry`（一个 `ResolvedConfig`）为源，而 `resolveConfig` 会再次读取 `config.extraJudges`——`ResolvedConfig` 不携带该字段，于是多裁判配置会被丢成单裁判。真实宿主有设置服务时由 schema 值提供 `extraJudges`，不受影响；测试与无设置服务的主机会命中。已在 `index.test.ts` 的用例中绕过，留待单独修复。
