# Agent Note: 决策快照与统计行共用同一个 invocation id

Status: implemented

## Problem

统计看板「最近调用」的每一行都带一个「决策快照」按钮，但它从来没有取到过快照：点击后固定返回
`decision snapshot not found: it was pruned, never captured, or belongs to a deleted topic`。

这不是"已淘汰/未捕获/话题被删"中的任何一类。实测（本机 `~/.dsh/sessions` 下 7 个话题）：

- 每个话题里 `statistics-v1.json` 的记录 id 与 `decisions-v1.json` 的记录 id 交集恒为空；
- 截图那一行（`session-90fd9476…`，09/14 09:41:45，`verifier_current_session`，score 1.0 / 阈值 0.65 / winner A，
  stat id `4c9ba7cf-b813-4c84-89ce-cab2c1b3af5f`）在**同一话题目录**里确实存在对应的 `phase: 'final'` 快照
  （id `cf4c4a2d-4fc8-4f40-9494-c302eec342e9`，6 次调用，正是最终验收的 6 次判官调用）。

根因是两个 store 各自生成随机 id：`StatisticsStore.record` 与 `DecisionStore.record` 都调用 `randomUUID()`，
而看板只能拿到统计行的 id（`src/client.tsx` 的 `toggleSnapshot(item.id)`），后端却按快照自己的 id 查
（`src/index.ts` 的 `handleDecisionQuery` → `DecisionStore.find`）。两者从未被关联过
（`git log -S decisionId` 全历史为空），所以该入口自加入起就没有通过一次。

## Decision

**让一次 invocation 只用一个 id**：统计行与它的决策快照共享同一个值。

- `decisions.ts`：`DecisionInput` 新增可选 `id`，`record()` 用 `idOf(input.id)`（空/非法回退 uuid）。
- `statistics.ts`：`InvocationInput` 新增可选 `id`，`record()` 同样回退 uuid。
- 普通路径（显式工具、自动 compare/select/track、最终验收、best-of-N）：`record()` 先写统计行并接住返回值，
  再把 `invocation.id` 交给 `decisions.record`。
- P06 过程选优路径：快照在 `compare`/`select` 接缝里**先**写（此时统计行还不存在），因此接缝把
  `decisionId` 随引擎结果一起返回，`ProcessCycleReport.decisionId` 一路带到 `deps.record`，统计行以它作为自己的 id。
- 客户端不改：它本来发送的就是统计行 id。

## Alternatives considered

- **在统计行上新增 `decisionId` 字段，客户端改读它**：语义更直白（"这一行有没有快照"可判），但要同时改记录形状、
  客户端类型、加载校验与统计行的写入顺序（P06 路径本身就是快照先写），改动面比"id 合一"大一倍，
  而两者表达的是同一个事实。
- **后端按 `(sessionId, startedAt, phase)` 回退匹配**：快照记录里根本没有 sessionId，只能靠同话题 + 时间窗猜，
  与仓库"身份用精确值、不要启发式"的一贯做法冲突，而且匹配错会把别的调用的提示词显示给用户。
- **离线迁移历史记录**：见"后果"一节，历史记录不迁移。

## Consequences

- 新产生的调用：看板行 → 快照的查找必然命中（`index.test.ts` 用真实装配 + 假流跑通了
  `statistics` → 行 id → `decision` 的端到端回归）。
- **历史记录仍然取不到快照**：它们写入磁盘时两个 id 已经各自生成，没有任何信息可以把它们重新对应起来。
  今后这类红字的含义收敛为"这一行确实没有快照（未捕获，或已被每话题 40 条的环形缓冲淘汰）"。
- 统计行与快照行现在是同一 id 的两种视图：删除/裁剪其中一边不会影响另一边的可读性，
  但"id 相同"这一点已成为两者的隐含契约（两处 `record()` 的注释已写明）。
- P06 的 `decisionId` 只在接缝真的写了快照时才有（全部命中评分缓存 → 无调用 → 无快照），
  此时统计行照常拿到自己的新 uuid，按钮报"没有快照"，与事实一致。
