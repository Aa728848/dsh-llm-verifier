# Agent Note: 纯探索与讨论阶段抑制自动最终验收

Status: implemented

## Problem

在 DSH 的 PTC（Programmatic Tool Calling）模式下，Agent 调用的唯一顶层工具是 `run_code`。在纯探索、问答或方案讨论阶段，Agent 调用 `tools.read`、`tools.grep`、`tools.glob`、`tools.mcp__codegraph__codegraph_explore` 或更新 `tools.todo_write` 时，事件流中记录的顶层工具均为 `run_code`。

在原实现中：
1. `src/auto.ts` 的 `CONSEQUENTIAL_TOOLS` 将 `'run_code'` 列为实质性修改工具，且 `todo_write` 因名称匹配正则 `/(?:edit|write|patch...)/` 被误判为实质性修改；
2. 导致哪怕 Agent 在本任务内只进行了只读查阅或更新 Todo，`analyzeAutoTask` 也会判定其进行了实质性操作（`consequentialToolCalls >= 1`），赋予其验收资格（`eligible: true`）；
3. 在回合结束（`agent/turn-stopping`）时，由于没有候选方案对比或 Todo 进度路由，调度器直接穿透（Fall-through）落入最终验收门禁（`final`）；
4. 裁判模型对仅有问答或只读探索的会话执行 `DEFAULT_CRITERIA`（要求终端构建/测试输出与代码接入）评判，必然给出低分并触发 `steer` 注入拦截，严重干扰人机日常探索与方案讨论。

## Decision

1. **修正顶层包装与记账工具属性**：
   - 将 `run_code` 从 `CONSEQUENTIAL_TOOLS` 移除并移入 `PASSIVE_TOOLS`：`run_code` 是代码调用工具的执行载体（Wrapper），其本身不代表改动，实际执行性质由其派发的子工具（`tool/ptc-dispatch` / `tool/code-dispatch`）决定；
   - 将 `todo_write`、`present`、`web_fetch`、`list_subagent_models`、`list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 显式加入 `PASSIVE_TOOLS`，阻断其命中 `write` 等通用正则；
2. **派发事件真实定性**：
   - 当 `run_code` 派发了 `edit`、`write`、`pwsh`、`bash` 等实质性操作时，`dispatches` 中的子事件依然被正确识别为实质性调用（`consequentialToolCalls >= 1`），确保真实代码开发与测试仍然会正常触发最终验收；
   - 当 `run_code` 仅派发只读探索（`read`、`grep` 等）或无派发时，`consequentialToolCalls` 为 0，`analyzeAutoTask` 返回 `eligible: false`（`reason: 'no-consequential-work'`），在 `turn-stopping` 边界直接平稳退出。

## Alternatives considered

1. **仅在 `turn-stopping` 处判断 `workspaceChanges` 是否有文件变更**：否决。DSH 0.1.1/0.1.5 不提供 `workspaceChanges` 服务，强依赖该服务会导致在旧宿主上门禁失效或产生行为分叉；且纯计算或某些只读检查任务本就不应进入 `analyzeAutoTask` 的 eligible 状态。
2. **通过正则尝试分析 `pwsh` / `bash` 命令行参数判断是否为只读命令**：否决。命令行语法复杂多变（从单行脚本到别名），粗暴正则易产生漏判或误判，违反系统严惩单行脆弱正则的原则。
3. **完全保留 `run_code` 为实质性工具，仅由用户手动切 manual 模式**：否决。在 PTC 为默认交互形态的现代 DSH 环境中，用户期望日常探索和闲聊无需频繁切换插件配置。

## Consequences

- 纯探索、查阅源码与方案讨论场景下，回合自然结束，不再无端唤起裁判模型执行最终验收与注入告警；
- 真实的编码修改（`edit` / `write`）或终端验证命令（`pwsh` / `bash`）依然能准确被 dispatch 探测并进入最终验收闭环；
- `completedWork` 中的 `stale` 判断不再因为后续的只读探索而把此前已通过的手动验收标记为过期。
