# Agent Note: 离线聚合黄金数据与算法契约表述修正

Status: implemented

## Problem

F08（P1）指向两点：文档口径与一致性保障。

**表述失准。** README 宣称"上游算法完整移植……唯一的例外见下节"，而实际上存在多处**刻意**的本地变体：PPT 聚合（上游最后把 ring 与**完整** pivot pairs 一起累积；本项目按无向边删掉与 ring 重合的 pivot 边，这不仅减少请求，还改变 `wins/counts` 权重）、同 seed 不保证相同 ring（上游 `random.Random(seed)` vs 自带 `seededRandom`）、解析失败 fail closed、重复候选短路、两候选赛制、温度、K=1 位置定向、宿主门控。把它们压缩成"唯一一处差异"会让后续读者误判哪些行为是上游契约。`AGENTS.md` 也沿用了"与上游唯一的刻意偏差"的措辞。

**一致性保障依赖可选仓库。** `parity.test.ts` 的两项核心比对在缺少同级 `../llm-as-a-verifier` checkout 时整体 skip（不是失败），因此 CI 在没有该仓库时无法发现算法漂移。

## Decision

**文档**（`README.md`、`AGENTS.md`）：

- README 的 `与上游的一处已知差异` 改写为 `与上游的关系：共享算法基础与本地变体`，按**评分 / 赛制 / 运行策略**三层分别列出契约与本地选择；明确"改动其中任何一项都要同步本节、AGENTS.md 与 parity.test.ts"。
- `AGENTS.md` 的对应条目从"唯一的刻意偏差"改为"评分上的刻意偏差之一"，并指向 README 同节与离线 fixture。
- README 的 PPT 段落补注"环上重合边去重是刻意的本地变体"，链接回该节。

**离线黄金数据**（`parity.test.ts`）：

- 新增 `offline aggregation fixtures`（不依赖 Python）：
  - 冻结 `pivotRoundPairs(4, [3,2])` 与 `pivotRoundPairs(7, [1,4,5])` 的期望表（上游一致项）；
  - 用固定 ring `[(3,2),(2,0),(0,1),(1,3)]`、固定 pivots `[3,2]` 与一组固定 reward 复现两种聚合：上游加权（ring + 完整 pivot pairs）胜者为候选 **3**（≈0.5679315652），本地去重胜者为候选 **0**（≈0.5408197771）。两边都非平局，因此这是**刻意**的语义差异，各自拥有独立期望值。
- Python 实跑仍保留为补充；但"刻意差异"与"上游一致项"现在都能在没有同级 checkout 时被 CI 检出。

## Alternatives considered

1. **回滚本地去重、改为逐位上游泳的"ring + 完整 pivot pairs"**。不采用。报告要求先准确记录差异、再由数据决定是否改；回滚会同时改变请求数与权重，需要独立评测。
2. **把 Python 仓库纳入 CI 依赖**。不采用。仓库以 peer 与同级 checkout 的方式可选存在；引入外部 checkout 会让 CI 更脆。
3. **只改文档、不加 fixture**。不采用。评审明确要求"上游一致项必须一致，刻意差异必须有各自期望值"。
4. **把聚合差异也描述成"上游缺陷"**。不采用。上游在其 K≥2 流程里逐次交换 A/B 槽位，聚合语义没有绝对优劣，这里只是取舍。

## Consequences

- 文档与 `AGENTS.md` 不再暗示"除一处评分差异外逐位一致"；读者能直接看到评分、赛制、运行策略三层契约。
- CI 无需 Python checkout 也能捕获 `pivotRoundPairs` 与两种聚合的漂移；`parity.test.ts` 从 6 项增至 8 项（2 项仍按条件 skip）。
- 已复核：离线期望值与评审报告给出的数值逐位一致（本地 0.5408197770672848，上游 0.567931565211631）。
- 未改变任何评分语义或缓存身份，因此不需要升 `engine.ts` 的缓存 `version`。
