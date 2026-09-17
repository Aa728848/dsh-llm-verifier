# Agent Note: 保留同步会话历史读取的豁免，并记录其迁移触发条件

Status: implemented

## Problem

DSH 0.1.6 引入了同步会话历史读取的废弃决策（`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`），原文为：

> All operations that synchronously read arbitrary positions or ranges of Session event history are deprecated, including `Session.eventAt()`, `Session.snapshotEvents()`, and `Session.ownEvents()`. Existing logic may remain unmigrated for now, but new calls are prohibited. New aliases or wrappers that expose the same synchronous historical access are prohibited as well.

该废弃标签在 0.1.5-rc.2 中**尚不存在**（已用 `git show dsh-v0.1.5-rc.2:packages/core/session/src/index.ts` 逐版核对），是 0.1.6 新增的门禁。

本插件被这条规则正面命中两次：

1. `src/session.ts` 的 `sessionEvents()` **恰好就是被点名的形态**——它把 `snapshotEvents?.()` 与旧宿主的 `events` 数组包成同一个同步读取入口，属于"wrapper that expose the same synchronous historical access"。
2. 这个读取是本插件全部判定能力的地基：`tool/call`、`tool/result`、`tool/ptc-dispatch` 是证据索引（`src/router.ts` 的 `buildEvidenceIndex`）、自动验收资格判定（`src/auto.ts` 的 `code-dispatch` 分支）与判官提示词的唯一来源。

官方给出的替代路径在本场景不可用：`SessionController.page()` 的返回被两层过滤限定在消息类事件上——`packages/api/session-controller/src/history.ts` 定义 `MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])`，并叠加 `isAppendSurfaceEvent` 判定。**工具调用与工具结果根本不会回来**。

宿主自己面对同一个缺口时选择的是豁免而非迁移：`packages/experimental/auto-review/src/index.ts` 以逐行注释挂载豁免继续调用 `snapshotEvents()`，其 README 的 Known Limitations 明确写着 "Prior calls, PTC starts, and the direct parent's initial prompt have no projection or paged reader yet, so the migration stays deferred"。

## Decision

**保留该调用，把豁免与迁移条件写进代码与规矩，而不是现在就迁移。**

1. `src/session.ts` 的函数文档补全豁免理由：被点名的是这个包装、替代路径为何不适用、宿主自身的同类先例、以及迁移方向（注册式 Session projection）。
2. `AGENTS.md` 新增「### 7. 宿主版本兼容（0.1.6 对齐）」，在「已知的有意设计」下明确记录：**看到 `@deprecated` 不得把它替换为 `page()`**，因为那会静默丢掉全部工具证据——验收会照常给出判决，只是判决不再基于真实执行轨迹，属于最危险的一类退化。
3. 迁移的触发条件：宿主为工具事件提供投影或分页读取器，或本插件需要支持宿主移除这三个读取器之后的版本线。届时改用 `sessionProjections.register()`（`packages/session/session-projection/src/index.ts`）以 `stateVersion` 增量维护证据索引，并在 restore 路径重建。

## Alternatives considered

1. **改用 `sessionController.page()`**：否决。它能返回的只有 `user/message` 与 `assistant/message`，本插件赖以判定的工具调用、工具结果与 PTC dispatch 全部缺失。迁移后验收仍在运行，但证据基础从"执行轨迹"退化为"对话文本"，且**不会有任何报错提示这一点**——沉默的正确性损失比编译错误危险得多。
2. **现在就实现 Session projection 完成迁移**：否决（本轮）。需要为 `tool/call`、`tool/result`、`tool/ptc-dispatch`、`todo/write`、`team/task` 各设计持久化事件字段与纯投影函数，并为 `stateVersion` 与既有会话的 restore 路径编写覆盖；这是一次独立的架构变更，与本轮的兼容对齐混做会把两类风险耦在一起。宿主自己也尚未完成这一步（`auto-review` 同样挂豁免）。
3. **把 `sessionEvents()` 拆成新旧两个函数，只给旧路径留豁免**：否决。包装本身就被明文禁止，拆分不改变性质，只增加一层没有实际收益的间接。
4. **在运行时按宿主版本决定是否调用**：否决。三个读取器在 0.1.6 上仍然存在且行为正确，按版本分支只会引入一个更脆弱的探测面。

## Consequences

- 插件在 0.1.6（以及后续仍保留这三个读取器的版本线）上维持完整的证据能力，验收判据不因宿主升级而静默降级。
- 技术上，本插件与 `auto-review` 一样，是宿主该缺口上的已知依赖方。宿主一旦移除这三个方法（而非仅标注废弃），本插件会直接失败——这是**有意选择的失败方式**：显式崩溃优于静默失去证据。
- 迁移债已被记录而非遗忘：`AGENTS.md` 的规矩条目与本节共同构成触发条件，后续会话看到 `@deprecated` 时不会做出"顺手修掉"的错误决定。
- 验证基线：`npx tsc --noEmit -p tsconfig.build.json`（锁定 0.1.1-rc.2）与"把 `tsconfig.local.json` 的 `paths` 指向本地 harness 实际 checkout 后运行 `tsc --noEmit`"（真实 0.1.6 宿主类型，复现方式见 `implemented/process/2026-09-17-local-harness-typecheck-fallthrough.md`）双双通过；`pnpm test` 全量通过。0.1.6 上这三个读取器仍带 `@deprecated` 注解但签名与行为未变，故类型检查不会因本次保留而失败。
