# Agent Note: 交付阶段直验收与平局/相同候选反馈

Status: implemented

## Problem

两处自动调度与反馈的失真：

1. **交付阶段仍先买进度评分。** `track` 要先由结构化路由产出并执行（3 次判官调用）才可能置 `preferFinal`，也就是说"活儿已经干完并跑过验证"的任务还要再付一次进度分，而这一次分数并不会改变下一步行动。Todo 全部完成本身也只被当作渲染检查点的素材，没有参与调度。
2. **自动反馈把"并列"说成"赢家"。** `select` 的反馈是 `Ranking: ... Proceed with <label>`，而 `ranking` 是按分数降序、同分按序号升序的**稳定排序**：最高分并列时，第一个候选会被描述成明确赢家。`compare` 打平时虽然文案是 `Winner: tie`，但逐字节相同的候选也走同一条分支，读起来仍像"真的比过并且打平"。最终验收失败时只报分数与未达标判据，不说明判官实际读了哪段区间，也不说明是否因长度上限漏看了证据。

## Decision

### S03：交付阶段跳过进度路由，直接最终验收

- `router.ts` 新增 `inspectDeliveryPhase(events)`：仅当**本任务最新 Todo 快照非空且全部 completed**、且存在一次**验证形状**的观测输出（沿用 `isEvidenceOutput` + `VERIFICATION_SIGNATURES`，不新增名单）时才算交付阶段，并返回由"最新 Todo 快照 seq + 最新验证运行的 seq/成败"派生的 `signature`。它只看状态、不看验证成败——失败的运行正是裁判必须看到的证据。
- 停止边界（`index.ts`）在结构化路由之后计算 `deliveryFastPath`：交付阶段成立、`preferFinal` 未置、且当前决策是 `track` 或没有决策时才生效；**compare/select 优先**（未处理的候选选择仍然照常执行）。生效时丢弃 `track`、记录 `delivery-phase` 跳过原因，并在同一停止边界直接跑最终验收。完成信号由 `AutoVerifierRouter.consumeDelivery()` 消费一次：相同证据不会反复跳过路由，只有新工作改动 Todo 快照或出现新的验证运行才会改变签名、重新激活。没有验证证据、Todo 重开、最终验收失败都回到原路径。
- `preferFinal`（track 达标置位）与交付快路径是两个独立来源，互不覆盖；最终验收阈值、判据、轮次与计数规则完全不变。

### S04：按真实结果措辞，并给可定位的反馈

- `auto.ts` 新增纯函数 `compareRouteFeedbackDetail` / `selectRouteFeedbackDetail` / `topScoreIndices`：唯一最高分才报 `Winner: <label> (<share>) over ...` 或 `Proceed with <label>`；最高分并列列出并列集合、明说"没有唯一最佳、引擎列举只是稳定排序"；逐字节相同说明"未做质量比较、不要再买"；判官没有返回可用分数时说明"没有可执行结果"。定位信息是**标签 + 标识 + 事件 seq**，不复制候选正文。
- `automaticFeedback` 增加可选定位参数：报告判官实际读到的区间（`session <id> seq <from>-<to>`）、因长度上限省略的字符数，以及"没有逐项判据可依据"的如实说明；不编造文件名、行号或验证命令。
- 反馈总长由 `MAX_ROUTE_FEEDBACK_CHARS = 4000` 硬限（`routeFeedback` 与最终失败反馈都过 `sanitizeVerifierText`），固定文案、逐项定位与正文预算一起计入；定位小段按项分摊。文案确定性，不新增模型调用，不改 engine 排名、分数与判据阈值，也不改显式工具的 `index/ranking/scores/winner` 返回语义。

## Alternatives considered

1. **让 Agent 自己看 `ranking`/平局就明白。** 不采用：`ranking` 是稳定排序，模型把第一项当赢家正是实测出的误读方式；反馈层必须显式区分。
2. **给近似平局设一个固定 gap 阈值。** 暂缓：缺少当前模型/通道下的标注证据，随意阈值会把真实差距当作平局；先如实报告完全并列，阈值由 S05-B 的评测决定。
3. **用一段判官解释生成平局/失败原因的文案。** 不采用：会新增模型调用、引入不可控输出，且与"决策快照只供观察"的边界冲突；确定性文案足够。
4. **Todo 全部完成即放行。** 不采用（计划本身已否决）：Todo 是阶段信号，是否通过只能由 `sessionAccepted` 决定；本实现只把"送去验收"提前，不放宽任何判据。
5. **交付阶段无条件跳过结构化与语义路由。** 不采用：会跳过尚未处理的候选选择；只在"决策是 track 或没有决策"时生效，compare/select 仍然优先。
6. **把完成信号写进 `finalRequiredFromSeq` 以复用强制门控。** 不采用：那会让失败验收在同一证据上无限重复购买，并掩盖"需要新证据才能重新激活"的语义；改为一次性 `consumeDelivery` 标记。

## Consequences

- 交付场景的调用数从"track 3 + final 6"降为"final 6"（无缓存、无重试、单裁判、三判据），`index.test.ts` 通过真实注册的停止钩子锁定：交付阶段只跑最终验收且记录 `delivery-phase`；同一完成状态第二次边界会重新购买 track；出现新验证运行后快路径重新激活；失败的验证输出仍出现在判官提示词里。
- 平局、相同候选与失败验收的自动反馈不再制造虚假赢家或虚假行动依据；`auto.test.ts` 锁定文案边界（唯一/并列/相同/无分数/超长定位），`index.test.ts` 锁定比较打平经真实钩子仍报"NO unique winner"。
- 两处改动都不增加模型调用、不改变阈值与缓存身份，因此无需升 `engine.ts` 的缓存 `version`；`lib/` 随本批重建。
