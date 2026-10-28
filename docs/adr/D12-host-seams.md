# D12 宿主形态差异只有一个读取点

## 背景

本插件声明支持 DSH 0.1.1 到 0.2.1 一整串预发布线。这些版本之间换掉了若干插件消费的接口形态,而同一个差异散落在多个调用点会立刻分叉。

## 决定

每种宿主差异收敛到一个函数,调用点只认收敛后的形状:

| 差异 | 唯一读取点 |
| --- | --- |
| `session.snapshotEvents?.()` 与旧的 `session.events` | `transcript/session.ts` 的 `sessionEvents()` |
| 工具结果的两种形态(旧:`tool-result` 嵌套块;新:`role:'tool'` 消息 + 消息级 `isError`) | `toolResultBlocks()` / `toolResultFailed()` |
| `tool/ptc-dispatch` 与旧的 `tool/code-dispatch` | 同上,事件分发处 |
| 宿主设置 `settings.get(ns)` 与 `SettingsForms.describe()` | `judge/top-logprobs.ts` 的 `settingsNamespace()` |
| 图标导出名(尺寸后缀 → 笔画后缀) | `client/view/client.tsx` 顶部按名探测 |

## 后果

- 看到 `@deprecated` **不要**把 `snapshotEvents()` 换成 `SessionController.page()`:后者只放行 user/assistant 消息,工具调用与结果全都取不到,本插件没有证据可判。
- 宿主在工具名变化时追加的 `developer/message` 刻意不读:它是宿主侧的登记动作,不是 Agent 的工作证据。
- 0.2.0 起 step 失败时宿主补写的合成失败 `tool/result` 会被 `toolResultFailed()` 原样读成"失败",不需要为 `error.code` 加特判。
