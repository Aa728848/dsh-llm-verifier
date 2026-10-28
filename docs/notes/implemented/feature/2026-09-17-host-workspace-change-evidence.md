# Agent Note: 宿主真实文件改动证据 —— 让验收建立在真实 diff 上

Status: implemented

## Problem

会话验收（显式 `verifier_current_session` 与自动最终验收）此前只能从会话事件里的 `tool/call` 参数推断「Agent 声称改了哪些文件」。
这条通道天然可被自己欺骗，而且不是「有意作弊」才会出问题：

- Agent 描述了要写的补丁，但工具调用失败 / 被拒绝 / 写到了别处；
- 文件写完又被后续步骤改回或再次改写，轨迹里两条相反的声明都在，判官无从判断哪条是当前状态；
- 走过 `shell` / 脚本的改动完全不出现为文件写工具调用，判官看不到任何文件级证据。

结果是「声称改过」与「真的改过」在提示词里无法区分，而验收恰恰要判的就是后者。

DSH 0.1.6 新增宿主服务 `ctx.workspaceChanges`（包 `packages/deliverables/workspace-changes`）：每个顶层轮次结束时宿主把
`workspace/changes` 事件追加进会话，摘要保留到会话销毁为止，`summary(sessionId, seq)` 给出该轮的改动文件清单
（`display`、`added`、`deleted`、`binary?`、`oversized?`，另有 `total`/`cwd`/`snapshot`），`diff(sessionId, seq, index, signal)`
按文件给出前后对比（`kind: 'text'` 带 `@@` 块与逐行 `+`/`-`/空格前缀，或 `kind: 'binary' | 'oversized'`）。

## Decision

1. **新增 `src/workspace.ts`**，用**结构化类型**描述宿主服务的切片（`WorkspaceChangeSource`），**不 import 宿主类型**：
   否则插件在 0.1.1/0.1.5 宿主上编译不过——这正是本仓库要同时支持两条宿主线的原因。
   - `probeWorkspaceChanges(ctx)`：`ctx.get('workspaceChanges')` 后检查 `summary`/`diff` 都是函数，否则返回 `undefined`；
     `ctx.get` 抛错也返回 `undefined`。不做任何按版本/厂商的假设。
   - `renderWorkspaceChanges(events, sessionId, source, budget, signal)`：取**最新**一条 `workspace/changes` 事件（调用方已把事件按
     被评审区间过滤），向 `summary` 要清单，逐文件调 `diff`，渲染成紧凑文本。
2. **接线走已有的 `CompareOptions.context` seam**（`core.ts` 的 `buildPairwisePrompt` 把它渲染成 `CONTEXT` 分隔块）：
   因此天然共用确定性 nonce、共用声明「只读数据」的安全边界，并进入 `promptHash` —— 改动不同即缓存未命中，无需升 `cache.ts` 的 `version`。
   接线点是 `verifySession`（`src/index.ts`），显式工具与自动最终验收**共用**这一处，两条路径都拿到证据。
   该路径**不**经过 `boundDecision`，证据也**不**并入 route decision 的 lengths。
3. **双层限长**：整块（含表头、分隔符、截断提示）≤ `autoRouteMaxItemChars`——它是一个提示词项；文件数上限 `MAX_WORKSPACE_FILES = 8`
   （超出在表头写明「showing the first N」）；剩余字符用 `itemBudget(files.length, maxItemChars, contentBudget)` 分摊，
   其中 `contentBudget = min(maxInputChars, maxItemChars) - 表头 - 文件数`（表头与分隔符是渲染文本，先记在总预算里）。
   逐文件按行截断并把「还有多少行没显示」计入同一份预算（必要时逐行让位给这条提示），最后整块再过一次
   `sanitizeVerifierText(text, maxItemChars)` 作为硬保证。
4. **`binary` / `oversized` 文件不调 `diff`**：宿主的答案已知（它在摘要里就标了），调用只是白读一次快照。
5. **失败一律降级，绝不阻断验收**：无事件、`summary` 返回 `undefined`、`diff` 抛错、`diff` 返回 `undefined`、预算非法，全部退化为
   「少一条证据 / 空串」，并通过可选的 `warn` 回调（调用方接 `ctx.logger.warn`）留下记录。验收在这时已经花掉判官预算，
   绝不能因为拿不到 diff 而失败。
6. **配置项 `autoWorkspaceEvidence` 默认 `true`**，按第 10 条硬规矩同步：`config.ts`（接口 / schema / `resolveConfig`）、
   `client-fields.ts`（`Values` / `CONFIG_DEFAULTS` / `FIELDS` 的 `routing` 分区 / `valuesFromView` 的 `!== false` 写法）、
   `client-i18n.ts` 中英两键、`README.md` 配置表一行。未加入 `POLICY_KEYS`：它是证据来源开关，与 `captureDecisions` 同类，
   不该被「快速配置」预设改写。

## Alternatives considered

1. **把证据并入 route decision 的候选/检查点证据（走 `itemBudget` + `boundDecision`）**：否决。那条路的每条决策都受
   `maxItemChars` / `maxInputChars` 双重硬校验，多一个字符就**整条自动路由被丢弃**；把一份体量不可控的 diff 塞进去，
   风险是「路由没了」而不是「证据少了」。验收路径不需要 `boundDecision`，用 `context` seam 更安全。
2. **`import type { WorkspaceChanges } from ...`**：否决。会让 `tsc -p tsconfig.build.json`（0.1.1-rc.2 锁定版本）失败，
   等于放弃旧宿主兼容。
3. **把 `workspaceChanges` 加进 `index.ts` 的 `inject` 数组**：否决。`inject` 未满足时 Cordis 不会加载插件，
   在 0.1.1/0.1.5 宿主上等于整个插件消失。改为运行时 `ctx.get` 探测。
4. **按 `added + deleted` 排序取前 N 个文件**：否决。行数不代表重要性（`package-lock.json` 永远最大），
   而按宿主自己的 `display` 顺序裁剪是确定的，且让渲染文本（也就是评分缓存键）可复现。
5. **`diff` 返回 `undefined` 也算失败并告警**：否决。会话销毁后宿主就是这么回答的，那是正常回落，不是异常；
   只有真正 `throw` 才写告警。
6. **不脱敏，直接渲染 diff**：否决。diff 是文件内容，可能含凭证；必须与其它证据同走 `sanitizeVerifierText`。
   本模块对每个文件段与整块各做一次，两次调用都是同一入口，幂等。

## Consequences

- 验收现在能看到宿主观测到的真实改动：「Agent 说改了」与「宿主记录确实改了」的差别对判官可见；
  证据经 `context` seam 进入 `promptHash`，因此开启/关闭或改动内容都会让评分缓存自然失效，无需手动升版本。
- 只在**验收**路径生效：自动路由的 compare/select/track 与 `verifier_best_of_n` 不带该证据（它们的证据预算另有硬校验）。
- 单轮粒度：只渲染最新一条 `workspace/changes` 事件。跨多轮的任务只带最后一轮的改动清单——这是宿主服务的粒度
  （`summary` 按事件 seq 取），插件不去拼多轮摘要。
- 旧宿主（0.1.1/0.1.5）与无该服务的宿主行为**逐字节不变**：探测失败即无 `context`，提示词与缓存键与历史一致（`index.test.ts` 有回归断言）。
- 副作用面：`diff` 会触发宿主读快照，因此每个被渲染的文件多一次宿主侧读取（上限 8 次/次验收），失败不影响验收。
- `lib/` 产物由发版流程重建（本次未运行 `pnpm run build`，见验证基线）。
