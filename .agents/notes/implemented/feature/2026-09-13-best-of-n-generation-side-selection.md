# Agent Note: 新增 verifier_best_of_n —— 生成侧显式选优工具

Status: implemented

## Problem

插件此前只做「复核」：候选由主 Agent 自己准备（并行 `subagent`），插件负责排序与门控。缺一块能力——
当最终交付物值得多写几份时，没有任何工具能替调用者起草候选；而 `verifier_select` 的 `scores` 是锦标赛偏好
份额（`wins/counts`），**与验收阈值不可比**，所以「相对最优」拿不到「够不够好」的结论。

决策依据是判别探针实测（`docs/upstream-turboagent-review.md` §5.3）：明显质量差的候选对中位分数差 0.544
（单次胜率 63.3%），而两侧都做了真实工作的难分对只有 0.018（50.4%）。结论是「做 A（显式触发的生成侧选优），
不做 B（拦截 `llm/stream` 对每次调用都做 best-of-N）」，计划与验收标准见 `docs/plan-a-best-of-n.md`。

## Decision

新增第五个显式工具 `verifier_best_of_n(task, n?, criteria?, repeats?)`，一次调用完成三件事：

```text
task ─┬─ 生成 n 份候选（当前会话模型，temperature 1.0，每份上限 16384 token，并行）
      ├─ engine.select 的 PPT 锦标赛 → 相对排名 + 逐裁判明细
      └─ 胜者 vs EMPTY_WORK_BASELINE 的 compare → 与门控同口径的绝对分
```

- **零新增配置项**：起草模型取自 `agent.session.requestHeader()?.config`（当前会话模型）；缺失即报错，
  并指向「用 parallel subagent 起草 + `verifier_select`」。
- **`core.ts`**：`EMPTY_WORK_BASELINE` 成为门控基线的唯一定义（`verifySession` 同步改用它，不再各写一份字面量）；
  `buildGenerationPrompt` 只有最后一行（`Draft i of n.`）随候选变化，让 N 份共享最大提示词前缀，命中前缀缓存；
  任务本身是「要执行的指令」而非待审数据，因此不加数据区分隔符——不可信内容的边界在下游由 `renderDelimitedBlock`
  + `evidenceNonce` 重新建立。
- **`caller.ts`**：`generationClient` / `generateCandidate`；温度固定 1.0（判官的 0.2 会让 N 份几乎相同，工具就失去意义）。
- **`index.ts`**：`bestOfN` 编排。`n` 限 2..4（默认 3）；生成前用**真实对局上界** `selectComparisonsUpperBound(n)` 估计划算，
  超过 `MAX_EXPLICIT_PLANNED_CALLS` 直接拒绝；幸存候选 < 2 时报错并列出每一次生成失败原因（绝不静默退回第 1 份）；
  `passesThreshold` 直接复用 `sessionAccepted`（胜者 + 均分 + 逐项判据三条同时成立）。
- **输出契约**：`best/index/sources/scores/ranking/comparisons/pivots/generated/failed/failures/truncated/score/`
  `baselineScore/winner/criteria/threshold/passesThreshold/failedCriteria/calls/stats/generatorProvider/generatorModel/judges`；
  `scores` 是相对份额，`score`/`criteria`/`passesThreshold` 是绝对口径。
- **接线**：统计判定走 `statistics.ts` 的验收分支（与 `verifier_current_session` 同形，共用 `acceptanceVerdict`）；
  `auto.ts` 的 `VERIFIER_TOOLS` 与 `router.ts` 的 `VERIFIER_EVIDENCE_TOOLS` 纳入新工具（既不算任务工作、也不作为观测输出），
  但**不接入自动路由**；看板补 `toolColors` 与两份 i18n 标签。
- **`decisions.ts`**：`MAX_CALLS` 12 → 32，超限改为**均匀间隔取样**（首尾必留），并修正 per-call 字符分配使「prompt 窗口 + output 窗口」不超过该次调用分到的份额。
  理由：`n=4` 一次约 46 次模型调用，而判官标签排序在 `draft N` 之前，按前缀截断会把草稿全部丢掉。
- **成本**（默认 3 判据 × 2 轮）：n=2 → 14 次、n=3 → 27 次、n=4 → 40–64 次模型调用，已由 `index.test.ts` 的 cost-envelope 测试锁死。

## Alternatives considered

1. **只做 A-lite（README 配方 + `verifier_select` 措辞，不写代码）**：否决。真机验收显示，当候选都合格时锦标赛会全平
   （0.5/0.5/0.5），此时唯一有效的信息是与门控同源的绝对分；配方提供不了它，Agent 只能拿着平局排名发货。
2. **新增 `generator` 配置项（可指定更强的起草模型）**：否决。起草方按定义就是「正在干这件事的模型」；
   为它付出 schema + `resolveConfig` + UI 行 + 两套文案 + README 表格的全套成本，换不到确定收益。
3. **让基线比较可选以省 6 次调用**：否决。见第 1 条——去掉它的那次真机跑动里，工具只剩一个没有信息量的平局。
4. **接进自动路由（`agent/turn-stopping` 自动触发）**：否决。生成成本必须由明确愿意支付它的调用者承担；
   自动路径会把 N 倍生成摊到每条 turn（B 方案的实测口径：一次被拦调用约 +45 万输入 token）。
5. **把生成能力塞进 `verifier_select`**：否决。`select` 是「已有候选」的确定性排序器，同时被自动路由复用；
   让它按需产生候选会让两条调用路径的成本语义分叉。
6. **截断的草稿直接判失败**（沿用判官语义）：否决，原因与修复见同日的 `implemented/bug-fix/2026-09-13-best-of-n-draft-truncation.md`。

## Consequences

- 不调用新工具时现有行为逐位不变：单裁判逐位等价、自动路由集合、评分缓存身份与既有提示词文本均未改动；
  `pnpm run verify:release` 绿（318 passed / 2 skipped），并新增「工具返回值与 output schema 一致」的递归校验。
- 真机验收（`n=3` 长任务，重启宿主后）：3 份草稿是三种不同实现（手写索引扫描 + 溢出守卫 / `Record<Unit, number>` 查表 /
  先散文后代码），`truncated` 为空；`n=3, repeats=1` 的实际调用数 15 与公式逐位一致；绝对分给出 `passesThreshold: false`
  并点名 `output_match` 未达标——生成侧无法提供真实跑过的 stdout/stderr，因此这一条恒为 0，工具据此拒绝放行。
- **当前可信区间**：判官仍在 `explicit-tag` 通道（强制重新探测后依旧，21.8 s、A 100% / B 0%），难分 gap 停留在 0.018。
  因此这个工具目前是「够不够好」的检查器，而不是「哪个更好」的挑拣器；要变成后者，需要把判官换到概率期望通道
  并重测 gap ≥ 0.15。
- 单份草稿上限 16384 token 同时框住了任务规模：答案真需要更长的交付物超出本工具适用范围（仍会被保留并如实标记 `truncated`）。
- `docs/plan-a-best-of-n.md` §9.1 记录了全部真机数据；后续改动该工具时应同步更新该节与本笔记。

> 交付提交：`c7ff704`（工具落地）、`e71013c`（schema 一致性测试 + 可信区间文档）、`a5226f9`（截断修复）、
> `64e989e`（基线比较标签）、`fa9648b`（验收记录）。