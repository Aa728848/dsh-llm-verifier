# A 实施计划：`verifier_best_of_n`（显式触发的生成侧选优）

> 决策依据见 [`docs/upstream-turboagent-review.md`](upstream-turboagent-review.md) §5.3：做 A、不做 B。
> 状态：**待批准**。本文件只是计划，未动任何代码。

## 0. 目标与边界

**目标**：给 Agent 一个显式工具——"这个交付物很重要，帮我并行起草 N 份、再用独立裁判选出最好的那份"，并且**同时回报一份与门控同源的绝对分**（相对最优 ≠ 够好）。

**明确不做**（都属于 B 或已否决的方向）：
- 不拦截 `llm/stream`、不对每次模型调用做 best-of-N；
- 不自动触发（不进 `router.ts` 的自动路由，不进 turn-stopping）；
- 不新增评分语义、不改动任何现有默认路径的行为；
- 不新增配置项（见 §2.1）。

**成功判据**：不调用新工具时，现有行为逐位不变；调用时，选出更好的候选、给出可解释的绝对分、失败时明确报错而不是静默退回第 1 份。

## 1. 前置校验（Step 0，配置层，0.5h）

这一步决定"这项工作能买到多少"，必须先做：

1. 重启宿主（让 `7b65c9a`、`197522f` 生效），把判官换成能走概率期望通道的配置（`deepseek-official / deepseek-flash`，或任何声明了 `api: openai-completions` + HTTPS 的 profile），点「判官自检」确认通道。
2. 通道若变成 `top-logprobs`：重跑**难分探针**（pair 2 设计，10 次、A/B 换槽），记录新的中位 gap。
3. 出口标准：写下"通道 + 难分 gap"两个数字。gap ≥ 0.15 → 按本计划全量实施；gap 仍 ≈ 0.02 → 只做 Step 1+2（工具仍然可用，但文档必须写明"只在候选差异明显时可靠"），并把预算花在判官质量上。

> 注意：**explicit-tag 通道下难分候选的 0.018 差距是量化地板（1/19≈0.053）压出来的**，所以 Step 0 的结果直接决定这个工具的可信区间。

## 2. 设计

### 2.1 模型与参数（0 个新配置项）

| 项 | 取值 | 理由 |
|---|---|---|
| 生成模型 | **会话模型**，读 `agent.session.requestHeader()?.config`（`{provider, model, reasoningEffort?, maxTokens?}`） | 已核对 DSH 类型；`EpochHeader.config` 就是当前会话的调用配置。避免新增 schema/UI/双语文案/README 表格（规矩 10 的全套成本） |
| 生成温度 | 常量 **1.0** | best-of-N 的前提是候选有差异；沿用判官的 0.2 会让 N 份几乎相同，工具失去意义 |
| 候选数 | 工具参数 `n`，默认 3、上限 4 | 与 `verifier_select` 的显式参数风格一致，不引入配置项 |
| 生成上限 | `maxTokens: 4096`/份（常量） | 保证 n×候选文本远低于显式证据预算，不会"付了生成费再被预算拒绝" |
| 判分 | 沿用配置的判官与判据（含自定义判据文件） | 与门控同源 |

### 2.2 数据流

```
task(参数, 经脱敏+单项/总量上限)
   │
   ├─ 生成 n 份候选（并行，callVerifierText，temperature 1.0，maxTokens 4096）
   │    ↓ 少于 2 份成功 → 报错（列出每次失败原因），绝不退回第 1 份
   ├─ engine.select(candidates)                 ← 复用 PPT 锦标赛/位置平衡/评分缓存/相同候选短路
   │    → index/best/scores/ranking/comparisons/judges
   └─ engine.compare(best, '(No useful work or verification was performed.)')   ← 与门控同一条基线
        → 与 autoVerifyThreshold 同源的绝对分 + passesThreshold
```

**为什么必须补最后一步**：`select` 的 `scores` 是锦标赛偏好 `w/c`（相对量），**不能**直接和 `autoVerifyThreshold` 比。与固定空工作基线比一次（3 判据 × 2 轮 = 6 次调用）才拿到可比口径——这正是 §5.3 里"必须同时回报绝对分"的落地方式。

### 2.3 成本（写给用户看，也写进工具描述）

| n | 生成 | 锦标赛（对决 × 3 判据） | 基线 | 合计 |
|---|---|---|---|---|
| 2 | 2 | 1×3 = 3 | 6 | **11** |
| 3（默认） | 3 | 6×3 = 18 | 6 | **27** |
| 4 | 4 | 9×3 = 27 | 6 | **37** |

工具描述必须写明"这是一次昂贵的显式选择：只在最终交付物、且选错代价高时使用"。

### 2.4 失败语义（fail closed）

- 单份生成失败 → 用幸存者继续（≥2 份）并在结果里报告失败数；
- 幸存 < 2 份 → **报错**（带每次失败原因），不返回任何"最优"；
- 选择阶段全裁判失败 → 沿用 `engine.select` 的失败语义（抛错）；
- 基线比较失败 → 报错（无绝对分就没有这个工具的意义）。

### 2.5 输出契约

