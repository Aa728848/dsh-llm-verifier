# Agent Note: 修复路由额度饿死最终验收（并让达标的 track 直接走最终验收）

Status: implemented

## Problem

自动路由与最终验收**共用**一个尝试计数器。于是存在一条静默失效路径：路由把额度花光 → `finalReservation` 被拒 →
smart 模式下直接关 turn，而 `finalRequiredFromSeq` 仍然挂着（门控再也不生效）。整条路径只在宿主日志里留一行告警，
看板与工具返回都看不出来。

另一个浪费：`track` 的最新检查点已经 ≥ 完成阈值时，下一个停止边界仍然先跑一次自动路由，为同一句提示重复付费。

## Decision

1. `router.ts` 的 `RouterPolicy` 拆成 `maxRoutePerTask` / `maxFinalPerTask`（分别来自 `autoRouteMaxPerTask` /
   `autoVerifyMaxPerTask`）：两条计数互不占用，保证 `finalRequiredFromSeq` 一旦上闩，最终验收一定有额度可用。
2. `track` 的最新检查点 ≥ `autoTrackCompletionThreshold` 时置 `preferFinal`：下一个停止边界**跳过自动路由直接跑最终验收**
   （steering 文案不变）；该偏好由最终验收的预约消耗，验收失败后路由恢复。
3. `router.test.ts` 补回归：路由额度耗尽后最终验收仍能预约；`preferFinal` 置位后不再发生路由调用。

## Alternatives considered

1. **继续共享计数器、把总额度调大**：否决。路由仍可能吃光额度，静默失效只是概率变小，问题没解决。
2. **把最终验收也放进同一条 reservation 队列**：否决。它会被路由饿死，而最终验收是唯一决定 turn 能否结束的自动判决。
3. **每次停止边界都先 track 再 final**：否决。同一句提示重复付费，而 `preferFinal` 的信息已经足够。
4. **额度耗尽时无条件 steer**：否决（硬性规矩 5）。DSH 没有轮次预算，无条件 steer 会活锁，只能用一次性通知。

## Consequences

- 门控不再可能被路由额度静默饿死；smart 模式下不再出现「`finalRequiredFromSeq` 挂着但 turn 已关」。
- 达标的 track 直接进入最终验收，省掉一次重复路由。
- 计数口径变化会牵动 UI 预算告警的语义（`client-i18n.ts` 的 `WORST_CASE_*`），改动时要一起看。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `2cd9c39`；
> 内容取自 `AGENTS.md`「路由与最终验收的尝试额度各自独立」一条（该条随该提交写入）与 `src/router.ts` 的策略实现。