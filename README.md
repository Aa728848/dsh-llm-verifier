<div align="center">

# DSH LLM Verifier

**给 DeepSeek Harness 的独立裁判插件。**

主 Agent 干活，另一个模型验收：比候选、看进度、判交付，并在宿主生命周期边界上自动门控。

[![license](https://img.shields.io/badge/license-MIT-2EA44F.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.1%20%E2%80%93%200.2.1-blue.svg)](docs/HOST-COMPAT.md)

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
