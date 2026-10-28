# Agent Note: 冻结 AbortSignal 让 0.1.5 宿主线的模型调用全部失败（Node ≥26.5）

Status: implemented

## Problem

GitHub issue #2（复现环境：DSH 0.1.5-rc.2 + Node v26.8.2，路由 `commandcode/deepseek/deepseek-v4.1-flash`，explicit-tag 通道）：判官自检与 `verifier_current_session` / `verifier_track` 等调用全部失败，错误只有一行

```text
llm-verifier: model call failed: Cannot assign to read only property 'Symbol(kEvents)' of object '#<AbortSignal>'
```

统计侧车 `verifier/statistics-v1.json` 里 31 条记录全部命中该错误，且 `stats.calls = 0`、`durationMs` 仅 1–16 ms —— 请求根本没有发出去，是本机即刻抛错。

根因是一条三段链：

1. `src/caller.ts` 的 `deepFreeze` 先探测 `LlmModule.deepFreeze`，但 **`@deepseek-ai/dsh-llm` 只有 0.1.1 线重新导出它**；0.1.5 线已把该 helper 移到 `@deepseek-ai/dsh-util-values`（本地 checkout 的 `packages/llm/llm/src/index.ts:51` 只导出 `callConfigEquals / isAgentLoopRequest / markAgentLoopRequest`），于是每次都落到插件自带的兜底递归；
2. `callTextCompletion` 用 `deepFreeze({ …, signal })` 把 `retrying()` 新建的、**尚未被任何人订阅**的 per-attempt `AbortController.signal` 一起 `Object.freeze`；
3. 下游 provider 拿到该 signal 后调用 `signal.addEventListener('abort', …)`，这是首次订阅；Node ≥26.5 把事件表改成惰性初始化（nodejs/node#63702），需要写自有属性 `Symbol(kEvents)`，而它已被冻结 → TypeError。

本机复核（Node v24.14.1，见下）表明这个 bug **不止影响 Node ≥26.5**：`Object.freeze(signal)` 之后 `addEventListener` 还能用（旧版在构造时就写好了事件表），但 `controller.abort()` 无论订阅顺序都抛 `Cannot assign to read only property 'Symbol(kAborted)'`。也就是说 0.1.5 宿主线上它早已潜伏在**超时与取消**路径里（`retrying()` 的 timeout 回调在 `setTimeout` 里调用 `controller.abort()`，抛出即未捕获异常），只是没人把它跟「Node 版本」联系起来。

上游对照：`@deepseek-ai/dsh-util-values` 的 `deepFreeze` 明确有 `if (node instanceof AbortSignal) continue`，文档原话是 "leaving live AbortSignal objects mutable" —— 冻结对象图时放过 AbortSignal 已是上游共识，只有插件这份兜底实现漏了。

## Decision

- **`src/caller.ts`**：兜底实现拆成导出的 `fallbackDeepFreeze`，入口加 `if (value instanceof AbortSignal) return value`；`deepFreeze` 仍然优先使用宿主实现（两条宿主线的实现都带这条守卫），只在宿主不导出时走兜底。守卫写在函数入口，因此嵌套在任意层级里的 signal 同样被放过。
- **诊断（issue 的附带建议）**：issue 建议把 `stack`/`cause` 保留到审计事件里，但 `FinishReason.failure` 并不是 adapter 抛出的那个 Error —— 宿主在 adapter 边界用 `normalizeLlmFailure` 把它规范化成**可序列化事实** `{message, code, status?, providerRetryAfterMs?, requestId?}`（0.1.1 与本地 0.1.5 checkout 两份源码一致，且 `failureSnapshot` 只接收这些字段），stack 与 cause 在此之前就已丢失。插件能补的是它同样丢掉的机器码与状态：`failureMessage` 改为 `<message> [<code>, HTTP <status>, request <requestId>]`，缺项自动省略；message 仍排在最前，现有 `/timed out/`、`/rate limited upstream/` 之类断言不受影响。
- **回归**（`src/caller.test.ts` 新增 `call-option freezing` 一组 3 条）：① `fallbackDeepFreeze` 冻结整张图但 `Object.isFrozen(signal) === false`，且订阅后 `controller.abort()` 能触发监听器；② 真实 `callVerifier` 路径下 `llm.stream` 收到的 options 已冻结而 signal 仍可变（锁定接线，而不只是锁定辅助函数，这条在两条宿主线上都成立）；③ 失败 finish 的错误文本带 code / status / requestId。红/绿均已对照：移掉守卫时 ① 失败（`expected true to be false`），退回旧 `failureMessage` 时 ③ 在 `/AUTH/` 上失败。
- `lib/` 随 `src/` 一起重建。

## Alternatives considered

1. **改用 `@deepseek-ai/dsh-util-values` 的 `deepFreeze`**（issue 提出的第二方案）：该包不在本插件的依赖里，0.1.1 宿主上未必可解析；静态导入会把「可选宿主依赖」变成硬依赖，动态导入又要把同步冻结改成异步。而真正缺的只是一行守卫。否决。
2. **把 `signal` 移出被冻结的对象**（`{ …deepFreeze(rest), signal }`）：宿主用 `Object.isFrozen(options)` 决定能否复用/是否克隆配置，拆开会让两条宿主线走出不同分支；上游选择的是「整体冻结 + 放过 signal」，跟随它。否决。
3. **照抄上游算法**（WeakSet + 显式栈，对已冻结节点也继续下钻）：会顺带修掉「已冻结对象的孩子不再被冻结」，但也扩大了冻结范围（下钻进我们并不拥有的宿主对象内部，例如附件句柄），与本次缺陷无关。否决。
4. **探测不到宿主实现就干脆不冻结**：冻结是宿主契约的一部分，按宿主线切换行为比带守卫的兜底更难解释。否决。
5. **诊断只补 `code`**：状态码与 provider 请求 id 正是「是限流还是鉴权、该拿哪次请求去问服务商」的字段，补上成本为零。否决。

## Consequences

- 0.1.5 宿主线上模型调用不再在 1–16 ms 内失败；同时修掉**所有** Node 版本上潜伏的超时/取消路径抛出 `Symbol(kAborted)` 的问题。
- 回归不依赖 Node 版本：断言的是「signal 未被冻结 + abort 后监听器被调用」这一根因，而不是某个版本的具体报错。
- 失败行文本现在带机器码/状态码/请求 id，看板上一行字即可区分鉴权失败与限流；文本仍是单行，不引入堆栈。
- 兜底实现多了一条导出（`fallbackDeepFreeze`）供测试直接驱动；冻结语义其余部分逐字不变，`select`/`compare` 的评分路径不受影响。
