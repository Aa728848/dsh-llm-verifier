# AGENTS.md

面向在本仓库工作的编码代理。**人类读 `README.md`，本文件只放“每次会话都必须遵守的规矩”**：命令、结构、硬约束、以及“看着像 bug 但其实是有意设计”的清单。

## 这是什么

`dsh-llm-verifier` 是 DeepSeek Harness（DSH）的插件：给主 Agent 配一个独立裁判模型，复核候选方案、任务进度与会话交付，并支持宿主机自动门控。生效的产物是 `lib/`（宿主加载的就是它），TS 源码在 `src/`。仓库同时支持 DSH 0.1.1 与 0.1.5 两条宿主线。

## 命令

```bash
pnpm run build           # 清空 lib/ → tsc 生成 lib/types → tsdown 打包 ESM + 客户端 CJS → 刷新已安装该插件的 profile 副本
pnpm run typecheck       # 按 package.json 锁定的 @deepseek-ai/dsh-* 检查（发版门禁用这份）
pnpm run typecheck:local # 先跑 scripts/check-harness-types.mjs 校验宿主产物新鲜度，再按 ../deepseek-harness 的实际类型检查
pnpm test                # vitest run，全部单测
npx vitest run src/router.test.ts   # 跑单个文件
pnpm run verify:release  # typecheck + test + build，prepublishOnly 会自动调用
node scripts/eval-replay.mjs   # 离线回放（无模型调用）：阈值扫描 + 解析器 drift，需先 build
```

- 受限沙箱下 `pnpm test` 可能因 esbuild 的 piped stdio 报 `spawn EPERM`，属于沙箱边界而非代码问题。
- `pnpm run typecheck` 与 `typecheck:local` 结论可能不同，**一律以 package.json 锁定的 npm 版本为准**。
- `tsconfig.local.json` 把 `@deepseek-ai/*` 映射到 `../deepseek-harness/*/lib/types`，那是**构建产物**。映射目标不存在或比源码旧时，TypeScript **不会报错**，而是静默回退到 `node_modules` 的锁定版本——看起来是绿的，实际验的是旧宿主。`scripts/check-harness-types.mjs` 就是拦这个：它按 `paths` 反推包根，比对 `lib/types` 与 `src` 的 mtime，不新鲜直接失败并给出重建命令。应急可用 `DSH_VERIFIER_SKIP_HARNESS_CHECK=1` 跳过。
- 客户端面（`client/ui-settings`、`client/ui-conversation`、`client/locale`、`api/remotes`）依赖 harness 的可选依赖才能 emit，缺依赖时它们会一直停在旧产物上——`typecheck:local` 对客户端面的结论因此可能不完整。

## 仓库结构

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件装配：五个工具注册、三个生命周期钩子、`llm/stream` 过程选优接线、设置/RPC 路由、对外导出 |
| `config.ts` | 配置 schema（schemastery）+ `resolveConfig` 严格校验 + 设置命名空间安装 |
| `core.ts` | 纯函数：A–T 标尺、`extractScore`/`extractProgressScore`、提示词构造、锦标赛与 Bradley–Terry |
| `caller.ts` | 模型调用：统一超时/重试包装 `retrying()`、显式标签通道、并发限制器、通道预测、best-of-N 生成 seam |
| `top-logprobs.ts` | 直连 OpenAI 兼容 / deepseek-official 的 logprobs 通道 + 能力记忆（含 TTL） |
| `pricing.ts` | 判官/草稿四层定价（手填 > 本机 pi-ai > models.dev > 未定价），精准匹配 provider+model，绝不跨厂商猜价 |
| `cache.ts` | 评分持久化缓存、in-flight 合并、`stableHash` |
| `engine.ts` | compare / select / track 编排、位置交换、多裁判中位数聚合与统计汇总 |
| `session.ts` | 会话提取、脱敏、`sanitizeVerifierText` 限长、事件访问兼容层 |
| `router.ts` | 结构化 + 语义路由、证据索引、reservation/commit/fail 状态机、预算估算、检查点渲染上限 |
| `auto.ts` | 自动验收策略判定（`analyzeAutoTask` / `sessionAccepted`）、子 Agent 识别、低分定位反馈文案 |
| `plan-gate.ts` / `team-gate.ts` | `exit_plan_mode` 预审 / Agent Teams 任务验收 |
| `workspace.ts` | 宿主 `workspaceChanges` 探测与真实文件改动证据渲染（改动清单 + 逐文件对比，双层限长、失败静默降级） |
| `statistics.ts` | 调用记录持久化与多话题聚合 |
| `process-selection.ts` | P06 请求级过程选优：`llm/stream` 意图绑定、原回复缓冲、备选生成、比较、胜者原样回放、侧车记录 |
| `topic-storage.ts` | 侧车目录解析（随话题生命周期归档/清理） |
| `images.ts` | 图片证据加载（data URL / HTTPS，含超时与主机限制） |
| `client.tsx` / `client-i18n.ts` | Web 设置页与统计看板、中英双语字典 |
| `client-judges.ts` | 设置页“附加裁判”编辑器纯函数（规范化 / 冲突检测 / 序列化） |
| `client-fields.ts` | 设置页声明式字段注册表、分区元数据、`validateValues`、快速预设与 `activeProfile` |
| `decisions.ts` | 决策快照（脱敏提示词 + 原始回答）的持久化与限量分窗采样（单次调用 ≤ 32次，单条 ≤ 3万字） |
| `criteria.ts` | 判据解析：内置预设直取，自定义 Markdown 缓存重读，失败安全回退至 coding |
| `replay.ts` | 离线回放：重放阈值、重放解析器、汇总周期与分臂读数（配套 `scripts/eval-replay.mjs`） |
| `.agents/notes/` | Agent Notes：非平凡变更的决策日志（格式与纪律见 `.agents/notes/README.md`） |

