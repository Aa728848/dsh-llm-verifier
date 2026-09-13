# 上游对照：TurboAgent（Claude Code 插件）与本仓库的差距与改进计划

> 产出日期：本次会话｜对照基准：`llm-as-a-verifier/llm-as-a-verifier@8db8a114`（pyproject 0.2.0）+ `llm-as-a-verifier/TurboAgent@main`
> 本仓库版本：`dsh-llm-verifier@0.3.1`
> 本文档只是**计划**，不改变任何现有行为；所有条目若实施，默认值必须让现有判定路径逐位等价。

---

## 0. 一句话结论

我们和上游 Claude Code 插件**不在同一个产品层**：TurboAgent 是**生成侧干预**（代理层 best-of-N，改写"模型输出什么"），我们是**事后独立复核 + 宿主门控**（判定"这一轮能不能结束"）。
因此上游大部分代码不可移植，但它有 **4 件事值得学**，其中 1 件是"白拿"的省钱项，且我们自己的真实遥测数据正好证明了它的价值；另有 **4 件事明确不该学**（照抄会削弱我们的安全边界或产品定位）；还有 **1 个方向性问题**需要你拍板。

---

## 1. 对照对象与证据

| 项 | 内容 |
|---|---|
| 上游核心算法 | `llm-as-a-verifier` @8db8a114（0.2.0）：PPT 锦标赛、A–T 细粒度奖励、`track` 进度、criteria 文件、前缀缓存预热、token 记账。**我们的移植基线就是这个 commit**，算法层无缺口 |
| 上游 Claude Code 插件 | [TurboAgent](https://github.com/llm-as-a-verifier/TurboAgent)：`turbo_agent/proxy/{proxy,backend}.py` + `verifier/verifier.py` + `context/refiner.py` + `progress_monitor/monitor.py` + `check_api_key.py` + `frontend/`（DAG 可视化） |
| 我们的形态 | DSH 原生插件：4 个工具 + 2 个生命周期钩子（`agent/turn-stopping`）+ 设置页/看板（`src/index.ts`、`src/router.ts`、`src/auto.ts`） |
| 本仓库真实遥测 | 本话题 `verifier/statistics-v1.json`：11 次 `verifier_current_session`、66 次模型调用、未缓存输入 1,184,128 tok、缓存输入 495,176 tok、输出 90,333 tok。**前缀缓存命中率 29.5%**，单次调用平均输入 ≈ 25.4k tok |

---

## 2. 逐维度对照

| 维度 | TurboAgent（上游 CC 插件） | 本仓库 | 判定 |
|---|---|---|---|
| 介入点 | LLM API 代理，拦截**每一次**模型调用 | 工具 + turn-stopping 钩子，**按内容路由**决定是否复核 | 各有取舍：他们能改输出，我们省成本、能绝对否决 |
| 能否否决 | **不能**。只做 best-of-N 相对排序，N 个候选全烂也照样返回"最好的" | 能。绝对阈值 + 逐判据下限 + winner==='A' | **我们更强，必须保留** |
| 生成侧干预 | 有（N 路并发采样 + 上下文精炼） | 无（Agent 想 best-of-N 只能自己拼 `subagent` + `verifier_select`） | 战略选项，见 §5 |
| 判官模型要求 | **强制 logprobs**，`anthropic/` 直接报错 | 双通道：top-logprobs 直连 + 显式标签；能力运行时探测 + 24h TTL | **我们更强** |
| 评分可复现性 | temperature=1.0，默认 K=1 | temperature=0.2，重复轮次 + 偶数轮换位 | **我们更强** |
| 前缀缓存 | 预热"每个不同前缀一次"，criterion 放尾部；benchmark 实测命中 5.2%→78.4%，输入成本 ≈1/3.4（0.2.0 changelog） | 提示词布局已对齐（`core.ts:buildPairwisePrompt`），但预热只覆盖**一半**前缀 | **差距，可白拿**（§3-P0-1） |
| token/成本记账 | 进程级 `USAGE` + `format_usage()` | 每次调用记账（含 cached/reasoning）+ 话题级统计 + 看板 | 打平；我们更细 |
| 便宜短路 | 多数投票：严格多数完全相同 → 跳过锦标赛 | 无 | 部分可采纳（§3-P0-2） |
| 判据（criteria） | 一等公民：`criteria/<benchmark>.md` + `TEMPLATE.md` + `{#id}` 锚点 + `python -m llm_verifier file.md` 预览；每个 benchmark 一套 | 硬编码 `DEFAULT_CRITERIA`（3 条，面向编码）；显式工具可传数组；无预设、无 UI、无文件 | **差距**（§3-P1-1） |
| 可观测性 | 每请求 JSON 日志（全部候选、逐对比较与提示词、胜者、进度）+ Web DAG 可视化 | 统计表 + 决策快照（提示词/原始回答，限 12 次调用）+ 看板 | 数据更细，呈现更弱（§3-P1-2） |
| 自检 | `turbo-agent check`：逐 provider 验 key、验 logprobs 能力、✅/❌/⚠️ | 能力探测在运行时静默完成，用户看不到结论 | 差距（§3-P1-3） |
| 失败策略 | 判官抛错 → **静默返回第 1 个候选**（fail-open） | fail-closed：解析失败即报错；smart 下不通过、strict 下继续 steer | **我们更强** |
| 安全边界 | 无脱敏、无长度上限，整段会话历史逐对喂给判官 | 脱敏 + 单项/总量双层预算 + 分隔块 + 内容派生 nonce | **我们更强** |
| 离线评测 | 有 benchmark 与复现脚本（Terminal-Bench 83.1% vs 82.5% 等） | 只有一致性/回归单测，**没有"门控是否真的有用"的评测** | 差距（§3-P2-1） |

---

## 3. 建议采纳的改进项

### P0-1 前缀缓存预热：从"预热一次"改为"每个不同前缀预热一次"

- **上游做法**：`fine_grained_reward.py:812-942` 的 `score_directed_pairs`：把所有打分 job 按 `prefix=(task, slotA, slotB)` 分组，"warm-up wave" 每组先跑完 1 个，其余再并发扇出；提示词把 criterion 放尾部以最大化共享前缀。0.2.0 实测把后端前缀缓存命中率从 5.2% 拉到 78.4%。
- **我们的现状**：`src/core.ts:buildPairwisePrompt` 的布局已对齐上游（criterion 在尾部），`src/engine.ts:190-232` `compare` 只预热 `jobs[0]`（= criterion#1 + repeat#1，未换位）。
  - 因此：未换位方向的另外 2 次调用能命中；**换位方向的 3 次调用全部冷启动**。
  - 6 次调用里命中 2 次 ≈ 33%，与实测 29.5% 吻合。
  - `track`（`engine.ts:382-441`）更糟：`repeats`（自动默认 3）是**同一份提示词**并发扇出，全部冷启动，理论命中率 0%。
- **建议**：把预热从"首个 job"改成"每个不同前缀的首个 job"：
  1. `compare`：按 `(candA, candB)` 分组（即是否换位），每组先发 1 个；
  2. `track`：先发 repeat 0，再扇出其余 repeats；
  3. `select`：每对候选已经是独立 `compare`，天然已覆盖，无需改。
  **调用次数不变**（预热用的就是本来就要发的那次调用），只增加一次串行等待。
- **量化**：本话题 11 次验收的未缓存输入约 1.18M tok，按此改法应降到 ≈0.6M tok（命中率 29.5% → ≈59%），**判官输入账单近乎砍半**。仅本话题即可省 0.6M tok。
- **改动点**：`src/engine.ts`（compare/track 的 warm 分组）、`src/engine.test.ts`（断言"同前缀只串行一次、不同前缀各一次"、断言总调用数不变）。
- **风险**：① 增加一次串行往返（本话题单次调用 2–4s，可接受，且只发生在扇出>1 时）；② 若 provider 不支持隐式前缀缓存，收益为 0 但无损失；③ 不改变任何评分语义，**不需要动缓存 version**（提示词没有变）。
- **验收**：单测锁定调用顺序；看板新增"provider 前缀缓存命中率"指标（见 P0-3）后，实测命中率显著上升。
- **工作量**：0.5–1 人日（含测试）。

### P0-2 便宜的短路与去重（只拿成本收益，不拿语义风险）

- **上游做法**：`_try_majority_voting`：严格多数候选逐字节相同 → 直接返回该候选，跳过整个锦标赛。
- **我们的建议**（**有意与上游不同**）：
  1. `select`：先把**逐字节相同**的候选去重后再跑锦标赛，结果映射回原索引（语义等价，纯省钱）；
  2. `select`：全部候选逐字节相同时，0 次调用返回 index 0，并在 verdict 里记 `outcome: 'identical-candidates'`；
  3. `compare`：A 与 B 逐字节相同 → 0 次调用返回 `tie`，记 `outcome: 'identical'`；
  4. `select`/`compare`：空白候选（`trim()===''`）直接拒绝并报错，不送判官。
  **不采纳**上游的"多数票直接返回未评判的候选"：那是在没有判据的情况下宣称质量，和我们的定位冲突。
- **改动点**：`src/engine.ts`（select/compare 入口）、`src/engine.test.ts`（断言 0 调用 + verdict 文案）、`src/statistics.ts`（新 outcome 值）。
- **风险**：极低；分类结果要写进 verdict，避免看板上出现"没花调用却像判过"的歧义。
- **工作量**：0.5 人日。

### P0-3 把两种"缓存命中率"分清楚并暴露 provider 命中率

- **现状**：看板的 `metric.cacheHitRate` 是**本地评分缓存**命中率（`cacheHits/cacheMisses`），而 P0-1 要优化的是**provider 前缀缓存**命中率（`cachedInputTokens/(input+cachedInput)`）——后者目前只在 `metric.tokensNote` 里被混进"输入 token"，看不见。
- **建议**：新增 `metric.prefixCacheHitRate`（含 `inputTokens / cachedInputTokens / 命中率`），并把现有指标改名为"评分缓存命中"；两份 i18n 字典同步（`client-i18n.ts`，zh/en 键必须一一对应）。
- **价值**：P0-1 的效果可被用户直接观测，也是后续任何缓存优化的验收口径。
- **工作量**：0.5 人日。

### P1-1 判据（criteria）升级为可配置的一等公民

- **上游做法**：`criteria/<benchmark>.md`（`## Ground Truth Note` + `### 判据名`，`{#id}` 锚定 id，HTML 注释对判官不可见）；`normalize_criteria` 还接受 `{name: description}` 字典与字符串列表；`TEMPLATE.md` 明确写"2–4 条窄判据胜过 1 条宽判据"；`python -m llm_verifier <file>` 可离线预览判官将看到的内容。
- **我们的现状**：自动门控（最终验收、自动 track）**硬编码** `DEFAULT_CRITERIA`（`src/index.ts:554` 用它算预留，`verifySession` 不传 criteria）；只有显式工具能传 `criteria` 数组（且必须是 `{id,name,description}` 全字段）。设置页没有判据项。
- **建议**（分两步，先做不引入新模型调用的一步）：
  1. 内置 4 套预设判据（编码/调试、研究问答、运维操作、文档写作），各 2–4 条窄判据；配置项 `criteriaPreset: 'coding' | 'debug' | 'research' | 'ops' | 'custom'`，默认 `coding`（= 今天的 `DEFAULT_CRITERIA`，**默认行为逐位不变**）；`criteriaPreset='custom'` 时读 `criteriaFile`（markdown，格式对齐上游 `TEMPLATE.md`，含 `{#id}`）；
  2. `normalizeCriteria` 兼容字符串与 `{name, description}`（id 由 name slug 化），降低显式工具的调用门槛；
  3. 设置页加"判据预览"：用 `core.buildPairwisePrompt` 渲染一条样例提示词给用户看（对齐上游的 `python -m llm_verifier` 预览），也是提示词回归的可视化护栏。
  **不在 v1 做**"模型自动挑选判据"：那会给门控引入额外调用与不确定性；若要做，放到后续用已有的语义路由顺带输出 `taskKind`（需要同步改严格 JSON schema 与解析器的白名单）。
- **改动点**：`src/core.ts`（预设表、slug）、`src/config.ts`（schema + resolveConfig + 校验）、`src/index.ts`（自动路径取预设）、`src/client.tsx` + `src/client-i18n.ts`（选择器 + 预览 + 两份文案）、`README.md`（配置表）、`src/config.test.ts`/`core.test.ts`。
- **风险**：判据文本进入提示词 → 改动即换 `promptHash`（缓存自然失效，无需升 version）；预设切换会改变验收松紧，因此 **UI 必须写明"影响自动门控"**，且默认值保持现状。
- **工作量**：2–3 人日（其中 i18n/UI/README 占一半，按规矩第 10 条一项不能少）。

### P1-2 一次判决的可解释视图（把已有数据摆出来）

- **上游做法**：每请求 JSON 记录 + `/visualizer` 的 DAG（全部候选 → 逐对比较与分数 → 胜者），比较记录里带提示词。
- **我们的现状**：`statistics.ts` 的 `VerdictSummary` 已存 `winner/baselineScore/threshold/criteria[].score/scoreB`；`decisions.ts` 已存每次调用的提示词与原始回答（限 12 次调用）。**数据基本齐了，缺的是呈现**：看板目前只把 criteria 拼成一行文字，也没有把"成本/通道/缓存"与这次判决关联起来。
- **建议**：看板行展开为"判决卡"：逐判据 A vs 基线表格、winner/阈值、判据未达标列表、通道构成（top-logprobs/explicit-tag）、调用数/输入(缓存)/输出/预估成本、judges 一致性、以及指向该次决策快照的入口。
- **改动点**：`src/client.tsx` + `src/client-i18n.ts`（纯前端，数据已存在）；如需要按 id 拉取已有 `{kind:'decision', id}` 路由，无需新后端。
- **工作量**：1.5–2 人日。
- **说明**：**不**做上游那种 DAG 可视化——我们一次判决最多 6 次调用、结构是"3 判据 × 2 轮"，表格比图更省事也更好读。

### P1-3 自检（doctor）：把"判官到底走哪条通道"变成可点的一步

- **上游做法**：`turbo-agent check` 逐个 provider 验 key、**验后端是否返回 token logprobs**、用 ✅/❌/⚠️/⚪️ 报告，并标注配置真正用到哪些 key。
- **我们的现状**：通道能力在 `top-logprobs.ts` 里运行时探测（24h TTL），失败静默降级到显式标签；用户只能在看板看到"scoring mode"的累计计数，无法主动确认"现在这个判官走哪条路、延迟多少"。
- **建议**：设置页"检测"按钮 → 对每个判官（含附加裁判）发一次最小提示词，报告：可达性、实际通道、往返延迟、是否命中前缀缓存、错误原文；结果只做展示与写入能力缓存，**不参与判定**。
- **改动点**：`src/index.ts`（新 RPC 路由）、`src/client.tsx` + i18n；复用 `callVerifier` + `TopLogprobCapabilityCache`。
- **风险**：一次真实模型调用（费用极小）；必须放在显式用户操作后面，不能自动跑。
- **工作量**：1–1.5 人日。

### P2-1 离线回放/阈值评测（让"门控是否有用"可度量）

- **上游做法**：仓库以 benchmark 数字开头（Terminal-Bench / SWE-Bench / MedAgentBench），有 `scripts/run.py` 复现脚本与逐 benchmark 判据。
- **我们的现状**：`parity.test.ts` 只证明与 Python 参考实现一致，`engine/router/auto.test.ts` 只证明内部行为；**没有任何证据说明门控阈值（默认 0.65）选得对不对、误放/误拦各多少**。
- **建议**（低成本起步，不需要新模型调用）：写一个离线 harness，读本话题的 `decisions-v1.json`（含每次判官调用的完整提示词与原始回答），用当前 `extractScore` 重新解析，扫描 `autoVerifyThreshold` 的不同取值，输出"判决翻转数/逐判据达标率"表格；再叠加人工标注的少量"确实该通过/确实该拦"样本，形成第一个小型评测集。
  - **已知局限**（必须写进文档）：top-logprobs 通道的记录只有文本，回放只能走文本解析，得到的分数与当初的概率期望**不完全等值**；因此回放用于"相对比较与阈值扫描"，不用于宣称绝对精度。
- **改动点**：新增 `scripts/eval-replay.ts`（不入 `lib/`）+ 单测 + README 一节。
- **价值**：阈值、逐判据下限、判据预设这些产品决策第一次有数据支撑；也是提示词改动的回归护栏。
- **工作量**：2–3 人日。

### P2-2 第三评分通道（观察项，不承诺）

- **上游做法**：非 tag 模型用 vLLM/SGLang 的 `continue_final_message` 预填充 + `structured_outputs` 约束到 20 个字母，从**任意 OpenAI 兼容服务**读出一整个字母分布（比我们显式标签通道"一次采样一个字母"信息量高得多）。
- **对我们的意义**：若 DSH 的 `llm.stream` 未来暴露预填充/语法约束，或我们直连的 OpenAI 兼容服务是 vLLM/SGLang，就可以在 `top-logprobs.ts` 的直连通道里加这条备用路径，把"显式标签通道"的抖动换成分布读数（可减少 `autoTrackRepeats` 的重复次数）。
- **动作**：现在**只记录为观察项**：在 `src/top-logprobs.ts` 加一条注释说明这条可能性与前置条件；等有 vLLM/SGLang 用户或 DSH 暴露对应选项时再评估。**禁止**按厂商/模型名预设能力（规矩第 7 条）。

### P2-3 `track` 的"未来泄露"说明

- 上游 `progress.py` 明确区分 `track`（离线，一次看完所有检查点）与 `ProgressTracker`（在线，每步只喂前缀，"判官看不到未来"）。
- 我们只有离线形态：判官在给"第 K 步"打分时已经看到了第 K 步之后的内容。**对门控无实质影响**（门控只用最新检查点，见 `index.ts:526`，最新检查点之后没有内容），但会轻微抬高高历史检查点的分数、影响看板曲线解读。
- **建议**：只做文档说明（README 一句话），**不改行为**；在线逐步骤打分=每步一次调用，代价不可接受。

---

## 4. 明确不建议照搬（附理由）

1. **上下文精炼 / 改写系统提示词**（`turbo_agent/context/refiner.py`）：把模型输出**前置进 system 消息**，无校验、无脱敏、无长度上限。这既是提示词注入放大器（工具输出 → 精炼模型 → system 提示词），也是一次静默的任务改写：被评审的任务和 Agent 实际执行的任务会不一致。我们的价值恰恰是"独立、可追溯地复核同一个任务"。真要做，只能是"向用户建议澄清"，不能静默改写。
2. **对每一次模型调用都做 best-of-N**：生成成本 ×N + 锦标赛调用 + 首字延迟消失（`backend.py` 在有判官时改为收集完再一次性回放 SSE）。我们按内容路由、按任务预算，单位成本低一个量级；这个取舍要守住。
3. **判官失败静默返回第 1 个候选**（`backend.py:_pick_best` 的 `except` 分支）：等于在没有任何判据的情况下宣称"这是最好的"。我们 fail-closed 是对的。
4. **要求判官必须支持 logprobs**（上游直接拒绝 `anthropic/`）：我们双通道 + 运行时探测 + 优雅降级更强，不要回退。
5. **无上限地把整段历史逐对喂判官**：我们已有脱敏与单项/总量双层预算，`itemBudget()` 的分摊规则必须继续遵守（规矩第 4 条）。
6. **判官 temperature=1.0、K=1**：我们的 0.2 + 重复轮次（含 track 默认 3、最终验收默认 2 且换位）更可复现，不动。
7. **"多数票直接返回未评判的候选"**：只取其成本收益（去重/全同短路），不取"跳过评判还宣称更好"的语义。
8. **进程级全局 USAGE 计数器**：我们是话题级、工具级、逐调用记账，更细，不必回退。

---

## 5. 方向性选项（需要产品决策）

上游 CC 插件的真正差异是**它能让输出变好，而我们只让交付变可信**。我们的"失败"补救手段目前只有一条：steer 让 Agent 重做（贵、轮次不可控、可能反复）。要不要补上生成侧，是唯一的方向级问题：

| 选项 | 内容 | 成本/风险 | 建议 |
|---|---|---|---|
| **A. 组合式 best-of-N（低风险）** | 不新增架构：写清"用 `subagent` 并行产 N 份 + `verifier_select` 选优"的配方（README + 工具描述），必要时加一个便利工具 `verifier_best_of_n(task, n≤3)`：内部生成 + PPT 选优，**失败必须报错不得静默退回第 1 份**，并且**必须同时回报绝对分数**（best-of-N 只保证相对最好，不保证够好——这正是我们比上游多出来的那层） | 1–2 人日；只花显式调用者的预算 | **推荐先做**：不改门控、不改默认行为 |
| **B. `llm/stream` 拦截（战略级）** | DSH 的 `ctx.on('llm/stream', (options, next) => …)` 允许插件**完全接管**一次循环内模型调用（`packages/core/agent-loop/src/invariant.ts:21`，测试见 `request-reconstruction.spec.ts:460`）。也就是说 TurboAgent 代理层的核心能力（并发采样 + 选优 + 回放）在 DSH 里**不需要代理**就能原生实现 | 需要构造合法的 chunk 序列（含 tool-call delta 的拆分/重放），要处理流式 UX、失败语义、每轮预算；默认关闭 + 白名单触发 | **暂不做**。等 P0 成本项与 P2-1 评测落地、能证明收益后再立项做 spike |
| **C. 独立代理服务器** | 照搬 TurboAgent 的形态 | 与 DSH 插件定位冲突，多一个进程、多一层故障面 | **不做** |

> 判断依据：我们 11 次验收花了 1.67M 输入 token 去**发现**失败，而没有一次把"发现"直接换成"更好的交付物"。A 是可逆的小步；B 值得做但必须建立在 P0（省一半输入）+ P2-1（能度量收益）之上，否则只是把成本翻几倍。

### 5.1 推荐：暂不做生成侧；先把"判官能否区分两个真候选"验掉

**结论**：选项 A 只做 A-lite（文档 + 一处措辞，0.5 人日，不动架构）；选项 B **缓做**，触发条件见下；选项 C 不做。

**理由（全部来自本仓库真实数据，不是推测）**：

- 三个话题的 `scores-v1.json` 合起来 **78/78** 条比较记录都是极值：session 恒为 `A`(1.00)、基线恒为 `T`(0.00)，**从来没有出现过任何中间分数**；78 次全部走 `explicit-tag` 通道（`capabilities-v1.json` 把 `antigravity/gemini-3.8-flash` 标为不支持 top-logprobs）。
- 与固定基线比较（真实工作 vs 字符串 `(No useful work or verification was performed.)`）是**极容易**的判别，判官的推理文本显示它判得没错——也就是说，这 78 次只证明了"判官能看出有没有干活"。
- 而 best-of-N 需要的恰恰是**难判别**：N 个候选都做了真实工作，要把它们排序。这个能力**从未被验证过**，现有数据是饱和的、不提供任何信息。
- 更关键的是信号质量：显式标签通道一次调用只采**一个字母**，而锦标赛里两个候选是在**两次独立调用**中分别打分的——比较的是两个独立采样。在这种信号下做 best-of-N，等于付 3 倍生成成本 + 一场锦标赛，换一次近似抛硬币。

**先验掉的前置条件（Discrimination Probe，成本 ≈ 一次验收的 token）**：

用 `verifier_compare` 对一对**难分**候选做重复测量：例如"正确补丁 vs 只错一行的同一补丁"，或"含失败模式分析的计划 vs 删掉该段的同一计划"。**事先登记**通过标准，建议三条同时满足：

1. 更好的一方获胜 ≥ 8/10 次重复；
2. 两侧 A–T 分数差的中位数 ≥ 0.2；
3. 至少出现一个非极值分数（否则说明 20 级标尺根本没被使用）。

不通过 → **不要**做生成侧；同样的钱花在判官质量上 ROI 高得多（换/配一个支持 logprobs 的判官走概率期望通道，或提高 repeats 并把方差暴露到看板）。

**如果通过**：按 A-lite → A → B 的顺序推进：

1. **A-lite（0.5 人日，建议现在就做）**：README 写清"关键交付物的 best-of-N 配方"（`subagent` 并行产 2–3 份 → `verifier_select` 选优 → **同时看绝对分数**，相对最优不等于够好）；并把 `verifier_select` 工具描述里那句 `do not generate extra candidates merely to invoke this tool` 改成**有条件允许**（仅当候选是最终交付物、且选错代价高）。注意：自动路由**已经**会把多个 `subagent` 产出识别成 `select` 路由（`router.ts` 的 `HINT_ARTIFACTS`），链路是通的，缺的只是"告诉 Agent 可以这么做"。
2. **A（可选，1–2 人日）**：确有需求再包 `verifier_best_of_n(task, n≤3)` 便利工具；必须**失败即报错**（不得静默退回第 1 份）、必须**同时回报绝对分数**、必须计入现有预算与 `estimateRoutedCalls` 口径。
3. **B（`llm/stream` 拦截）**：触发条件 = ①判别探针通过；②A 上线后有真实使用记录且统计显示"选优确实带来更好交付"；③P0 成本项与 P2-1 评测落地。三条同时满足再立项 spike。

### 5.2 顺带发现（并入 P1-2 一起修）

决策快照对"最终验收"这类 6 次调用的路径**只会存下前 3 次**：`decisions.ts` 的 `MAX_RECORD_CHARS=30000` 遇上 8000 字符/提示词的上限，第 4 条调用触发 `break`，而且留下的是**完成顺序**里最快的那几条（实测标签为 `Specification Adherence repeat 1`、`repeat 2`、`Output Match repeat 1`——缺 `Output Match repeat 2` 与整条 `Error Signal Detection`）。
后果：P1-2 的判决卡若基于这份数据，会呈现"判据不完整"的假象；"为什么判官这么说"恰恰在最贵、最关键的路径上缺一半证据。
建议：验收路径改成**确定性抽样**（每判据每轮各留 1 条，text 预算不足时先压缩单条），而不是按完成顺序截断；并补一条断言"6 次调用必须留下 6 条记录"。

---

## 6. 排期建议

| 阶段 | 内容 | 工作量 | 出口标准 |
|---|---|---|---|
| 第 1 步 | P0-1 + P0-2 + P0-3 | 1.5–2.5 人日 | 单测锁定预热顺序与调用数不变；看板能看到 provider 前缀缓存命中率由 ~30% 升到 ~60% |
| 第 2 步 | P1-1 + P1-2 | 3.5–5 人日 | 判据预设可切换且默认行为逐位不变；判决卡可读；i18n 两份键对齐；README 配置表更新 |
| 第 3 步 | P1-3 + P2-1 | 3–4.5 人日 | 自检按钮可用；阈值扫描表产出，并据此复核 0.65 与逐判据下限 |
| 待决策 | §5 选项 A（可选 B spike） | 1–2 人日（B 另计） | 有你明确的"要/不要"再动 |

每一步都必须走 `pnpm run verify:release`，改 `src/` 后连同 `lib/` 一起提交（规矩第 1、2 条）；新增配置项要同时改 schema、`resolveConfig`、UI、两份文案、README 表格（规矩第 10 条）。

---

## 7. 附：直接结论清单

- **白拿的省钱项**：P0-1（预热每个不同前缀）。零额外调用，实测数据支持，输入成本近乎砍半。
- **该学的产品化**：判据成套 + 可预览（P1-1）、判决可解释（P1-2）、自检（P1-3）。
- **该学的严谨**：用 benchmark 说话（P2-1）。我们目前只有"内部一致"，没有"确实有用"。
- **不该学的三条红线**：静默改写任务（context refinement）、静默 fail-open（返回第 1 个候选）、无语义保证的"多数票即最优"。
- **需要你拍板的**：§5 —— 是否给插件加一条"生成侧"通路（先做 A，B 待评测能力就位）。

---

## 8. 实施记录（本轮已完成）

| 条目 | 状态 | 落地位置 |
|---|---|---|
| P0-1 每个不同前缀预热一次 | ✅ | `engine.ts` `compare`/`track`；`engine.test.ts` 锁定"顺序改变、调用次数不变" |
| P0-2 相同候选短路 / 去重 / 空白拒绝 | ✅ | `engine.ts`；verdict 新增 `identical` / `identical-candidates` |
| P0-3 前缀缓存命中率指标 | ✅ | `statistics.ts` `prefixCacheHitRate`；看板与两份 i18n |
| P1-1 判据预设 + 自定义 Markdown + 解析器 DX | ✅ | `core.ts`（`CRITERIA_PRESETS`/`parseCriteriaMarkdown`）、`criteria.ts`、`config.ts`、设置页与预览、README |
| P1-2 决策快照等额分配（修 3/6 截断）+ 判决卡 | ✅ | `decisions.ts`（按调用数平均分配 + 标签排序）、看板"查看详情" |
| P1-3 判官自检 | ✅ | `index.ts` `{kind:'probe'}` + 看板按钮（30s 超时、不重试、不记账） |
| P2-1 离线回放 / 阈值扫描 | ✅ | `replay.ts` + `lib/replay.js` + `scripts/eval-replay.mjs` + `replay.test.ts` |
| P2-2 第三评分通道（prefill/结构化输出） | ⏸ 观察项 | 未动代码；等 DSH 暴露对应选项 |
| P2-3 `track` 未来泄露说明 | ✅ | README「四工具自动调度」一节 |
| A-lite best-of-N 配方 + 工具措辞 | ✅ | README 新增一节；`verifier_select` 描述改为"何时值得生成候选" |

### 8.1 首次回放结果（本机真实数据，2026-09-13）

`node scripts/eval-replay.mjs`：3 个话题、17 次调用、14 次门控验收。

- **阈值 0.5–0.9 全部 14 次通过**，因为判官对每次会话都给出 1.00（`scores-v1.json` 中 78/78 条比较都是 1.0/0.0 极值，全部走 `explicit-tag` 通道）。
- 解析器回放：15 条显式标签回答 **全部 match**，无 drift。

结论：**现阶段最该修的不是阈值，而是判官的区分能力**（判别探针仍未通过）；阈值扫描工具已就位，换判官/换通道后重跑即可对比。这也把 §5.1 的前置条件从"待做"变成了"有工具可做"。

