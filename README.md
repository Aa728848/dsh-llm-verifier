<div align="center">

# DSH LLM Verifier

**给 DeepSeek Harness 的独立裁判插件。**

主 Agent 干活，另一个模型验收：比候选、看进度、判交付，并在宿主生命周期边界上自动门控。

[![license](https://img.shields.io/badge/license-MIT-2EA44F.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.1%20%E2%80%93%200.2.2-blue.svg)](docs/HOST-COMPAT.md)

</div>

## 它做什么

- **裁判不是主模型**。判官在设置里任选 Provider 与模型，只看观测到的 stdout/stderr 与真实文件 diff，不看 Agent 的自我陈述。
- **五档能力**：两个候选做比较、多个候选择优、长任务看进度、还没有候选时自己起草、整个会话判交付。
- **自动门控**。`smart` / `strict` 策略在 Agent 准备停止时自行判断该复核什么，不通过就 steering 让 Agent 修复，而不是指望模型主动想起工具。
- **判决可解释**。每次调用都有逐判据分数、实际走的评分通道、token 与费用，看板能回答"这次为什么没通过"。
- **数据不出本地之外的边界之外**。证据先脱敏限长，只发给你选定的判官。

## 安装

```bash
dsh plugin --profile web add dsh-llm-verifier
dsh web
```

打开 **设置 → LLM Verifier**，选判官模型即可。默认只启用显式工具；需要自动门控时把调用策略切到 `smart`。

## 五个工具

| 工具 | 什么时候用 |
| --- | --- |
| `verifier_compare` | 恰好两个候选，需要一个独立判断 |
| `verifier_select` | 三个以上候选，需要排名 |
| `verifier_track` | 多步任务，想知道真实进度 |
| `verifier_best_of_n` | 还没有候选，且选错的代价高 |
| `verifier_current_session` | 显式验收当前会话 |

`verifier_best_of_n` 是唯一会自己生成候选的工具，也是最贵的；其余四个只在已有材料上判断。

## 辅助思考与生效线路

独立可选模块，默认关闭。在 **设置 → LLM Verifier → 自动化** 中选择「辅助思考」的 `关闭 / 精简 / 均衡 / 完整` 档位——**档位就是它的开关，选「关闭」才关；档位只决定压缩强度，不决定对谁生效**。它与「启用 Verifier 工具」这个总开关无关：那个开关只允许或禁止 Agent 调用评审工具，不读档位、也不影响辅助思考。

生效范围只由「生效线路与逐条覆盖」决定：辅助思考只对那里列出的主供应商/模型生效，主模型留空表示该供应商全部模型；**列表为空则任何请求都不改写**，没有任何供应商被默认豁免（包括 `deepseek-official`）。因此纯账号登录的 `deepseek-account` 会话要生效，就必须自己加一条 `deepseek-account` 线路。

辅助线路默认跟随生效线路本身：未指定辅助供应商/模型时，辅助调用使用**主请求自己的供应商与模型**加 `low` 强度，所以一条线路不需要再配第二套路由就能工作。也可以把「辅助思考模型」固定为其他供应商的 DeepSeek 模型及推理强度（作用于所有线路），或在每条线路上单独覆盖辅助供应商、模型和强度；未覆盖字段依次回落到全局设置、主请求自身。「未指定供应商却指定了辅助模型」会被设置面板拦下并拒绝保存。

每个合格思考块多一次辅助调用（不携带主会话、不挂工具、60 秒超时），失败一律回放原始流。该功能不参与裁判、评分、门控与缓存身份，不提供会话命令或会话覆盖；指标只保存在进程内，重载后清零。重写沿用既有回放与签名形状、端点接受这种形状，是用户提供的端点事实——本实现不复验线上签名。细节见 [D15](docs/adr/D15-deepseek-thinking-rewrite.md)。

## 文档

| 文档 | 说什么 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 仓库形状、数据流、跨模块不变量 |
| [docs/DESIGN.md](docs/DESIGN.md) | 评分、赛制与运行策略的取舍 |
| [docs/HOST-COMPAT.md](docs/HOST-COMPAT.md) | 支持的 DSH 版本线、兼容读取点、升级流程 |
| [docs/adr/](docs/adr/README.md) | 一条决策一页 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本历史 |
| [docs/NOTICE.md](docs/NOTICE.md) | 上游授权与致谢 |

## 开发

```bash
pnpm install
pnpm run build      # 生成 lib/，宿主加载的就是这份产物
pnpm test           # vitest，测试在 test/<域>/
pnpm run verify:release
```

提交前跑 `pnpm run verify:release`。其余约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT。算法移植自 [llm-as-a-verifier](https://github.com/llm-as-a-verifier/llm-as-a-verifier)，见 [docs/NOTICE.md](docs/NOTICE.md)。
