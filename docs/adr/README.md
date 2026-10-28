# 架构决策

一条决策一页,正文只有背景、决定与后果。放弃的方案写在后果里——它仍然是这个仓库的事实,只是没有被采用。

编号是稳定标识,代码注释按编号引用。被取代的编号作废、不复用。

| 编号 | 决策 |
| --- | --- |
| [D1](D1-scoring-scale.md) | 二十档标尺与自动概率评分 |
| [D2](D2-tournament.md) | 概率基准锦标赛按无序边去重 |
| [D3](D3-fail-closed.md) | 判决解析失败即关闭 |
| [D4](D4-position-bias.md) | 槽位交换抵消位置偏好 |
| [D5](D5-three-budgets.md) | 路由、验收、过程选优三本独立预算 |
| [D6](D6-acceptance-baseline.md) | 固定基线与逐项阈值 |
| [D7](D7-two-stage-routing.md) | 自动路由:结构化优先,语义兜底 |
| [D8](D8-plan-mode.md) | 计划模式挂起全部自动门控 |
| [D9](D9-process-selection.md) | 请求级过程选优在 llm/stream 上投机并发 |
| [D10](D10-evidence-budget.md) | 证据的单/双层层限长与分摊 |
| [D11](D11-prompt-boundary.md) | 判官提示词是安全边界 |
| [D12](D12-host-seams.md) | 宿主形态差异只有一个读取点 |
| [D13](D13-cache-identity.md) | 缓存身份与四层定价 |
| [D14](D14-sidecar-and-artifacts.md) | 侧车留在话题目录,构建产物不入库 |
