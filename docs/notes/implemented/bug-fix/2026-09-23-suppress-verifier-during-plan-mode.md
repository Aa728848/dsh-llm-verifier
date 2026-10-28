# Agent Note: 计划模式激活期间抑制全部自动门控与路由

Status: implemented

## Problem

计划模式（plan mode）下 Agent 的职责是调研与提案，方案须经用户在 `exit_plan_mode` 审核对话框中批准后才可执行。原实现中，`agent/turn-stopping` 停顿边界不感知计划模式：只要任务此前存在实质性工具调用（甚至只是计划模式之外的历史修改），停止边界就会照常运行结构化/语义路由与最终验收。最终验收把"只有分析、没有实现"的会话与空工作基线比对，必然判低分，随后注入的 steering 要求 Agent "actually implement the change"——等于在用户尚未批准计划时命令 Agent 动手执行，直接违背计划模式的人机审核边界（用户反馈实例：计划阶段还未审核，插件就自动命令 AI 去执行）。`agent/pre-step` 的候选早评审注入与过程选优（P06）意图登记存在同类问题：其反馈文案同样以"实施胜出候选"为结论。

## Decision

1. **计划模式状态探测（`src/auto.ts` 的 `planModeActive(events)`）**：折叠会话事件日志中最后一条 `plan/mode` 事件（宿主 `@deepseek-ai/dsh-plan-mode` 每次提交模式切换时记录，其自身 projection 的折叠规则相同）：空日志视为未激活，`data.active === true` 才激活，载荷缺失或非布尔一律不激活（fail open）。无该事件类型的旧宿主（0.1.1 等）行为完全不变。折叠作用于整份日志而非当前任务区间，因为计划模式可能先于任务陈述进入。
2. **证据层抑制**：`AutoTaskEvidence` 新增 `planMode: boolean` 字段；`analyzeAutoTask` 在 `manual-mode` 之后、其余抑制分支之前返回 `eligible: false` 与 `reason: 'plan-mode-active'`，离线回放与统计由此获得可观测的未路由原因。
3. **钩子层抑制闭环**：
   - `src/index.ts` 的 `agent/turn-stopping` 在计算 `evidence` 后、manualVerificationAccepted/子 Agent/用户暂停等分支之前检查 `evidence.planMode`，记录日志并立即 `return`，整体跳过 manual 验收采纳、Team 任务验收、结构化路由、语义路由、交付阶段快路径与最终验收；
   - `agent/pre-step` 在子会话检查之后以同一 `planModeActive` 判定直接放行宿主决策，不注入候选早评审、不登记过程选优意图。
4. **唯一保留的门**：`exit_plan_mode` 计划预审（`tools/pre-execute`，`plan-gate.ts`）在计划模式下照常运行——它正是计划模式下应该存在的审核门。
5. **恢复语义**：用户批准计划后宿主记录 `plan/mode { active: false }`，下一停止边界门禁照常恢复，计划模式之前的实质性工作证据不丢失（与"用户交互暂停"抑制同一纪律，见 `2026-09-19-suppress-verifier-when-user-interaction-pending.md`）。

## Alternatives considered

1. **在裁判提示词中声明"计划模式下不要求实施"**：否决。计划阶段的会话必然缺交付物，裁判对基线比对仍倾向低分；且每次停止边界都支付裁判调用，徒增 Token 与延迟，反馈文案还容易再度滑向"去执行"。
2. **只抑制最终验收、保留路由**：否决。compare/select/track 的 steering 文案（"实施胜出候选""继续未完成的工作"）在计划模式下同样是越权指挥；计划模式下不存在需要仲裁的执行候选。
3. **通过宿主 `ctx.planMode` 服务读取实时状态**：否决。该服务由宿主 plan 包声明，插件声明支持 0.1.1–0.1.7 多线宿主，直接依赖会让插件在无 plan 包的宿主上加载失败；事件折叠与宿主 projection 规则一致且跨版本安全（对比 `workspace.ts` 的"不 inject、不 import 宿主类型"纪律）。
4. **把抑制做成可配置开关**：否决。子 Agent 待结、用户交互暂停两个同类抑制均为无条件安全边界；计划模式越权执行属于正确性缺陷而非偏好。

## Consequences

- 计划模式激活期间，停止边界不再产生任何裁判调用、路由记录或 steering，回合平稳关闭等待用户审核计划；
- `AutoTaskEvidence` 新增 `planMode` 字段，`analyzeAutoTask` 新原因值 `plan-mode-active`，向后兼容（消费方均按字段名读取）；
- 回归测试覆盖：折叠边界（空日志/多次翻转/非布尔载荷）、有计划工作仍抑制、退出计划模式后同一边界恢复验收、pre-step 在计划模式下原样透传宿主决策（`src/auto.test.ts`、`src/index.test.ts`）；
- 显式 `verifier_*` 工具不受抑制影响（由模型显式调用，非自动门控）。
