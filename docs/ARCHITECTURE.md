# 架构

`dsh-llm-verifier` 是 DeepSeek Harness 的 Cordis 插件:给主 Agent 配一个独立裁判模型,复核候选方案、任务进度与会话交付,并在宿主生命周期边界上自动门控。宿主加载 `lib/`,源码在 `src/`。

本文是代码地图。方向性选择见 [adr/](adr/README.md),算法取舍见 [DESIGN.md](DESIGN.md)。

## 仓库形状

| 位置 | 装什么 |
| --- | --- |
| `src/plugin/` | 插件装配:五个工具注册、生命周期钩子、设置与 RPC 路由、对外导出 |
| `src/config/` | 配置 schema 与严格校验;判据预设解析与自定义判据回退 |
| `src/scoring/` | 纯函数:A–T 标尺、分数期望、提示词构造、锦标赛、Bradley–Terry |
| `src/judge/` | 裁判调用面:超时重试、并发限流、logprobs 通道与能力记忆、四层定价、图片 |
| `src/engine/` | compare / select / track 编排、位置交换、多裁判聚合;评分缓存 |
| `src/transcript/` | 会话提取与脱敏、宿主事件访问兼容层、真实文件改动证据、话题侧车目录 |
| `src/routing/` | 结构化与语义路由、预约状态机、预算估算;验收判定与反馈文案 |
| `src/gates/` | 三个生命周期门:计划预审、Team 任务验收、工具调用决策 |
| `src/process/` | 请求级过程选优(`llm/stream` 缓冲、备选生成、胜者回放) |
| `src/telemetry/` | 调用统计、决策快照、看板活动视图 |
| `src/replay/` | 离线回放:阈值重放、解析器重放、样本评测 |
| `src/client/view/` | React 设置页与统计看板 |
| `src/client/model/` | 设置页的字段注册、文案字典、纯函数 |
| `test/<域>/` | 与 `src/<域>/` 同名的单测,扩展名一律 `.test.ts` |
| `scripts/` | 构建、类型门禁、离线回放、发版 |
| `docs/` | 本文档树 |
| `lib/` | 构建产物,从不手工编辑、从不入库 |

## 一次成对比较的路径

```
工具调用 → explicitEvidence 脱敏限长 → 判据解析 → engine 编排
        → 评分缓存查键(未命中)→ caller 并发调用 → 通道探测(概率期望 / 显式标签)
        → 判决解析 → 换算分数 → 逐标准逐轮聚合 → 多裁判中位数 → 工具输出
```

自动路由走同一条引擎,只是证据由 `transcript/` 从会话快照重建,判据来自配置,并被 `routing/` 的预算与预约状态机包裹。

## 不变量

改动任何一处之前先读:

- **失败即抛出**([D3](adr/D3-fail-closed.md)):判决解析不出就报错,不静默给分、不静默放行。
- **证据双层限长**([D10](adr/D10-evidence-budget.md)):新增候选或检查点来源必须经 `itemBudget()` 分摊总预算,截断标记计入预算。
- **每次 steering 都消耗额度**([D5](adr/D5-three-budgets.md)):无线额时只能发一次通知,不允许活锁。
- **宿主差异只有一个读取点**([D12](adr/D12-host-seams.md)):`session.ts` 的 `toolResultBlocks()` / `toolResultFailed()`, `top-logprobs.ts` 的 `settingsNamespace()`——不要在调用点重写分支。
- **判官提示词是安全边界**([D11](adr/D11-prompt-boundary.md)):证据只进确定性分隔块,并声明为只读数据。
- **缓存身份字段变更必须升 `version`**([D13](adr/D13-cache-identity.md))。
- **`lib/` 是产物**([D14](adr/D14-sidecar-and-artifacts.md)):由构建写出,不入库。
