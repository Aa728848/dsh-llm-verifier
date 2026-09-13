# Agent Note: 评审阶段（proposal / artifact）与 best-of-N 两阶段判据

Status: implemented

## Problem

同一个分数在不同阶段含义不同，但插件只有一个口径：

- 裁判拿到的是「按 ONE specific criterion 评两条轨迹」，而判据默认是 artifact 判据——`output_match` 要求
  「找到最终验证命令并对比它真实的 stdout/stderr」。把它用在**尚未执行**的方案或草稿上，候选会因为
  「没有 stdout」而被系统性判死，而不是因为它是一个差方案。
- 提示词的角色句固定自称「expert evaluator of AI coding agents」，对 `research` / `writing` 判据是错的描述。
- `verifier_best_of_n` 的锦标赛与基线比较共用同一套判据。草稿是文本、没有执行证据，于是锦标赛在
  `output_match` 上把每份草稿都打到接近 0，排名在噪声里产生（真机已出现 0.5/0.5/0.5 全平）。
- 返回值只有分数和排名，调用者无法从结果反推「这次评的是方案还是产物、用的是哪套判据」。
- 显式复核的自动去重按内容指纹，与阶段无关：一次 proposal 比较会把**同一份内容**后来带着真实执行证据
  到达的 artifact 复核一起屏蔽掉。

## Decision

新增可选 `reviewStage`（`'proposal' | 'artifact'`），省略即历史语义；只改默认判据、提示词框架、去重身份与
结果回显，不改数值排名语义、不改阈值、不改基线。

- `core.ts`：新增 `ReviewStage`、`PROPOSAL_CRITERIA`（`goal_and_constraints` / `feasibility` /
  `verification_design` 三条窄判据，区分「拟运行」与「已运行」，并明确文字类交付不被强求终端输出），
  以及 `buildPairwisePrompt(..., options?: PairwisePromptOptions)`：
  - `stage: 'proposal'` → 角色句改为评审「NOT been executed」的方案，证据块标签改为 `PROPOSAL_A/PROPOSAL_B`，
    并插入一条固定阶段说明（「不能因为一侧还没有 stdout 就扣分」）；
  - `domain` → 非 `coding` 时角色句改为「AI agent work on <domain> tasks」；`coding` 与未知域
    （`custom`/`fallback`）**保持历史措辞逐字不变**——默认提示词是评分缓存键的一部分。
  判据仍在提示词末尾，阶段框架在前，因此同一阶段内跨判据的前缀缓存仍然成立。
- `engine.ts`：`CompareOptions` / `SelectOptions` 增加 `reviewStage` 与 `domain`；`compare` 在
  `criteria` 省略时按阶段选默认判据（proposal → `PROPOSAL_CRITERIA`，否则 `DEFAULT_CRITERIA` 或调用方传入的），
  `select` 把两者透传给每一对候选。阶段与域都进入渲染后的提示词，因此**缓存自然失效，不升 cache version**。
- `index.ts`：`verifier_compare` / `verifier_select` 新增 `review_stage` 参数与
  `reviewStage` / `criteriaSource` 输出字段（schema 同步声明，用真实返回值过 `assertMatchesSchema`）；
  未知取值由参数 schema 直接拒绝，不消耗模型调用。判据解析收敛到 `stageRubric()`：显式 `criteria` 永远优先，
  否则按阶段取默认；`criteriaSource` 报告 `proposal` / 预设名 / `explicit` / `custom` / `fallback`。
- `verifier_best_of_n`（P02 产品规则变更）：省略 `criteria` 时**排序用 proposal 判据、基线比较用配置的交付判据**；
  显式 `criteria` 时两阶段都用它。此前的 `(对局数 + 1) × 判据数` 成本公式改为两阶段分别按各自条数计算
  （`selectComparisonsUpperBound(count) × rankingCriteria + baselineCriteria`）。绝对分字段
  （`score` / `baselineScore` / `criteria` / `threshold` / `passesThreshold`）含义**不变**，仍只来自基线比较；
  新增 `rankingStage` / `rankingCriteriaSource` / `rankingCriteriaCount` / `baselineCriteriaSource` /
  `baselineCriteriaCount` 单独表达排序阶段。
