# Agent Note: 判官拿不到 logprobs 的成因分类（预算耗尽 ≠ 能力不足）

Status: implemented

## Problem

直连 top_logprobs 通道在响应里读不到任何 token 概率时，`src/top-logprobs.ts` 一律抛
`TopLogprobsUnsupportedError`。而 `src/caller.ts` 的 `callAutomatic()` 用
`instanceof TopLogprobsUnsupportedError` 作为**降级判据**：命中即 `markUnsupported(provider, model)`，
把该路由记进通道能力记忆（上限 24h）并回退到显式标签通道。

两种成因因此无法区分：

1. **能力不足**：供应商确实不回传概率（能力事实，应当记忆并降级）。
2. **推理吃满输出预算**：判官把 `maxTokens` 全花在推理上，正文一个字没输出，响应里自然没有
   答案 token 的概率行。这是**一次配置失误**，与供应商能力无关。

第二种成因被误记进能力记忆后，该路由在 TTL 内持续走显式标签通道——单次采样只取一个字母
（A–T 每档约 5.3%），判决精度下降，且用户在设置页看到的是"该模型不支持 logprobs"这一错误结论。

此外，`RETRYABLE_MESSAGE` 里的 `5\d\d` arm 无数字边界，任何"以 5 开头的三位数字"都被读成
HTTP 5xx。判官预算默认值升到 65536 后，`65536` 的连续子串 `553` 命中该 arm，于是这条**确定性**
失败被判成可重试，在默认 `maxRetries: 3` 下白跑 4 次满额推理调用才报出同一个错误。

## Decision

**1. 按 `finish_reason` 分流，而非按消息文本或厂商/模型名。**

`src/top-logprobs.ts` 新增 `noLogprobsError(finishReason, maxTokens)`，在无概率行时按响应自身的
`finish_reason` 分流：

- `finish_reason === 'length'` → 抛 `TopLogprobsBudgetError`，消息带出**实际** `maxTokens` 与两条
  可操作建议（调大判官 maxTokens，或调低推理强度）。
- 其余全部（`'stop'`、`'tool_calls'`、字段缺失回落 `'unknown'`）→ 保持
  `TopLogprobsUnsupportedError`，并以能力探测文案 `provider returned no token logprobs` 开头。

`TopLogprobsBudgetError` **直接继承 `Error`，不得继承 `TopLogprobsUnsupportedError`**——这正是它
不触发降级的全部机制：`callAutomatic()` 的 `instanceof` 判据为假，错误被直接 rethrow，既不调用
`markUnsupported`，也不置 `channelFallback`、不回退 DSH stream（回退去评分反而会掩盖这次配置失误）。

**2. 确定性失败在重试判据里按类型排除，并给 `5\d\d` 加数字边界。**

`src/caller.ts` 的重试判据加入类型排除，使预算错误永不被消息文本影响：

```ts
const retryable = timedOut || (error instanceof Error && !(error instanceof TopLogprobsBudgetError) && RETRYABLE_MESSAGE.test(error.message))
```

同时把 `RETRYABLE_MESSAGE` 的 5xx arm 锚定到数字边界：

```ts
const RETRYABLE_MESSAGE = /rate|quota|timeout|timed out|temporar|network|fetch|socket|(?:^|[^0-9])5\d\d(?:[^0-9]|$)/i
```

`"HTTP 503"` 仍命中（空格构成边界），`"65536"` 不再命中（`553` 两侧皆为数字）。两条修改互相独立：
类型排除覆盖预算错误本身，边界锚定覆盖任何**恰好引用大额数字**的普通消息。

## Alternatives considered

1. **只改错误消息文本，不改类型。** 否决。降级在 `callAutomatic()` 由 `instanceof` 触发，文案再清楚也
   拦不住能力记忆被污染；只改文案等于留下缺陷。
2. **只做类型排除，不锚定正则。** 否决。类型排除只保护 `TopLogprobsBudgetError` 这一个来源；`5\d\d`
   无边界仍是潜在误判，任何引用大额数字的普通失败消息都会触发 4 次白跑重试。
3. **按 provider / 模型名硬编码"支持 logprobs"。** 否决（硬性规矩 7）。分流依据取自响应自身的
   `finish_reason`，不引入任何按名称的假设。
4. **预算耗尽时静默回退到 DSH stream 继续评分。** 否决。配置失误应当可见地报错；静默回退会用一个
   精度更低的通道悄悄产出判决，掩盖"预算需要调整"这一事实。
5. **改用零宽断言 `(?<![0-9])5\d\d(?![0-9])`。** 未采用。它不消耗边界字符，因而能匹配同一条消息里的
   第二个 5xx；但本插件内唯一靠 5xx arm 命中的消息是 `top-logprobs.ts` 的
   `request failed with HTTP <status>`，状态码前恒为空格，现行写法已完整覆盖，无需更严的形式。

## Consequences

- `finish_reason === 'length'` 的判官调用**不再写入通道能力记忆**，该路由在 TTL 内保持概率期望通道，
  配置修正后立即恢复满精度。
- 这类失败**不再重试**：报告一次错误，而不是 4 次满额推理调用。
- 能力探测语义不变：供应商确实不回传概率时仍抛 `TopLogprobsUnsupportedError` 并照旧记忆与降级；
  `TopLogprobsRouteError` 仍是它的子类，其降级行为未受影响。
- 判官默认输出预算为 **65536**（`config.ts` / `client-fields.ts` 的 `CONFIG_DEFAULTS`），
  与上游 v0.3.0 的判官预算对齐；评分缓存身份版本随之升为 **7**（`engine.ts` 的 `identity`），
  以免旧预算写入的评分被新默认值命中。
- 回归测试钉住三处边界（`top-logprobs.test.ts` 的 length / stop / 缺字段三种成因；
  `caller.test.ts` 的不重试 + 能力记忆未被污染 + 不回退 stream、纯消息边界、HTTP 503 仍可重试）。
  其中"纯消息边界"一条经突变验证：撤掉正则锚定即变红。
