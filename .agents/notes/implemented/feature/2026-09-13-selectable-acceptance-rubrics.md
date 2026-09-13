# Agent Note: 可选择的验收判据（预设 + 自定义 Markdown 文件）

Status: implemented

## Problem

判据原本是一份硬编码的 `DEFAULT_CRITERIA`（三条 coding 判据），自动门控与所有显式工具都用它。后果：

- 非编码任务（研究、写作、运维、调试）被按「规格符合度 / 输出匹配 / 错误信号」三条 coding 判据打分，口径与任务类型错配；
- 改判据要改代码、重建 `lib/`、发版；
- 用户看不到提示词长什么样，判据写法与渲染结果之间没有反馈回路。

## Decision

1. `core.ts`：`CRITERIA_PRESETS` 提供 `coding` / `debug` / `research` / `ops` / `writing` 五类预设（各 2–4 条窄判据）；
   `coding` 与 `DEFAULT_CRITERIA` **保持同一个对象引用**（测试锁死：改动会同时改变门控松紧与缓存键）；
   `parseCriteriaMarkdown` 解析自定义 Markdown 判据文件；`slugCriterionId` / `dedupeCriterionId` 生成并去重 id。
2. `criteria.ts`：`CriteriaResolver.resolve(preset, file)` —— 预设直取；自定义文件每次重读、内容未变则复用解析结果；
   **文件缺失或解析失败退回 coding 并回报原因**。
3. `config.ts`：新增 `criteriaPreset` 与 `criteriaFile`（含校验；选 `custom` 但未给文件时允许保存，运行时按上面的回退处理）。
4. 设置页：预设下拉 + 判据提示词预览 + 自定义文件路径；两份 i18n 文案与 README 表格同步。
5. 判据 id 必须去重：`compare` 按 id 归并逐项结果，重名会把两条判据合并成一行。
6. `client.tsx`：预算告警按**实际判据数**计算（`computeWorstCaseBudget(judgeCount, criteria)`），不再硬编码 3 条。

## Alternatives considered

1. **只保留一份固定判据**：否决。任务类型与评判口径错配，用户也无法表达自己的验收标准。
2. **让用户整段编辑提示词模板**：否决。整段模板不可校验、无法预览，一改就可能破坏分隔块与输出契约（判官提示词是安全边界）。
3. **自定义文件读不到就禁用门控或直接报错**：否决。判据路径写错不该让门控失效——退回 coding 并在自检面板回报原因。
4. **切换预设时升缓存 `version`**：不必要。判据文本变化 → 提示词与 `promptHash` 变化 → 缓存自然失效。
5. **把 `coding` 预设换成新建对象**：否决。`CRITERIA_PRESETS.coding === DEFAULT_CRITERIA` 被测试锁死，拆分它会同时改变默认门控松紧。

## Consequences

- 判据按任务类型可选、可自定义、可预览，而默认仍是 coding（门控松紧与缓存语义不变）。
- 判据文件每次重读（内容未变则复用解析结果），代价是一次读盘。
- 新增配置项按硬性规矩 10 走完 schema + `resolveConfig` + UI 行 + 两份文案 + README 表格。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `0918149`、`69ab114`；
> 内容取自 `AGENTS.md`「判据预设默认必须是 `coding`」一条、`src/criteria.ts` 与设置页实现。