## 硬性规矩

1. **改 `src/` 必须 `pnpm run build` 并连同 `lib/` 一起提交**。`lib/` 是宿主加载的入库产物。`build` 脚本已集成 profile 刷新与解除硬链接（`breakHardlinks`），防止 Windows NTFS 64位 FileId 碰撞引发 `npm publish` 报 `415 Hard link is not allowed`。
2. **提交前跑 `pnpm run verify:release`**。提交信息遵守英文 conventional commits（`fix:` / `feat:` / `chore:`），版本号单独一次 `chore: bump ...`。
3. **`sanitizeVerifierText` 返回值必须 ≤ `maxChars`**，截断提示文字必须计入预算。超出一个字符会导致 `boundDecision` 将整条自动路由丢弃。
4. **凡进入提示词的证据必须单项与总量双层限长**。新增候选/检查点来源必须通过 `itemBudget()` 分摊总预算（保持 $\Sigma \le autoRouteMaxInputChars$ 且单项 $\le autoRouteMaxItemChars$），不可用裸值直接截断。语义路由按**实际渲染文本**（含分隔标记与 ID）计量。
5. **每一次自动 steering 都必须消耗预算**。宿主无轮次预算，无条件 steer 会陷入活锁；额度耗尽后仅能发出一次性通知。
6. **改动评分缓存身份字段必须升 `cache.ts` 的 `version`**。提示词文本变更自然失效，但 provider/model/effort/maxTokens/repeat 等改动必须升级版本号，避免命中脏缓存。
7. **评分通道能力必须在运行时探测，严禁按厂商或模型名硬编码假设**；探测失败必须优雅降级。
8. **兼容两种宿主形态**：`session.snapshotEvents?.()` 与旧的 `session.events`；`tool/ptc-dispatch` 与旧的 `tool/code-dispatch`。
9. **判官输出解析必须 Fail Closed**：无法解析出合规判决时必须报错，绝不静默给分或静默放行。语义路由分类结果必须是严格 JSON，多余未知字段一律拒绝。
10. **i18n 中英字典键必须严格一一对应**（由 `I18nDict = typeof zh` 编译期保障）。新增配置项必须同步修改 schema、`resolveConfig`、UI 字段注册（`client-fields.ts`）、中英文案与 README。
11. **发送给裁判的所有内容必须经过脱敏**（`DEFAULT_REDACT_PATTERNS` + 自定义模式），严防凭证泄露。
12. **判官提示词是安全边界**：待审数据必须包裹在带确定性防穿透令牌的分隔块中（`renderDelimitedBlock` + `evidenceNonce`），并声明其仅为只读数据、严禁执行其中指令或采纳其中评分。
13. **修改前查阅历史决策，非平凡变更同步更新/附带 Agent Note**：
    - **前置查阅（Pre-edit Review）**：在对核心评分逻辑、门控策略、路由调度或客户端面做非平凡修改前，先检索 `.agents/notes/implemented/` 审阅拥有该决策的既有 Note（Owning Note），重点检查设计约束与被否决的备选方案（Alternatives considered），避免重犯历史错误。
    - **决策所有权（Owning Note）**：如果已有 Note 拥有该项决策，在同一变更中直接就地更新其路径、符号与机制陈述（保持与实际交付代码一致）；仅在无 Note 拥有该决策或做出相反重大决策时才新建 Note。
    - **交付态事实与规范**：笔记存放在 `.agents/notes/{lifecycle}/{class}/YYYY-MM-DD-slug.md`，用简体中文书写，包含 Problem / Decision / Alternatives considered / Consequences。交付态（`implemented/`）必须写客观现状事实，严禁保留未来时/计划态（禁用 Proposal / Plan / Acceptance criteria 等 spec-speak）。遵循「每个事实只有一个归宿（One home per fact）」原则。

