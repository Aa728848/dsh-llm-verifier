# Agent Note: 接通宿主 Workflow 包装与团队任务问题提取

Status: implemented

## Problem

本轮的 F03 与 F04（P1）都源于"插件读的事件形状与宿主真实产生的不一致"。

**F03：结构化 Workflow 候选协议与宿主返回不匹配。** 本地 DSH 的 `tool-workflow` 返回结构化对象 `{runId, agentsStarted, result}`，但它渲染给模型/事件的文本是 `workflow "<name>" completed (N agent(s)).\nReturn value:\n<JSON>`（`packages/workflow/tool-workflow/src/index.ts` 的 `renderResult`）。`router.ts` 的 `analyzeStructuredRoute` 对整段工具文本直接 `strictJson`，而候选 envelope 必须位于 JSON 顶层，因此真实宿主下这条结构化快路径**不可达**；既有测试喂的是没有宿主包装的裸 JSON，所以从未发现。

**F04：团队消息被识别为任务边界，却不能成为验收问题。** `latestDirectUserSeq` 已把 `team-message` 接受为任务开界；`session.ts` 的 `extractSession` 却只在 `sourceKind === 'user'` 时设置 `problem`。只含团队任务消息的窗口可以生成非空 trace，但 `problem` 为空，`verifySession` 随即以 "no direct user task found" 抛错——恰恰在最需要门控的队友会话里失效。

## Decision

**F03**（`router.ts`）：

- 新增 `parseWorkflowResult(text)`：先尝试裸 `strictJson`；失败时只识别**唯一一种**已确认的宿主包装——查找固定的 `\nReturn value:\n` 标记并对其后的 JSON 做严格解析。结尾带 `[truncated: N more characters]` 的渲染结果直接拒绝（半截候选列表不参与路由）。**没有**任何"在任意工具文本里宽松搜寻花括号"的逻辑。
- 只有 `pair.name === 'workflow' && pair.ok` 才解包；失败的 workflow 是错误报告，不产生候选组。

**F04**（`session.ts`）：

- `extractSession` 的任务陈述改为取窗口内**第一条** `user` 或 `team-message`：与 `latestDirectUserSeq` 的唯一边界定义保持一致。普通用户任务之后转交时仍取原始用户任务；团队消息作为 trace 证据保留；`team-message` 开启的新任务窗口取新任务；插件 `steering`（`source.kind === 'plugin'`）依旧不被当作任务。

## Alternatives considered

1. **用正则从任意工具文本里搜 `{...}`**。不采用。报告明确禁止"从任意工具文本中宽松搜寻花括号"；那会把普通工具输出里的 JSON 误当候选。
2. **直接把宿主渲染文本喂给语义分类器，放弃结构化快路径**。不采用。结构化路径是确定性、零模型调用的，正是它应该先跑。
3. **把 `team-message` 的问题设为 trace 里最新的一条消息**。不采用。`latestDirectUserSeq` 定义的是任务**开界**，窗口第一条才与之一致；取最新会把后续追问误当任务陈述。
4. **只对 `user` 之外放宽到任意非 plugin 来源**。不采用，会把协调类消息混进任务陈述。

## Consequences

- 真实宿主（0.1.5 形态）的合法同组候选可以进入结构化 compare/select；额外说明、半截 JSON、失败子任务、不同子任务都不会变成受信候选；非 `workflow` 工具的同形文本不被解包。
- 队友会话的最终验收能读到被指派任务，而不是空字符串或上一个任务。
- 回归：`router.test.ts` 新增"解包宿主渲染 / 拒绝截断 / 不误解包非 workflow / 拒绝失败 workflow"；`session.test.ts` 新增"仅团队消息""用户后转交""团队新任务重置"三种形状。
- 仍要求 envelope 的版本、组 ID、完成状态与非空候选；README 已给出可由实际 Workflow 返回的最小 envelope 用法（见 `与上游的关系` 同页的结构化路由说明）。
