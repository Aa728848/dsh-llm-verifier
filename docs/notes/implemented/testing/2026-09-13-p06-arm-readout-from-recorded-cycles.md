# Agent Note: 从已记录的路由观测里单列 P06 分臂读数

Status: implemented

## Problem

P05 的执行设计（`.agents/notes/proposed/testing/2026-09-13-real-evaluation-samples-and-four-arm-controls.md`）把过程选优要报的指标列得很清楚：触发率、跳过原因分布、备选胜出率、**有效替换率**、重复/相同候选率、回退率、额外调用数，并要求按「带失败证据 / 不带」分臂报告。这些数字**已经全部写在统计行里**，但离线回放（`scripts/eval-replay.mjs`）只汇总 `route` 观测的周期/阶段/触发点，过程周期落不进任何阶段桶，于是每次要看读数都得人肉翻 `statistics-v1.json`。

另一个更隐蔽的问题：`ReplayRouteObservation` 的宽松读取器只认 S05-A 的字段，P06 新加的 `replayed` / `generatedCalls` / `judgeCalls` / `sameCandidate` / `alternativeAugmented` 会被**静默丢掉**，因此即使手工统计也读不到分臂。这与 `statistics.ts` 里 `cleanRoute` 那次「新增字段忘记加白名单就静默消失」是同一类缺陷，只是发生在读取侧。

## Decision

`src/replay.ts`：

- `ReplayRouteObservation` 增加 `replayed` / `generatedCalls` / `judgeCalls` / `sameCandidate` / `alternativeAugmented`，`parseRouteObservation()` 同步解析（宽松、未知即忽略，旧文件照旧可读）；
- `ReplayInvocation` 增加 `outcome`（来自 `verdict.outcome`），因为过程周期的终局只写在 verdict 里；
- 新增纯函数 `summarizeProcessCycles(invocations)`：只取 `route.destination === 'process'` 的行，把 `stage: 'skipped'` 记成跳过（未购买），其余记成购买，并输出终局分布、跳过原因分布、`replayed` 三态、**有效替换率**（`candidate` ÷ 购买数）、相同候选数与占比、两条臂各自的替换率、以及新增调用数（生成 / 裁判拆分）。分母为 0 时返回 0，**绝不产生 NaN**。

`scripts/eval-replay.mjs`：把该汇总接进 `--json` 输出与文本报告（新增「P06 process selection」一节），沿用原有的 `--dir` / `--samples` 参数，不新增任何命令行开关。

`README.md`：离线回放一节从「四个问题」改为五个，并写明这一节是 P05 中 P06 指标的现成读数、且**仍然只是历史回放**，不能替代真实任务对比。

验证基线：`pnpm run typecheck` 与全量测试通过（`replay.test.ts` 新增 2 条：一条覆盖分臂与「被撤回的胜者算原回复」这一边界，一条覆盖零购买时比率为 0 而非 NaN）；在作者机器上的真实数据上跑通 `node scripts/eval-replay.mjs`，过程一节正确输出 `purchased 0 / skipped 0`（已记录会话里确实还没有过程周期）。

## Alternatives considered

1. **只改看板、不做离线读数。** 不采用。P05 要的是跨话题、跨运行的**分臂汇总**，看板是逐行展示；而且看板需要人在浏览器前面，离线脚本可以在任务跑完后直接产出可提交的报告。
2. **在 `summarizeRouteCycles` 里加一堆 P06 字段。** 不采用。过程周期既不是路由决策也不是模型调用，它的终局也不是对任务的判决；塞进同一个结构会让「周期 / 行 / 调用」的口径重新纠缠，而这正是那个汇总刻意分开的三件事。
3. **让脚本自己解析 `statistics-v1.json`。** 不采用。读取的宽松规则与 `parseStatisticsRecords` 只该有一份，否则旧记录在脚本里会以另一种方式失败。
4. **同时把成本与 token 也按臂拆开。** 暂不采用：每个过程行的 `stats.calls` 已经给出该周期的新增调用数，而 token/费用按臂拆分需要把 `stats` 一并带进 `ReplayInvocation`，那是下一次改动（P05 真跑起来之后再按需要加）。

## Consequences

- P05 里 P06 那组指标从「手工翻 JSON」变成一条命令；两条臂（`autoProcessFailureContext` 开 / 关）第一次可以在同一份汇总里直接比。
- 读取侧的字段缺口被补上：过程观测里的交付与分臂信息不再静默消失。
- **不产生任何结论**：这一节读的是历史记录，样本里目前一个过程周期都没有；「过程选优是否值得」仍然只能由真实任务对比回答，阈值与各重复轮次一律不动。
- 与 P04 的关系不变：`track` 的观察式调度同样等待同一批真实对比数据。