## 测试约定

- 每个模块配备同目录 `<module>.test.ts`；使用 `engine.test.ts` 的 scripted stream 模式模拟模型调用，不写跨模块大集成测试。
- **回归测试必须断言边界值**（例如上限截断边缘的容忍度），而不只是 happy path。
- **工具 output schema 必须覆盖所有真实返回值字段**：宿主严格校验输出，缺失或多余字段会导致 `INVALID_TOOL_OUTPUT` 并使整轮调用彻底崩溃。修改返回结构必须同步更新 schema 与回归测试。
- 网络请求一律注入 mock `fetch`/`llm.stream`，禁止真实外网请求。
- `parity.test.ts` 依赖同级 `../llm-as-a-verifier` 仓库，缺失时跳过（非报错）。

## 已知的有意设计（切勿随意"修复"）

### 1. 验收与门控核心

- **固定基线与逐项阈值**：最终验收以 `core.ts` 的 `EMPTY_WORK_BASELINE` 为固定 0 分基线，要求 `winner === 'A'`。同时要求**每一项标准各自达到阈值**（`sessionAccepted`），绝不能用均值掩盖单项彻底失败。
- **轮次与位置偏好抵消**：最终验收默认 2 轮（偶数轮交换 A/B 位置消除偏好）。`compare` 在运行时向上取整到偶数；`select` 的 ring 对称且 pivot 轮逐对平衡；`track` 无位置偏好，保持配置轮次。
- **显式验收校验**：显式调用 `verifier_current_session` 只有在分数达标、覆盖当前任务起点且评审区间未过期（以被评审的 `toSeq` 判定）时，才算作任务已验收；绝非只要调用过就放行。
- **门控范围约束**：子 Agent 会话默认不门控（`autoVerifySubagents=false`）。`exit_plan_mode` 计划预审通过不标记任务完成（不设置 `finalRequiredFromSeq`），避免触发空工作验收。Agent Teams 的 `team-message` 视为有效任务边界。

### 2. 路由与调度策略

- **额度相互独立**：路由额度（`maxRoutePerTask`）与最终验收额度（`maxFinalPerTask`）各自独立计数，严禁合并为共享计数器，以确保最终验收始终有保留额度。
- **路由周期与原子提升**：一次语义分类成立时，在同一预约上原子提升到对应工具，共用同一次路由尝试和 `cycleId`。分类指纹采用渲染后提示词的哈希（`promptHash`），非结构变化不重复扣费。
- **检查点证据判据唯一源**：统一使用 `router.ts` 的 `isEvidenceOutput(name, text)`。记账/协调类工具、插件自身工具（`verifier_*`）、后台子 Agent 启动回执均不作为观测证据。最新检查点通过 `verificationEvidence` 附带最近一次验证运行结果与 `trailingSummary` 辅助判断。
- **Smart 模式下 track 仅作为观察**：`track` 不无条件触发 steering。有诊断时发诊断；已完成或低分且无定位诊断时，直接落入最终验收；低进度绝不可跳过最终验收。
- **交付阶段快路径**：当前任务 Todo 全部完成且存在真实有效验证运行时，停止边界跳过过程进度路由，直接进入最终验收。

