# Agent Note: Agent 正常暂停或询问用户时抑制验证门禁与自动引导

Status: implemented

## Problem

当 Agent 在执行计划或任务过程中遇到阻碍、不确定性或需要用户决策时，经常需要暂停工作向用户询问（例如调用 `ask_user_question` 弹出选项窗口、将目标设为暂停或阻塞 `update_goal(action: 'pause' | 'blocked')`，或在回合末尾通过自然语言向用户提问并等待下一步指令）。

在原实现中，只要 Agent 在此前执行过实质性工具调用（如 `edit`、`pwsh` 等），`analyzeAutoTask` 即判定其具备验收资格（`eligible: true`）。在 `agent/turn-stopping` 停顿边界：
1. 由于任务尚未完成（如 Todo 列表未全部完成或工作尚处于半途），进度路由（`track`）在严格模式或有诊断时强制注入 `Continue the unfinished work` 等 steering 指令；
2. 在智能模式下落入最终验收门禁时，裁判模型比对未完成工作与空基线，必然判定低分不通过，从而注入 `[Automatic Verifier Acceptance Gate] ... The turn remains open; resolve the failed criteria`；
3. 宿主收到 steering 消息后阻止回合关闭，强行唤醒 Agent 继续执行。Agent 误以为暂停被否决，只能盲目猜测选项或强行修改，用户无法及时查看选项卡或输入指令，破坏了人机交互界限。

## Decision

1. **用户交互暂停状态探测（`inspectUserInteractionPause` / `pendingUserInteraction`）**：
   在 `src/auto.ts` 增加 `inspectUserInteractionPause(events, taskStartSeq, currentTurn)` 与 `isAwaitingUserText(text)`：
   - 若当前任务已进入交付阶段（`inspectDeliveryPhase` 判定 Todo 全部完成且存在真实验证运行），视为正常交付而非中途暂停；
   - 探测当前回合内是否调用了 `ask_user_question` 工具（支持原生 `tool/call` 与 PTC `tool/ptc-dispatch` / `tool/code-dispatch`），且该调用后当前回合未发生后续实质性工具调用；
   - 探测当前任务内是否存在未恢复的 `update_goal` 暂停或阻塞（`action: 'pause'` / `'blocked'`）；
   - 探测当前回合末尾的 `assistant/message`（排除带活跃 `tool-call` 的消息），提取其可见纯文本（通过 `narrativeText` 排除私有思维链），识别中英文明确询问用户、请求确认、等待指示或暂停执行的句式与问号结尾模式。
   - **许可征询句式（`需要/要不要/要我…？`、`want|like me to…?`、`等你决定/拍板/回复/确认`）是实践中最常见的暂停**：模型往往先提问、再继续补充论证，问号因此落在消息中部而非结尾，只扫结尾的问号模式与固定句式都会漏判。`USER_QUESTION_PATTERNS` 因此对整条消息匹配这些句式。该规则在 20 个已记录会话的全部回合末消息（44 条无工具调用的消息）上回放验证：原模式命中 8 条，补入后命中 13 条——找回 5 处真实暂停，且没有把任何一条交付报告误判为暂停。
2. **门禁与路由抑制闭环**：
   - `analyzeAutoTask` 返回 `pendingUserInteraction: true` 与 `eligible: false`（原因标识为 `user-interaction-paused`）；
   - `src/index.ts` 的 `agent/turn-stopping` 在入口处检查 `userInteractionPending`：一旦检测到 Agent 正处于等待用户交互状态，记录日志并立即 `return`，完全跳过 Team Task 验收、结构化进度路由、语义路由与最终验收门禁；
   - 在 `deliveryReady`、`preferFinal` 及回退分支中同步将 `userInteractionPending` 列为前置排他条件；
   - **`agent/pre-step` 走同一道边界**：S02 候选早评审与 P06 过程选优登记在做任何工作前先调用 `inspectUserInteractionPause`。该入口的暂停窗口绑定`payload.turn`（即宿主传入的当前回合号），因此上一回合遗留的暂停不会继续抑制操作者已经答复后的新工作；
   - 回合自然关闭，保留弹出的选项窗口与助理消息，静待用户回复或触发下一轮交互。

## Alternatives considered

1. **仅在裁判提示词中补充说明“如果 Agent 正在提问则放行”**：否决。由于任务尚未完成，裁判比对基线仍会因缺失交付物判定低分；且此时发起模型打分徒增 Token 消耗与延迟。
2. **仅检测 `ask_user_question` 工具而不检测文本提问**：否决。许多轻量询问或非选项型互动通过助理文本直接输出（如 Issue #3 明确提出的“停下来等用户指令”），漏判文本提问会导致大量常见人机交互场景依然被 steering 破坏。
3. **在检测到用户暂停时清空历史实质调用计数**：否决。历史修改仍然是本任务的真实状态，一旦用户在下一回合给出答复并完成后续步骤，历史调用证据必须用于最终验收，不可丢弃。

## Consequences

- Agent 弹出选项窗口或停下来等待用户指令时，验证工具不再介入，回合平稳关闭并保留交互界面；
- 待用户在后续回合回复并指导 Agent 完成最终交付后，验证门禁在交付阶段（或无暂停状态下）恢复正常自动复核；
- `AutoTaskEvidence` 新增 `pendingUserInteraction: boolean` 字段，保持向后兼容。
