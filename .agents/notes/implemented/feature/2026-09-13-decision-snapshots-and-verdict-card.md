# Agent Note: 决策快照与判决卡 —— 让「为什么这么判」可查

Status: implemented

## Problem

统计只回答「跑了多少次、花了多少 token」，回答不了「为什么判官这么判」。而插件最贵的路径（会话验收、best-of-N）
判决一跳就没有任何原始证据可查：提示词、判官原话、每次调用的分数全部留在内存里，进程一退就没了。
后续要做的评测（阈值扫描、解析器回归）也因此没有数据可用。

## Decision

1. `decisions.ts`：每次**真实**模型调用（缓存命中 / in-flight 合并不算）把 `{label, channel, prompt, output, score}`
   报给 `DecisionTrace`，由 `index.ts` 的 `record()` 落到本话题的 `verifier/decisions-v1.json`；每话题最近 40 条，
   看板按 id 单条拉取（`{kind:'decision', id}` 走同一条 `/api/llm-verifier/statistics` 路由）。
2. 双重限长：单条 prompt 8k / output 4k，单条记录 3 万字符；超长文本用 `boundCaptureText` **保留首尾两端**并标注
   省略字符数。会话验收的提示词超过 10 万字符，只留头部等于留下指令、丢掉裁判真正在看的轨迹尾部（实测踩到）。
3. 写入前一律过 `sanitizeVerifierText` 脱敏：快照不得持久化裁判自己都没看到的秘密。
4. 看板新增判决卡（`formatVerdictDetails`）：按工具类型渲染分数 / 阈值 / 逐项判据 / 胜者 / 检查点曲线，
   并可展开查看该次调用的快照。
5. 开关 `captureDecisions`；快照**只是观测**，永不参与判定，也不进提示词。

## Alternatives considered

1. **只存提示词哈希**：否决。哈希能查缓存，但回答不了「判官当时看到什么、说了什么」。
2. **头部截断（只留前 N 个字符）**：否决，实测反例：会话验收提示词超过 10 万字符，只留头部会保留指令、丢掉被判分的轨迹尾部。
3. **按完成顺序取前 N 条**：否决。并发扇出下完成顺序等于网络顺序，同一路径每次留下的判据都不一样（这条后来在
   best-of-N 上又被踩了一次，见 `implemented/feature/2026-09-13-best-of-n-generation-side-selection.md`）。
4. **把快照塞进提示词或判定路径**：否决。它是给人看的，参与判定会同时放大成本与失真。
5. **不做脱敏**：否决。脱敏是「发送给裁判」的前置条件，快照必须与提示词同一口径。

## Consequences

- 判决可解释：看板能回答「这条判据为什么没过」，并可展开原始回答。
- 离线回放（阈值扫描、解析器 drift）有了数据来源。
- 上限是硬边界：超长记录按调用数平分窗口；后续为 best-of-N 放大到 32 次调用并改成均匀间隔取样。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `c11f60f`、`7dc3549`、`9178b36`；
> 内容取自 `AGENTS.md`「决策快照只是观测」一条与 `src/decisions.ts` 的实现。