### 2b. 真实文件改动证据（`workspace.ts`）

- **只走 context seam，不进 route decision**：验收路径（显式 `verifier_current_session` 与自动最终验收）经 `CompareOptions.context` 附带宿主机
  `workspaceChanges` 的摘要与逐文件对比；**绝不**把它并进 route decision 的 lengths（那条要过 `boundDecision`，多一个字符就整条丢弃）。
- **探测失败一律降级**：`ctx.get('workspaceChanges')` 缺失、`summary`/`diff` 非函数、会话已销毁、`diff` 抛错，全部返回空证据（必要时
  `ctx.logger.warn`）并让验收照常进行。**不要**把它加进 `index.ts` 的 `inject`，也不要 import 宿主类型——那会让插件在 0.1.1/0.1.5 宿主上不加载。
- **双层限长**：整块 ≤ `autoRouteMaxItemChars`（即单个提示词项），文件数上限 `MAX_WORKSPACE_FILES`，其余字符按 `itemBudget(files.length, maxItemChars, contentBudget)` 分摊；
  表头与分隔符也计入预算。二进制/超大文件只渲染一行且**不调用** `diff`。

### 3. 评分引擎与判官通道

- **概率期望处理**：同一字母的多个 token 变体概率必须相加（`extractScore`），不可取 max。显式标签通道无质量下限（归一化处理）。
- **参数基准**：判官温度默认 `0.2`（提高复现率）。判据预设默认必须是 `coding`，且与 `DEFAULT_CRITERIA` 为同一引用；自定义判据解析失败安全退回 `coding` 并汇报原因，不得造成门控失效。
- **多裁判聚合**：`judges[0]` 恒为主裁判，多裁判采用中位数聚合。单裁判配置下逻辑与输出与历史版本逐位一致。
- **判官自检是诊断而非验收**：自检走独立通道，调用前必须先清除缓存记忆（`topLogprobCapabilities.forget`），结果不计入调用统计与评分缓存；支持在无当前会话的全局看板运行。
- **逐字节相同候选短路**：两侧完全相同时直接返回平局（0.5/0.5），不发模型请求；绝不采纳上游“多数票直接放行未评判候选”的做法。

### 4. 过程选优（P06）

- **生命周期接线**：仅通过 `llm/stream` 拦截主请求，默认关闭。识别主循环只认宿主的私有 WeakSet 标记（`isAgentLoopRequest`），备选请求用独立对象派发，杜绝二次拦截。
- **投机并发与原样回放**：意图登记后先买周期并投机生成备选，缓冲原回复（上限 1 MiB）。胜者按原始 chunk 原样回放，保持宿主自身的状态与报错语义。
- **原子动作与独立脱敏**：候选动作以块为原子单位，不可拆分截断；任务、约束、执行轨迹按实际渲染文本分摊预算，各自独立脱敏限长，装不下时安全回退原回复。
- **判据与备选生成**：使用失败靶向判据 `PROCESS_CRITERIA`；备选请求温度只抬高不压低（`Math.max(1.0, temp)`）；可选故障上下文（`autoProcessFailureContext`）以用户消息追加但不向裁判透露来源。
- **决策点重新校验**：在购买前、生成后、比较后及首个 chunk 回放前各检查一次有效性（`staleReason`），若取消或关闭开关，及时更正交付标记与账目记录，避免状态幽灵交付。
- **侧车持久化**：触发与消费事实记录于话题侧车 `verifier/process-selection-v1.json`，每任务最多购买一次周期。

### 5. 生成侧工具（Best-of-N）

- **独立定位**：`verifier_best_of_n` 是唯一的生成侧工具，绝不参与自动路由。
- **生成参数**：调用当前会话模型并行起草，温度固定 `1.0`，单份 `maxTokens` 固定为 `16384`（确保推理模型输出完整）。幸存候选少于 2 份时 Fail Closed 报错。
- **基线比较不可省略**：草稿排序走 proposal 判据，排序胜者**必须**再与 `EMPTY_WORK_BASELINE` 进行一次交付判据比较以获取绝对分；两阶段 context 必须通过 `renderReferenceContext` 渲染完全一致的文本。

### 6. 观测、脱敏、账目与设置

