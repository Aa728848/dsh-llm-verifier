# Agent Note: 离线策略评测骨架（S05-B 的可运行一半）

Status: implemented

## Problem

S05-B 要求用**真实任务标签**评价触发、误放行、重复调用与额外成本。它必须先有可离线运行的一半，否则第一笔真实模型预算会被花在结构上可测的部分（触发覆盖率、周期计数、解析一致性）上；而且没有离线基线时，真实对比出现差异也无法判断是策略问题还是测量问题。

已有的 `scripts/eval-replay.mjs` 只覆盖两件事：阈值扫描与解析器 drift。S05-A 新增的 `route` 观测、S02 的早评审比例、以及"触发是否命中真实标签"都还没有测量通路；同时当时的 `parseStatisticsRecords` 会直接丢掉 `route` 与 `stats.calls`，周期与真实评分调用无法区分。

## Decision

- `replay.ts` 扩展为三段：
  1. `parseRouteObservation` + `parseStatisticsRecords` 保留 `route` 与 `stats.calls`（宽松读取，坏观测被丢弃而不是让整条记录消失）；
  2. `summarizeRouteCycles` 汇总周期数、分类/执行/最终/跳过行数、分类无执行数、取消、用量不完整、早评审执行数、**保守预留调用**与**真实评分调用**，以及按触发点/去向/跳过原因的计数；
  3. 标注样本层：`EvaluationSample`（六类固定分类：`code / research / writing / candidates / long-task / conversational`，含 `shouldReview` 与可选 `expectedPhases`）、`evaluateSample`、`summarizeEvaluation`、`parseEvaluationSample`。
- `evaluateSample` **复用生产函数**（`analyzeStructuredRoute` / `semanticRouteHint` / `inspectDeliveryPhase` / `analyzeAutoTask`），不复制调度状态机，因此离线数字不会与线上漂移；它不发任何模型请求，语义线索只表示"值得分类"。
- `scripts/eval-replay.mjs` 新增 `--samples <目录>` 与路由周期输出；JSON 模式同时输出 `routeCycles` 与 `evaluation`。
- `replay.test.ts` 锁定：周期/行/预留/真实调用的分离、坏观测不致命、七个标注样本的 precision/recall（4 命中 / 1 误触发 / 2 正确跳过）、交付阶段样本仍走生产判定，以及样本 schema 的宽松校验。

## Alternatives considered

1. **新建 `src/eval.ts` 并写一套独立的调度回放。** 不采用：那等于复制 index.ts 的编排（提升、交付快路径、最终验收顺序），一旦线上改动就会漂移；复用生产检测器并只测量检测层是本轮能诚实维护的边界。
2. **现在就做真实模型对比。** 不采用：计划明确要求先选定数据与调用预算；没有真实标签与预算的对比只会产出不可复核的结论。
3. **由代理"补足"30 条真实标注样本。** 不采用：标签必须来自真实任务结果；合成夹具只能验证测量管线，把它当作 S05-B 的样本会伪造结论。
4. **只用统计记录、不引入标签。** 不采用：没有标签就算不出 precision/recall 与误放行，而这正是 S05-B 的核心问题；统计汇总保留为"周期与成本"那一层。

## Consequences

- 现在可以**零模型调用**地核对：周期与真实评分调用的区分、分类无执行比例、早评审比例、触发覆盖率与短语阶段覆盖；`node scripts/eval-replay.mjs --samples <目录>` 在放入真实样本前会报告 0 条样本而不是失败。
- 报告明确以**样本数**而非模型调用数为单位，并声明 a small set 不能证明低误放行率——避免把离线回放读成真实验收证据。
- **S05-B 仍未完成**：真实标注样本与真实模型对比报告尚未交付，因此 `.agents/notes/proposed/architecture/2026-09-13-smart-routing-strategy-improvement-plan.md` 按它自己的约定继续保持 `proposed`；在报告产出前不调整任何阈值、置信度或重复轮次。
- 本批不改变判定逻辑与缓存身份，`lib/` 随本批重建。