`{ best, index, scores[], ranking[], comparisons, calls, stats, judges[], baseline: { score, winner, criteria[] }, threshold, passesThreshold, generated, failed }`

## 3. 改动清单

| 文件 | 改动 | 备注 |
|---|---|---|
| `src/caller.ts` | 新增薄 seam `generateCandidate(config, prompt, signal)`（内部就是 `callVerifierText` 的具名封装） | 只为可读性与测试注入；无新协议 |
| `src/index.ts` | 注册 `verifier_best_of_n`：参数 `task`、`n?`、`criteria?`；读会话模型 → `resolveCallConfig` → 生成 → `select` → 基线 `compare`；走既有 `record()` 记账 | 工具描述写明使用门槛与成本 |
| `src/statistics.ts` | `VERIFIER_TOOL_NAMES` 增名；`summarizeVerdict` 复用 select 分支（+ 测试） | 新记录名不破坏旧数据（宽松校验） |
| `src/auto.ts` | 新工具加入 `VERIFIER_TOOLS`（不算任务工作、不作为观测输出） | 与其它 `verifier_*` 一致；**不进自动路由** |
| `src/router.ts` | `VERIFIER_EVIDENCE_TOOLS` 增名 | 保持"裁判工具不当证据"的既有约束 |
| `src/client.tsx` / `src/client-i18n.ts` | `toolColors` + 两份 tool label | i18n 键由类型强制对齐 |
| `README.md` | best-of-N 一节改写：从"配方"升级为"配方 + 工具"，含成本表与使用门槛 | |
| `AGENTS.md` | 已知设计追加：生成模型=会话模型、温度 1.0、基线比较的必要性、显式不自动触发 | |
| `src/*.test.ts` | 见 §4 | |

**不新增配置项、不改缓存 `version`**（提示词文本变化自然失效；生成不进评分缓存）。

## 4. 测试计划

- `caller.test.ts`：`generateCandidate` 返回文本与用量；重试/超时沿用 `retrying`；空文本报错。
- `index.test.ts`（装配级，注入 fake `llm.stream` 按调用序返回不同候选）：
  - 注册与 schema；
  - `n` 越界（<2 / >4）与 `task` 超长被拒；
  - **只成功 1 份 → 报错**（回归：不得静默退回第 1 份）；
  - **从更差/更好的候选里选中更好的那份**（脚本化流：候选 A 的证据完整、候选 B 漏验，断言 `index` 指向 A）；
  - 绝对分与 `passesThreshold` 存在且与阈值口径一致；
  - 判据来自配置（传 `criteria` 时优先，未传时用当前预设）。
- `statistics.test.ts`：新工具名走 select 分支、`identical` 短路照常。
- 全部现有测试保持通过（新工具是纯增量，不触碰默认路径）。

## 5. 验收标准（Step 3）

1. `pnpm run verify:release` 绿；上述新增测试通过。
2. **多样性验收**：对同一个真实任务生成 3 份，人工确认至少 2 份在关键部分不同。若同质化严重 → 工具无价值，应加强差异化（提示词/温度）或退回纯配方（A2）。
3. **选择有效性验收**：用 §4 的脚本化对照 + 一次本仓库真实任务端到端跑；差的候选必须 `passesThreshold=false`。
4. **不回归**：不调用新工具时，统计/门控/缓存行为与改动前逐位一致。
5. `node scripts/eval-replay.mjs` 仍可用（阈值扫描/解析器回放不受影响）。

## 6. 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| 候选同质化（温度/模型决定） | 工具退化成付 N 倍钱抛硬币 | Step 0 + Step 3 的多样性验收；不达标就退回配方 |
| 会话模型读不到（`requestHeader()` 为空、子会话边界） | 工具无法工作 | 明确报错并提示替代路径（`subagent` + `verifier_select`） |
| Agent 滥用（每轮都调） | 成本上升 | 工具描述写明门槛；`n` 上限 4；统计可见；不进自动路由 |
| 生成内容进入后续提示词/日志 | 上下文膨胀 | `maxTokens 4096` 封顶 + 既有显式预算 + 决策快照按调用数平分 |
| 难分区间仍在（gap≈0.02） | 选择不可靠 | Step 0 记录；文档写明可信区间，不夸大 |

## 7. 排期

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 0 | 通道 + 难分 gap 复测（纯配置） | 0.5h |
| 1 | `generateCandidate` seam + 测试 | 0.5 人日 |
| 2 | 工具注册 + 统计/看板/i18n + 测试 | 1 人日 |
| 3 | 多样性/选择有效性/端到端验收 | 0.5 人日 |
| 4 | README/AGENTS/计划状态 | 0.5 人日 |

**合计 ≈ 3 人日**，每步独立可交付、可回退。

## 8. 需要拍板的三个点

1. **生成模型**：用会话模型（推荐，零新配置）还是新增 `generator` 配置项（可指定更强的起草模型，但要走 schema+UI+双语文案+README 全套）？
2. **是否总是跑"winner vs 空工作基线"**（+6 次调用换与门控同源的绝对分）？推荐：是。
3. **候选数**：默认 3、上限 4（推荐）？还是允许更多（成本线性上升）？
