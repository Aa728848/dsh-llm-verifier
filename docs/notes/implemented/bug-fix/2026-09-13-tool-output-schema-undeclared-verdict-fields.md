# Agent Note: 工具输出 schema 必须声明返回值里的每一个字段

Status: implemented

## Problem

显式 `verifier_current_session` 每次调用都在宿主侧失败：

```text
tool "verifier_current_session" returned invalid output:
"value.criteria" is not a declared property (additionalProperties: false)
```

`verifySession` 固定返回逐项判据 `criteria`（`AcceptanceCriterion` 的 `{id, name, score}`），
但注册时的 `output.schema` 没有声明它；宿主对工具返回值做严格校验（`additionalProperties: false`
加上编译后的 `required`），未声明字段直接让**整条调用**以 `INVALID_TOOL_OUTPUT` 失败。
失败与入参无关，所以模型重试（先是 `include_assistant_text`，再是 `repeats: 1`）会做出同样的
模型调用、得到同样的错误，读起来像偶发工具故障。

同类问题还有两处：`engine.compare` / `engine.select` 在候选逐字节相同时短路返回
`identical: true`，而 `verifier_compare` / `verifier_select` 的 schema 都没有声明 `identical`——
恰好是这条捷径存在的那个用例无法把判决交回调用方。自动门控不受影响：它直接调用
`verifySession`（`index.ts` 的 turn-stopping 路径），不经过工具 schema 校验；统计/决策快照
在返回前就已按 success 落盘，于是出现"看板成功、模型报错"的不一致。

测试为何漏掉：只有 `verifier_best_of_n` 有 `assertMatchesSchema` 回归（`e71013c`），
而那条 helper 的注释自己就写着"a missing or undeclared output field would only fail inside
the host"；`verifier_current_session` 从未把真实返回值对过自己的声明。

## Decision

1. 新增 `acceptanceCriterionResultSchema`（`{id, name?, score}`），在
   `verifier_current_session` 的 schema 里声明 `criteria`。刻意**不**复用
   `criterionResultSchema`：那是 compare 的 `{id, name, scoreA, scoreB}`，用它会让宿主继续
   因缺 `scoreA`/`scoreB`、多 `score` 而拒绝。
2. `verifier_compare` / `verifier_select` 的 schema 各补一个可选
   `identical: { type: 'boolean' }`（只有短路时才置位，故不标 required）。
3. `index.test.ts` 新增回归：`verifier_current_session` 真的执行一次（带真实事件日志的假
   session + scripted judge），把返回值过 `assertMatchesSchema`；另加一条清单断言，注册时每个
   字段都必须在。compare / select 用逐字节相同的候选触发短路，同样对 schema 验证；两条短路都
   不产生模型调用，所以测试不需要注入 `llm.stream`。

验证基线：`pnpm run verify:release` → typecheck 通过、`322 passed | 2 skipped`、build 通过；
三个新用例在修复前都会因"未声明的键"失败。

## Alternatives considered

1. **让 `verifySession` 改发 compare 的 `{id, name, scoreA, scoreB}` 形状**：否决。
   `{id, name, score}` 是 `AcceptanceCriterion` 的既定形状，`sessionAccepted` /
   `failedAcceptanceCriteria` / `automaticFeedback` 都按它读，改形状会牵动门控与反馈文案。
2. **从返回值里删掉 `criteria`**：否决。判决卡与统计依赖逐项判据（见
   `2026-09-13-per-criterion-breakdown-never-persisted.md`），删除等于让"是哪条判据没达标"
   永久不可见。
3. **只加"schema 里必须有 criteria"的注册断言，不执行工具**：否决。这正是漏检模式本身——
   断言测试自己知道的字段，而不是被测路径真实产出的值；必须让真实返回值过一遍声明。
4. **顺手给 `verifier_track` 也补一条执行校验**：本次未做。`track` 的返回
   （`scores` / `perRepeat` / `calls` / `stats` / `judges`）与 schema 逐字段一致，已核对，
   把无关路径拉进回归成本没有收益。
5. **把 `identical` 从返回值里去掉，让调用方按 0.5/0.5 自己判断**：否决。0.5/0.5 与
   "真的判过且打平"必须区分，看板与 `verdict` 已按 `identical` 记账。

## Consequences

- 显式 `verifier_current_session` 恢复可用；compare / select 的相同候选短路不再被宿主拒绝。
- 自动门控行为不变（它不经过工具 schema 校验），统计与决策快照内容不变。
- `AGENTS.md` 测试约定新增一条：注册工具的 output schema 必须覆盖真实返回值，并在同目录
  测试里把真实返回值过 `assertMatchesSchema`；新增输出字段时 schema 与测试同改。
- 已知边界：宿主校验同时执行 `additionalProperties` 与编译后的 `required`
  （`schema.ts` 把逐属性 `required: true` 编成 `required` 数组），所以"少声明字段"和
  "多返回字段"都会让整条调用失败；`assertMatchesSchema` 与之一致。