- **决策快照仅供观测**：快照仅记录真实模型调用，经脱敏后写入本话题 `verifier/decisions-v1.json`（单次调用上限 32 次、单条上限 3 万字且按调用数均匀分窗，超出均匀抽样保留首尾），不参与任何判定。
- **失败行用量保全**：任何阶段报错或取消，已产生及在途的模型调用 token 必须通过 `partialStats`/`carried` 完整汇总至统计行，严禁记为全零。
- **四层定价规则**：手填 > 本地 pi-ai 目录 > models.dev 快照 > 未定价（0）。严格按精确 provider+model 匹配，绝不跨厂商猜测价格；缓存 token 走专用单价。
- **设置页单一定义源**：默认值唯一存在于 `client-fields.ts` 的 `CONFIG_DEFAULTS`。前端校验仅严格镜像 `resolveConfig` 实际规则；非必填字段（如 `criteriaFile`、`priceProviderOverride` 等）允许为空。
- **设置保存语义**：优先使用 `settings.replace`（整层替换），宿主不支持时退回带 `{reInheritBase: false}` 的 `update`，确保清空覆盖项和恢复默认生效。

### 7. 宿主版本兼容（0.1.6 对齐）

- **`snapshotEvents()` 是有豁免的调用，不是待清理的遗留**：DSH 0.1.6 废弃了 `eventAt()` / `snapshotEvents()` / `ownEvents()`，并**连包装它们的新别名也一并禁止**——`session.ts` 的 `sessionEvents()` 正是这种包装，仍刻意保留。官方替代品 `SessionController.page()` 只放行 `user/message` 与 `assistant/message`，`tool/call`、`tool/result`、PTC dispatch 这些**证据来源全都取不到**；宿主自己的 `auto-review` 也挂着同样的豁免。迁移方向是改用注册式 Session projection 增量维护证据，决策记录见对应 Agent Note。**不要**因为看到 `@deprecated` 就把它换成 `page()`。
- **`PreToolDecision` 的 `info` / `cancel` 是有意的跨版本发射**：0.1.6 才引入这两个字段，而插件仍声明支持 0.1.1–0.1.6。`tool-decision.ts` 是唯一适配点：`info` 在旧宿主只读 `reason` 时被忽略；`cancel` 只在**信号确已中止**时发出，因为旧宿主对未知 `kind` 会落到它自己的 `callerCancelled(exec)` 检查，正好是 0.1.6 `cancel` 选中的同一条取消路径。**前提是信号真已中止**，否则会误拒一个活调用。
- **`peerDependencies` 必须覆盖实际运行线**：semver 的 `^0.1.6` **不匹配** `0.1.6-alpha.2` 这类预发布版，新增版本线要照现有写法显式列出预发布形态（`^0.1.6-alpha.1 || ^0.1.6-alpha.2 || ~0.1.6`）。

## 宿主契约速查（`../deepseek-harness`）

| 依赖点 | 位置 / 约定 |
|---|---|
| `agent/turn-stopping` | 被 await，steer 仅续当前同一轮次 |
| 轮次预算机制 | 宿主无内置轮次预算，插件必须自行控制 steering 预算 |
| `tools/pre-execute` | 返回 `{kind: 'deny', reason}` 实施阻断拦截 |
| `Agent.id` | 强制等于 session id |
| `session.snapshotEvents()` | 优先于旧版 `session.events` 兼容读取事件快照 |
| 子会话识别 | 依赖 `parentSession` 或 `origin: 'subagent'` |
| 设置读写语义 | ⚠️ `update` 为增量合并，`replace` 为整层替换（清除覆盖需用 replace） |
| `llm/stream` 拦截 | waterfall 形式 `(options, next) => AsyncIterable<StreamChunk>` |
| 主循环请求标记 | `isAgentLoopRequest()` 基于模块私有 WeakSet，故 `@deepseek-ai/*` 必须 external |
| 侧车数据定位 | 依赖 private `locate()/root` 路径进行持久化关联 |

## 发布

`pnpm publish` 触发 `prepublishOnly`，自动执行 `pnpm run verify:release`（按锁定版本运行 `typecheck`、`vitest` 及重建 `lib/`）。打包内容由 `package.json` 中的 `files` 字段声明（`lib`、`src`、`scripts`、`cordis.patch.yml`、`README.md`）；发版前需单独通过 commit 递增版本号。
