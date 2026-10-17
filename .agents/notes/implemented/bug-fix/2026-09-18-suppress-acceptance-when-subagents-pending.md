# Agent Note: 子代理在途（等待调度）时抑制最终验收门禁

Status: implemented

## Problem

在多 Agent 协作或异步委派场景下，主 Agent 经常需要启动后台子代理（`subagent` / `subagent_fork` 或后台任务）开展事实核查、方案起草或分析调研。按照 DeepSeek Harness 的设计规范：
- `subagent` 默认在后台运行（返回 `started subagent <childId>` 或 `started background subagent job <jobId>`）；
- 主 Agent 发出委派并向用户报告当前状态后结束本轮回复，等待子代理结算通知（`subagent-settled` 或任务完成消息）由宿主唤醒。

然而在此停顿阶段（`agent/turn-stopping`），自动验收门禁出现严重误判：
1. 主 Agent 往往在派出子代理前执行过只读/分析或环境准备工作（或经 `run_code` 执行），满足了 `analyzeAutoTask` 的实质性工具调用门槛，被误判为「具备验收资格（eligible）」；
2. 裁判模型介入审查会话全貌，由于子代理尚在运行、最终分析结论尚未产出，裁判严格比对基线必然判定「验收未通过」；
3. 门禁据此注入 steering 提示词（`[Automatic verifier gate] ...`），强行命令主 Agent「停在等待子代理阶段、未交付结论，请立即交付」；
4. 主 Agent 被打乱调度节奏，误以为子代理已完成或试图通过 `job_list` / `send_message` 强行收割未就绪的子代理，导致工具调用连续报错和交互混乱。

DSH 0.2.1 对齐审查又确认动态补充探针存在两处既有失配：`subagents.listChildren()` 返回的是持久目录项（没有 `kind: 'child'` / `activity: 'running'`），旧条件因此永远筛不出活动子 Agent；`jobs.list()` 的 caller 参数是 SessionId，旧代码却传入整个 Agent 对象，导致 owned Job 也被过滤。它们不影响会话日志主路径，但会让运行时补充探针失效。新版 managed activation 已移除 Job-backed delegation，因此不能再用新 Job 事件掩盖这两处读取错误。

## Decision

1. **会话事件层在途识别（`hasPendingSubagents`）**：
   在 `auto.ts` 增加 `hasPendingSubagents(events, taskStartSeq)` 与 `AutoTaskEvidence.pendingSubagents`：
   - 提取自任务起点以来的所有后台子代理启动回执：包括直接工具调用与 PTC / code-dispatch 派发，识别 `started subagent <childId>` 与 `started background subagent job <jobId>`；
   - 追踪其是否在后续事件中收到结算消息：包括宿主注入的 `source.kind === 'subagent-settled'`（匹配 `senderSessionId` 或正文标识）以及后台任务结算通知（`tool-jobs` 插件通知或终止状态工具调用），或显式中断（`interrupt_agent` / `job_kill`）；
   - 前台同步子代理（`run_in_background: false`）直接返回结果文本，不视作在途。
2. **策略判定闭环**：
   - 若存在尚未结算的子代理，`analyzeAutoTask` 返回 `pendingSubagents: true`、`eligible: false`，原因标识为 `pending-subagents`；
   - 在 `agent/turn-stopping` 中，结合宿主运行时探测（`hasLiveActiveSubagents` 探测 `ctx.agents` 与旧版 `ctx.jobs` 存活状态），只要子代理在途：
     - 跳过交付就绪快路径（`deliveryReady` 为 false）；
     - 进度路由（`track`）不标记交付优先（`preferFinal`），也不向最终验收下落；
     - 最终验收门禁直接跳过并关闭回合，不调用裁判模型、不注入任何错误或阻断警告，静待宿主子代理结算通知自然唤醒下一轮。
3. **动态探针以真实执行状态为准**：`hasLiveActiveSubagents()` 使用与宿主 `archive-admission` 相同的 `AgentRegistry.list()` 读取方式，按 `session.header.parentSession` 与 `origin: 'subagent'` 建立父子关系，以 visited 集合防环，发现任一 `status === 'running'` 的后代即判在途。旧 Job-backed 路径仅作兼容回退，并调用 `jobs.list(agent.id)` 取得当前 Session 可见的 Job；新版 managed activation 继续由第 1 条的启动回执与 `subagent-settled` 覆盖。

## Alternatives considered

1. **仅在裁判提示词中补充说明“子代理正在运行中，请放行”**：否决。裁判提示词的放行规则无法可靠阻止低分判定；且在子代理工作未完成时做验收属于无效消耗 Token。
2. **仅在主 Agent 文本中正则匹配“子代理已派出”**：否决。自然语言表述多变且易被伪造，无法保证准确度与版本稳定性；协议级工具回执与结算事件才是权威源。
3. **只依赖宿主动态服务探测（`ctx.agents` / `ctx.jobs`）**：否决。离线回放（`eval-replay.mjs`）与部分宿主环境缺乏运行时句柄，必须以会话事件日志为基础、以动态探测为补充，确保双模兼容与优雅降级。
4. **用 `listChildren()` 或 `listDescendants().activity` 替代 AgentRegistry 状态**：否决。前者只给持久目录身份，后者的 `activity` 表示 Session 是否驻留；continuable 子 Agent 结算后仍可能驻留，而 external activation 又没有本地 Session，两者都不能表示“执行尚未完成”。

## Consequences

- 主 Agent 派出后台子代理后可自然停止等待结算，不再被验收门禁误判打断或强行 steer；
- 待子代理结算消息注入并由主 Agent 在后续回合完成最终答复后，验收门禁在子代理全部结算的状态下恢复正常判定；
- `AutoTaskEvidence` 新增 `pendingSubagents: boolean` 字段，保持类型与向后兼容性。
- 动态补充探针恢复实际判别力：`index.test.ts` 覆盖运行中后代、idle/无关分支、旧 Job 的 SessionId 调用与 stopping 状态、非 subagent Job 以及服务缺失降级。新版 managed activation 不需要伪造 Job 生命周期事件。
