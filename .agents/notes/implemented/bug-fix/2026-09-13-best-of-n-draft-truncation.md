# Agent Note: 修复 best-of-N 草稿被输出上限截断导致整次调用零候选

Status: implemented

## Problem

`verifier_best_of_n` 的第一次真机端到端验收（`n=3`、长任务）**一份候选都没返回**，三次生成全部失败：

```text
llm-verifier: best-of-n produced 0 usable draft(s) out of 3; at least 2 are required to choose between them
  — draft 1: llm-verifier: model call failed: verifier response reached max tokens before completing its answer
  — draft 2: …（同上）
  — draft 3: …（同上）
```

两层原因叠加：

1. **语义被错误继承**：`callExplicitTag` 把 `max-tokens` 当硬错误——这对判官是正确的（判决标签可能根本没输出，
   截断的回答无法解析），但生成侧照搬同一分支，于是「草稿没写完」等于「整份草稿作废」，三份全废就等于整次调用失败。
2. **上限太小，而且是被推理 token 吃掉的**：4096 是计划里的估计值。修复后的实测给出了真实用量——一次只有两份
   短草稿的运行，会话模型（`deepseek-official/deepseek-flash`）输出 17254 token，其中 **16363 是推理 token**
   （约 8k/份），4096 在答案开始前就已耗尽。

同一轮真机输出还暴露两处可观测性缺陷：决策快照里锦标赛与基线比较的标签一字不差（两次比较判据相同），
读起来像判官对同一对候选自相矛盾；`judges[].calls` 只统计锦标赛，顶层 `calls: 6` 时 `judges[0].calls` 只有 2。

## Decision

1. 把纯文本补全抽成 `callTextCompletion(..., tolerateTruncation)`：判官路径（`callExplicitTag`）传 `false`，
   行为逐位不变、仍然 fail closed；生成路径传 `true`，截断时返回文本并附 `truncated: true`。
2. 工具输出新增 `truncated: number[]`（仍被截断的草稿序号，正常为空），进入 output schema 与 README 的截断语义说明。
   **截断的草稿仍然参与锦标赛**：排名由判官做决定，工具不该用未经判官评判的规则否决候选；文本没写完会由
   `Specification Adherence` 类判据扣分。
3. `GENERATION_MAX_TOKENS` 4096 → 16384：约等于实测单份用量的 2 倍，同时是「两份草稿 + 任务」仍留在插件
   24 万字符显式证据上限（`EXPLICIT_MAX_TOTAL_CHARS`）内的最大取值；`maxTokens` 是上限而非预留，短草稿代价不变。
4. `judges[].calls` 合并基线比较的调用数，`ok` 同时反映两次比较（`scores`/`ranking` 仍是锦标赛口径）。
5. `CompareOptions` 新增可选 `traceLabelPrefix`，best-of-N 的基线比较写入 `baseline: ` 前缀；默认 undefined，
   其余路径标签逐字节不变。
6. 回归测试：新增 `truncatedChunks()` scripted stream，断言生成侧保留截断文本、**判官侧仍然报错**；
   `index.test.ts` 断言 `generated: 3` / `truncated: [1]` / 每份草稿只消耗一次生成；`engine.test.ts` 断言快照标签前缀。

## Alternatives considered

1. **判官侧也容忍截断**：否决。截断的判决回答可能根本没有输出标签，放宽它等于让判分静默失败，
   违反「判官输出解析 fail closed」。
2. **保留 4096 并在截断时加倍上限重试**：否决。推理 token 的固定开销意味着第一次尝试基本注定浪费；
   而重试上限若取 32768，两份草稿的提示词会越过 24 万字符证据上限（该上限正是为不撑爆判官上下文而设）。
3. **不设输出上限**：否决。生成 token 无界，且同样会撑爆判官侧上下文。
4. **只提高上限、不改截断语义**：否决。只要答案长度可能超过上限（长交付物是常态），仍会回到「零候选」；
   保留 + 如实标记才能在超限时给出可用的部分结果。
5. **把截断草稿排除在候选之外**：否决。见 Decision 第 2 条——那等于插入一条未经判官评判的否决规则，
   而判官本来就能看见文本没写完。

## Consequences

- 同一个此前零候选的长任务，重启宿主后复验通过：`generated: 3`、`failed: 0`、`truncated: []`、
  `calls: 15`（`n=3, repeats=1` = 3 生成 + 9 锦标赛 + 3 基线）。
- 判官语义未放松：`callVerifier` 路径对截断回答仍然报错，有回归测试锁死。
- 决策快照现在能区分锦标赛（9 条）与基线比较（3 条，带 `baseline: ` 前缀）；`judges[].calls` 与顶层 `calls` 一致（12 + 3 = 15）。
- 仍存在的能力边界：单份草稿被框在约 65k 字符内，超出该规模的任务不适用本工具。

> 交付提交：`a5226f9`（截断语义拆分 + 上限调整）、`64e989e`（快照标签前缀）；
> 相关变更笔记：`implemented/feature/2026-09-13-best-of-n-generation-side-selection.md`。