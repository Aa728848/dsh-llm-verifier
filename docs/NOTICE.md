# 上游授权与致谢

本插件的核心思想与算法实现移植自开源项目 [llm-as-a-verifier/llm-as-a-verifier](https://github.com/llm-as-a-verifier/llm-as-a-verifier)。

上游在其 `LICENSE` 与 `pyproject.toml` 中明确采用 MIT License，原始版权声明：

> Copyright (c) 2026 llm-as-a-verifier

```text
The MIT License permits use, copying, modification, merging, publication,
distribution, sublicensing, and sale, provided that the copyright and
permission notices are preserved in copies or substantial portions. The
software is provided "AS IS", without warranty. See the upstream LICENSE
for the complete legal text.
```

感谢上游作者与贡献者开源了细粒度 A–T 奖励机制、Token 对数概率期望打分、任务进度验证、Bradley–Terry 软胜率模型以及 Probabilistic Pivot Tournament 锦标赛算法。本插件将这些成果移植并整合进 TypeScript 与 DeepSeek Harness 生态，不对上述理论算法声明原创所有权。

上游实现是本仓库的算法基准。两者共享算法基础，但本仓库有一组明确列出的本地变体，见 [DESIGN.md](DESIGN.md)。
