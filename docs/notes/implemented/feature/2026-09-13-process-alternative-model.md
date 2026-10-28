# Agent Note: 备选回复可由另一个模型生成

Status: implemented

## Problem

P06 的备选回复一直是在**同一条路由上再采样一次**：`buildAlternativeRequest()` 复制原请求的 provider/model，只改了采样温度。上游 TurboAgent 的对应能力是**多模型集成**（`backend.models` 每个模型各出若干候选，合计 `total_candidates`），而我们在宿主内可以直接指定路由，却没有任何配置项可用。

这带来两个后果：候选之间的差异只剩采样噪声（难分对的中位分差只有 0.018，低于单档步长，见 best-of-N 那篇的判别力读数）；而「换一个模型试试」这个最自然的实验臂根本做不出来。

## Decision

新增配置项 `autoProcessAlternativeModel`（字符串，默认空）：

- **空**＝沿用原请求的路由（今天的逐位行为不变）；
- 非空必须是完整的 `provider/model`，半截的写法在 `resolveConfig` 就被拒——否则统计行会声称用了第二个模型，而实际回退到会话模型；
- `resolveAlternativeTarget()`（`process-selection.ts`，纯函数、已导出）负责解析，**缺省/空/半截一律当作「没有覆盖」**，所以旧设置生产者不会让周期崩掉（`ProcessSelectionSettings.alternativeModel` 因此是可选的）；
- `buildAlternativeRequest(options, signal, failureContext?, target?)` 用 target 覆盖 provider/model；**跨 provider 时不再继承原请求的 `reasoningEffort`**（那是适配器自有的 id，另一个适配器可能不认识，而被拒的请求会赔掉整个周期），同 provider 仍继承；`maxTokens` 与 `GENERATION_TEMPERATURE` 下限不变；
- 实际使用的路由记进 `RouteObservation.alternativeModel`（同步加进 `cleanRoute` 白名单与离线读取器 `ReplayRouteObservation`），否则「模型」这个变量在行里不可见；
- 设置页走声明式字段注册表（`text('autoProcessAlternativeModel', 'routing')`），两份字典同步；前端校验**不得**要求该字段非空（空是合法值），这与 `criteriaFile` 可空是同一类有意豁免。

验证基线：`pnpm run typecheck` 与全量测试通过（580 条，比上一轮 +4）：`config.test.ts` 覆盖默认空值与四种非法写法，`process-selection.test.ts` 覆盖路由覆盖、跨 provider 丢弃 effort、空/半截退化为不覆盖，`index.test.ts` 端到端断言生成请求走的是配置的 provider/model（裁判仍在配置的判官模型上）且统计行记下了路由。

## Alternatives considered

1. **默认就用一个「更强的模型」当备选。** 不采用。没有对照数据时这等于把一次比较偷偷变成「谁的模型好」，而 P06 默认关闭的意义正是等待数据；空默认让新配置项对现有用户逐位无感。
2. **始终继承 `reasoningEffort`。** 不采用。它是适配器自有的 id，跨 provider 时可能直接导致请求被拒——一次被拒的生成会赔掉整个周期，而周期是最贵的动作。
3. **半截写法静默回退到会话模型。** 不采用。那样统计行会记录一个并未使用的模型，A/B 对照的读数就不可信；在 `resolveConfig` 拒绝是唯一能让错误暴露在保存时刻的地方。
4. **复用 `best-of-N` 的 `generationClient()`/`generateCandidate()` seam。** 不采用。那套 seam 是给判官客户端重定向用的（一次性的 prompt 生成 + 文本解析），而这里要生成的是**同一会话请求**的完整 chunk 流（含 tool-call 块与 finish 元数据），必须走 `ctx.llm.stream`。
5. **把模型选择做成下拉框。** 暂不采用。宿主侧候选模型列表是运行时才发现的能力，而字段注册表里的 `select` 只渲染静态目录；文本框允许 `provider/model` 任意组合，代价是拼错会在保存时被拒（这是可接受的失败方式）。

## Consequences

- 「第二个模型」这个实验臂第一次可配置、可记录、可离线读取（`route.alternativeModel`）。
- 代价被明确写进配置帮助与 README：跨模型比较把「哪个下一步更好」和「哪个模型更好」混在一起，因此它是**实验臂**而不是推荐配置。
- 计划里的 `provider/model` 必须成对；一个 provider 映射不了模型名（例如把 `openai/gpt-5` 写成 `gpt-5`）会在保存时得到明确报错，而不是在周期里静默回退。
- 不影响默认路径：空值时 `buildAlternativeRequest()` 与本次改动前逐位一致（回归覆盖）。
