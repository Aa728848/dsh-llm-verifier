# 架构

`dsh-llm-verifier` 是 DeepSeek Harness 的 Cordis 插件:给主 Agent 配一个独立裁判模型,复核候选方案、任务进度与会话交付,并在宿主生命周期边界上自动门控。宿主加载 `lib/`,源码在 `src/`。

本文是代码地图。方向性选择见 [adr/](adr/README.md),算法取舍见 [DESIGN.md](DESIGN.md)。

## 仓库形状

| 位置 | 装什么 |
| --- | --- |
| `src/plugin/` | 插件装配:四个工具注册、生命周期钩子、设置与 RPC 路由、对外导出 |
| `src/config/` | 配置 schema 与严格校验;判据预设解析与自定义判据回退 |
| `src/scoring/` | 纯函数:A–T 标尺、分数期望、提示词构造、锦标赛、Bradley–Terry |
| `src/judge/` | 裁判调用面:超时重试、并发限流、logprobs 通道与能力记忆、四层定价、图片 |
| `src/engine/` | compare / select / track 编排、位置交换、多裁判聚合;评分缓存 |
| `src/transcript/` | 会话提取与脱敏、宿主事件访问兼容层、真实文件改动证据、话题侧车目录 |
| `src/routing/` | 结构化与语义路由、预约状态机、预算估算;验收判定与反馈文案 |
| `src/gates/` | Team 任务验收门与共用的判决解析(`verdict.ts`) |
| `src/process/` | 请求级过程选优(`llm/stream` 缓冲、备选生成、胜者回放) |
| `src/iot/` | DeepSeek 主 Agent 辅助思考:流缓冲、供应商改写路由、辅助调用与内存指标 |
| `src/telemetry/` | 调用统计、决策快照、看板活动视图 |
| `src/replay/` | 离线回放:阈值重放、解析器重放、样本评测 |
| `src/client/view/` | React 设置页与统计看板 |
| `src/client/model/` | 设置页的字段注册、文案字典、纯函数 |
| `test/<域>/` | 与 `src/<域>/` 同名的单测,扩展名一律 `.test.ts`;`test/iot/` 覆盖档位解析、供应商路由、流缓冲与 fail-open 回放 |
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

## 辅助思考旁路

辅助思考是独立可选模块(`src/iot/`),默认关闭。它自己的开关只有档位(`off` 即关闭),**不读**插件总开关 `enabled`——那个开关只允许或禁止评审工具。档位只决定强度,生效范围只由 `iotThinkingTargets` 决定,没有默认豁免的供应商:

```
主请求 → 档位 off? 穿过
      → findIoTTarget(iotThinkingTargets) 未命中? 穿过(不缓冲)
      → 思考块 → 辅助线路(逐条覆盖 → 全局设置 → 主请求自身,强度默认 low)→ 一次辅助调用(无主会话 sessionId、无工具、60s)
      → 改写文本 → 与原流同形回放;超时/报错/空/超限 → 原样回放原始流
```

它和过程选优共用同一个 `llm/stream` 钩子,顺序固定为重写在前;评分、门控与缓存身份都不在这条路径上。评审工具关掉不影响这条旁路,反之亦然。没有 `/iot` 命令或会话覆盖;指标是内存态,重载后清零。

这条旁路在界面上只有一个出口:被扣住的思考块不会向宿主吐任何增量,所以「正在扣着一块」这个事实经 `kind:'process'` 的 `thinking` 字段交给聊天活动提示条(与 P06/路由/终验共用同一条提示、同一个 1s 轮询)。纯内存、不入会话、不进模型上下文;释放即消失。

## 不变量

改动任何一处之前先读:

- **失败即抛出**([D3](adr/D3-fail-closed.md)):判决解析不出就报错,不静默给分、不静默放行。
- **证据双层限长**([D10](adr/D10-evidence-budget.md)):新增候选或检查点来源必须经 `itemBudget()` 分摊总预算,截断标记计入预算。
- **每次 steering 都消耗额度**([D5](adr/D5-three-budgets.md)):无线额时只能发一次通知,不允许活锁。
- **宿主差异只有一个读取点**([D12](adr/D12-host-seams.md)):`session.ts` 的 `toolResultBlocks()` / `toolResultFailed()`, `top-logprobs.ts` 的 `settingsNamespace()`——不要在调用点重写分支。
- **判官提示词是安全边界**([D11](adr/D11-prompt-boundary.md)):证据只进确定性分隔块,并声明为只读数据。
- **缓存身份字段变更必须升 `version`**([D13](adr/D13-cache-identity.md))。
- **`lib/` 是产物**([D14](adr/D14-sidecar-and-artifacts.md)):由构建写出,不入库。
- **思考重写是 fail-open 旁路**([D15](adr/D15-deepseek-thinking-rewrite.md)):改写失败一律回放原始流——不改写、不重试、不抛错。
- **`llm/stream` 只有一个钩子**([D15](adr/D15-deepseek-thinking-rewrite.md)):思考重写与过程选优按"重写 → 选优"挂在同一处,不要再挂第二个。