- `router.ts`：`CandidateArtifact` 增加 `reviewStage`（workflow v1 信封与语义候选都是 `artifact`），
  显式复核去重键改为 `reviewKey(stage, contents)`，显式参数省略 `review_stage` 按 `artifact`——
  历史调用逐位保持原语义，而一次 proposal 复核不再屏蔽后续带真实证据的 artifact 复核。
- `statistics.ts`：`VerdictSummary` 增加**可选** `reviewStage` / `criteriaSource`（旧记录缺字段照旧渲染），
  verdict 摘要因此能回答「评了什么、用什么评的」。

## Alternatives considered

1. **给 compare/select 增加第六个工具（`verifier_compare_proposals`）。** 不采用。工具数量、预算估算、
   路由与统计都要翻倍，而差别只有默认判据与一段提示词框架。
2. **只换默认判据，不改提示词框架。** 不采用。artifact 的角色句与证据块标签本身就在告诉裁判「这是已执行的轨迹」，
   与 proposal 判据冲突；而且「不能因为缺少 stdout 扣分」这条必须显式写出。
3. **让 proposal 也走配置判据（只是加一条提示）。** 不采用。用户配置的 `coding` 判据里 `output_match`
   与 `error_signals` 对未执行方案无意义，会把默认路径变成系统性误判。
4. **给阶段单独开一个配置项。** 不采用。阶段是**每次调用**的属性，不是安装级设置；作为工具参数才能表达
   「同一份内容先 proposal、后 artifact」。
5. **让 `verifier_best_of_n` 只改排序判据、去掉基线比较。** 不采用（方案明列为否决项）。相对排序给不出
   与门控同口径的绝对分，真机正是靠基线比较的 `passesThreshold: false` 才没有放行全平排名的结果。
6. **把阶段并入 `criteriaSource` 一个字段。** 不采用。两者正交：显式 `criteria` + proposal 阶段是合法组合，
   合并后就无法区分「调用者给了判据」与「评的是未执行方案」。

## Consequences

- 默认路径逐字不变：省略 `review_stage` 的调用、`coding` 判据的提示词文本、缓存身份（`version 6`）、
  去重凭据与自动路由行为都与改动前一致；`AGENTS.md` 中「两次比较共用判据」的旧规约已同步修订为两阶段默认不同判据。
- 代价是**同一份文本可能被评两次**（proposal 一次、带证据的 artifact 一次）。这是有意的：两者问的不是
  同一个问题；缓存键因提示词不同而自然分开，因此两次都真实付费。
- `custom` / `fallback` 判据的角色句由「coding agents」改为域中性措辞，属于提示词变化 → 这些配置下一次
  缓存未命中；`coding` 用户完全不受影响。
- 新增输出字段必须与 schema 同改（`reviewStage` / `criteriaSource` / `ranking*` / `baseline*`），
  否则整条调用会以 `INVALID_TOOL_OUTPUT` 失败。
- 验证与回归：`core.test.ts` 锁定 proposal 判据集合、proposal/artifact 提示词差异、默认提示词逐字不变、
  research 域替换角色句、阶段内前缀缓存；`engine.test.ts` 锁定按阶段选默认判据、显式 `criteria` 覆盖、
  阶段分离的缓存条目、select 逐对生效；`router.test.ts` 锁定 proposal 复核不屏蔽 artifact 路由；
  `index.test.ts` 锁定工具返回值与 schema 一致、默认阶段报告 `artifact`/`coding`、显式判据报告
  `explicit`、best-of-N 两阶段判据（锦标赛走 `PROPOSAL_A`、基线走 `TRAJECTORY_A`）。
  `pnpm run verify:release` 全绿。
- 未完成项：把阶段透出到设置页看板的具体渲染（统计已存字段，UI 暂未单独展示）；
  自动路由的 workflow 信封仍按 artifact 处理，组级 `reviewStage` 属于 P03。
