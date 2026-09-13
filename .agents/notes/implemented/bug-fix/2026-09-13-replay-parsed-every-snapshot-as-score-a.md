# Agent Note: 修复回放工具把所有快照都当 `<score_A>` 解析

Status: implemented

## Problem

解析器回放最初假定每条快照都是成对比较的回答（`<score_A>` / `<score_B>`）。但快照里还有两类：

- `track` 的回答是 `<c1>…<cN>`，而且保存的是**最后一个检查点**，方向与成对比较相反（进度是 A=否 / T=是，成对是 A=最好 / T=最差）；
- 语义路由的分类回答**本来就没有分数标签**。

于是 `track` 与路由调用被误报 `unreadable`——一个用来发现回归的工具自己制造假回归，把「18 条快照全 match」的真实结论掩盖掉了。

## Decision

1. `replay.ts` 按**内容形状**选标签，而不是按调用顺序或工具名硬编码：
   - 有 `<score_A>` → 成对/验收通道；
   - 只有 `<cN>` → 取**最后一个**检查点并做方向反转；
   - 两者都没有 → `not-scored`（不是错误，是设计如此）。
2. 报告里为 `not-scored` 单列一栏并说明含义，避免读者把它当成 drift。
3. `replay.test.ts` 覆盖三种形状（含 `track` 的反向语义）。

## Alternatives considered

1. **按 `toolName` 选标签**：否决。同一条记录里的调用可能混合形状（best-of-N 的草稿调用就没有分数），工具名不是形状的可靠代理。
2. **把 `not-scored` 计入 drift**：否决。路由分类本来就没有分数，计入 drift 会让报告永远是红的。
3. **遇到无法解析就抛错**：否决。回放是诊断工具，要对历史数据（含旧格式）给出部分结论；抛错等于让它对旧数据失效。
4. **只回放 `verifier_current_session`**：否决。`compare` / `select` / `track` 的解析器同样会回归，而它们的快照就在同一份文件里。

## Consequences

- 解析器回放对四类工具都成立：本机实测 114 条捕获回答 match 114、drift 0、unreadable 0、not-scored 0。
- 报告新增 `not-scored` 语义，读者不会再把「按设计没有分数」当成回归。
- 教训：诊断工具自身也需要回归测试（`replay.test.ts`）。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `3dc50c6`；
> 内容取自 `AGENTS.md` 的 `replay.ts` 一行、`src/replay.ts` 的标签选择逻辑与 `scripts/eval-replay.mjs` 的输出。