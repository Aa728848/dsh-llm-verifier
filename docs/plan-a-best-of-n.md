# A 实施计划：`verifier_best_of_n`（显式触发的生成侧选优）

> 决策依据见 [`docs/upstream-turboagent-review.md`](upstream-turboagent-review.md) §5.3：做 A、不做 B。
> 状态：**已实施**（提交见 git log；实施记录与偏差见 §9）。§8 的三个决策全部按推荐项落地：生成模型=会话模型、总是跑基线比较、n 默认 3 / 上限 4。

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

| n | 生成 | 锦标赛（对局 × 3 判据 × 2 轮） | 基线 | 合计 |
|---|---|---|---|---|
| 2 | 2 | 1×6 = 6 | 6 | **14** |
| 3（默认） | 3 | 3×6 = 18 | 6 | **27** |
| 4 | 4 | 5–9 对局 = 36–54 | 6 | **40–64** |

> 实施时修正过这张表：初稿把 n=2 按 1 轮、n=4 按 9 对局估算，互相矛盾。n=4 的对局数取决于 pivot 轮与 ring 的去重结果（5–9 局），所以是区间；三个数字都已由 `index.test.ts` 的"cost envelope"测试锁死。

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

## 8. 三个决策（已拍板）

1. **生成模型**：**用会话模型**。零新配置，起草方就是干活的那个模型。
2. **是否总是跑"winner vs 空工作基线"**：**是**。不跑就没有与门控同口径的绝对分，工具相对 `verifier_select` 的增量价值就没了。
3. **候选数**：**默认 3、上限 4**。

## 9. 实施记录（与计划的偏差）

已实现：`core.ts`（`EMPTY_WORK_BASELINE` + `buildGenerationPrompt`）、`caller.ts`（`generationClient` / `generateCandidate` / `callTextCompletion`）、`index.ts`（`bestOfN` + `verifier_best_of_n` 注册）、`statistics.ts` / `auto.ts` / `router.ts` / `client.tsx` / `client-i18n.ts` / `decisions.ts`，以及 `caller.test.ts` / `core.test.ts` / `index.test.ts` / `statistics.test.ts` / `client.test.ts` / `decisions.test.ts` 的新用例（`pnpm run verify:release` 绿，317 passed / 2 skipped；含 schema 一致性校验与成本包线回归）。

实施时对计划做了六处调整，都是落地后才暴露的真实约束：

1. **统计判定走"验收分支"而不是 select 分支**。计划里写的是复用 select 分支，但那会把相对份额（`scores[index]`）渲染成看板上的"分数"，正好是本工具要消除的歧义。改为让 `verifier_best_of_n` 与 `verifier_current_session` 共用 `acceptanceVerdict()`：看板显示"通过 / 未达标 + 分数 / 基线 / 逐项判据"，与门控完全同形。
2. **`decisions.ts` 的 `MAX_CALLS` 12 → 32，并把"取前 N 条"改成均匀间隔取样**。n=4 的 best-of-N 约 46 次调用，而判官标签排在 `draft N` 之前——按前缀截断会把**每一份草稿都丢掉**，恰好是这个工具最需要留下的东西。同时修正了 per-call 字符分配：原先 80/20 分配在 `perCall` 变小后会被两个下限顶穿，触发安全网按尾部截断（还是丢草稿）。
3. **门控基线提成 `core.ts` 的 `EMPTY_WORK_BASELINE`**。计划说"与门控同一条基线"，靠两处字面量相同是不够的；现在只有一份定义，`verifySession` 与 `bestOfN` 都引用它。
4. **成本表按实测修正**（见 §2.3）。工具描述里的数字同步改了，并有回归测试锁定。
5. **生成侧「被上限截断」从错误改成结果**。第一次真机端到端验收（长任务、n=3）**三份草稿全部失败**，报的是判官的 `max-tokens` 错误：`callExplicitTag` 把「没写完」当硬错误，这对判官是对的（判决标签可能还没输出），但生成侧照搬就成了「一份都拿不到」。现在 `callTextCompletion(..., tolerateTruncation)` 把两条语义分开：判官仍然 fail closed，草稿保留文本并带 `truncated` 标记、由工具在返回值里列出（判官看得到文本没写完，自会扣分；直接丢弃等于白付一次生成）。
6. **生成上限 4096 → 16384，且不做「截断后加倍重试」**。真正原因写在返回值的 `stats.reasoningTokens` 里：一次只有两份短草稿的运行，会话模型（`deepseek-official/deepseek-flash`）输出 17254 token，其中 **16363 是推理 token**（约 8k/份）——4096 在答案开始前就被推理吃光。16384 是实测值的约 2 倍，同时是「两份草稿 + 任务」仍留在 24 万字符证据上限内的最大值（再往上，32768/份的草稿对会让单次比较的提示词越过该上限，而这个上限本身就是为不撑爆判官上下文设的）；`maxTokens` 是上限而非预留，加大它对短草稿零成本，所以不需要「失败再重试」那份双倍开销。
7. **`judges[].calls` 改为覆盖整次调用**（锦标赛 + 基线比较），`ok` 同理。真机输出暴露了不一致：顶层 `calls: 6` 而 `judges[0].calls: 2`——只报锦标赛会低估每个判官的真实工作量。

### 9.1 真机验收结果（已跑）

- **Step 0（判官自检，用户触发）**：判官 `antigravity/gemini-3.8-flash`，**强制重新探测后仍是 `explicit-tag`**（不是陈旧标记），与 §5.3 的结构性判断一致；方向正确（A 100% / B 0%），单次 21768 ms。因此难分 gap 维持实测的 **0.018**，README 的「只在候选差异明显时可靠」门槛当下成立（§1 的回退分支已无条件采用，见上文）。
- **Step 3-a（n=2、单判据的真实短任务）**：**成功**。`generated: 2`、`failed: 0`、`calls: 6`（2 生成 + 2 锦标赛 + 2 基线）——§2.3 的成本表在真机上逐位对上；`generatorProvider/Model = deepseek-official/deepseek-flash` 证明起草模型确实取自会话请求头；判官侧 `explicitTagScores: 4` 与自检结论一致；`passesThreshold: true`、`score: 1.0`（胜者 vs 空基线）。
- **Step 3-b（n=3、真实长任务）**：先失败、后定位、已修（见上面第 5、6 条）。**修复只有单元测试保护，真机复验还需要再重启一次宿主**：宿主在启动时就把 `lib/` 读进内存，当前进程跑的还是修复前的版本。复验判据：对同一个「函数 + 12 条测试用例 + 一句说明」的任务跑 `verifier_best_of_n(n=3)`，期望 `generated: 3`、`truncated` 为空或至多 1 项、`calls ≈ 27`。
- **尚未覆盖**：仍在 explicit-tag 通道下的难分 gap 复测（换判官才有意义）、以及 n=4 的真机成本抽样。
