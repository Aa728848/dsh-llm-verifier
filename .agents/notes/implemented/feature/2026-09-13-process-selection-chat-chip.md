# Agent Note: 过程选优期间的聊天提示（dock 指示器）

Status: implemented

## Problem

P06 的周期在把主回复交给宿主之前会**整条缓冲**（1 MiB 上限），并且只有比较完成后才回放胜者。这段时间聊天界面里没有任何流式文字，看起来和「卡死」无法区分——而宿主恰好有一个现成的同类提示：「正在压缩上下文…」。

那个提示的做法是**插件自有的会话事件 + 客户端会话节点**：`compaction/start`…`compaction/end` 由 compaction 插件写进会话日志，ui-chat 的 `compactionDefinition`（`packages/client/ui-chat/src/client/conversation-nodes/compaction.ts`）以 `status === 'running'` 渲染成行内一行。我们照抄这个形状时撞到一堵硬墙，且是**不可绕过的**：

1. 持久化**读**路径会 fail closed 地拒绝未知事件类型——`session-persistence/src/storage-contract.ts` 的 `validateStoredEvents()`：`if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) throw unsupported(...)`，而 `known-event-types.ts` 是**仓库内生成**的清单（`KNOWN_SESSION_EVENT_TYPES`），外部插件的事件类型按定义永远不在里面。`session-persistence-jsonl`（默认后端）在 `index.ts:627/758` 与 `generation.ts:524` 三处调用它。
2. `ignorable: true` 是唯一豁免，但**没有任何运行时 API 能写入它**：`Session.append()` 自己构造信封（`core/session/src/index.ts:703-731`），`ignorable` 只出现在 seed 校验（`assertSessionEventEnvelope`）与 restore/格式迁移路径上。全仓库源码里没有任何写入 `ignorable: true` 的生产者。
3. 宿主文档确认这是**有意**的取舍：`.agents/notes/implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md` 保留该字段正是为了某个第三方插件，并明确「the persisted `ignorable` marker is the compatibility mechanism」。

换句话说：**外部插件往会话日志里写新事件类型 = 让该话题在下次启动时无法加载**。这不是能靠小心使用规避的实现细节。

## Decision

指示器改成**纯内存 + 只读 RPC + 输入框 dock**，一条会话事件都不写：

- 新增 `src/process-activity.ts`：`ProcessActivities`（每会话一条：在途周期 + 刚结束的周期）与纯函数 `classifyProcessOutcome(outcome, replayed)`。时间由调用方传入（`deps.now()`），所以 TTL 与阶段迁移都能确定性地测。已结束的周期保留 `PROCESS_ACTIVITY_SETTLED_TTL_MS` = 20 秒后自动消失。
- `ProcessSelector` 在**购买成功、派发备选之前**登记 `{ cycleId, phase: 'generating', candidates, alternativeModel?, startedAt }`；在进入裁判比较前推进到 `'comparing'`；在 `report()` 里结算（`report` 覆盖所有已购买周期的终局），并在「胜者未交付」的更正分支里用改写后的 outcome 再结算一次。阶段与结算都**按 cycleId 守卫**：迟到的异步步骤不能把已经结束的周期重新变回在途。`clear()/clearAll()`（设置变更、任务替换、agent 释放）一并清掉。
- `index.ts` 的既有 RPC 路由增加 `{ kind: 'process', sessionId }`（Fetch 主路径与旧版 `/llm-verifier` endpoint 都有）。处理器只读内存：不读侧车、不调模型、不触碰任何预约或统计。
- 客户端在 `conversation.input.dock`（"Full-width entries above the composer card"，与宿主的 TodoPanel / 队列 dock 同一个槽位）注册 `ProcessActivityChip`，经注入的 `connection.rpc` 轮询上面的查询：**只在回合运行中、或已有内容要展示时**轮询（1 秒一次），空闲会话完全不发请求；读失败一律当静默（指示器不得因为它自己出问题而打扰用户）。文案映射放在 `client-i18n.ts` 的纯函数 `processActivityText()` 里，两份字典同步。
- 判定语义：`replayed === 'candidate'` → `replaced`；`identical-candidate` → `same`；`tie` / `original-selected` / `candidate-not-delivered (…)` → `kept`；其余（各类拒绝与失败）→ `failed`。**以「宿主实际收到哪条流」为准**，与统计口径同源。

## Alternatives considered

1. **自建会话事件（`llm-verifier/process-start`/`-end`）+ 客户端会话节点，完全照抄 compaction。** 不采用——见 Problem：那会让含该话题的日志在下次加载时被 `validateStoredEvents` 拒绝，而豁免标记没有运行时写入途径。要让它可用就得改宿主仓库的 `KNOWN_SESSION_EVENT_TYPES`（不可行：不修改宿主 checkout，且对已发布安装无效）。
2. **复用宿主已存在的事件类型（如 `assistant/attempt`）当锚点，再让客户端节点按插件内存态渲染。** 不采用：那要为一个「进行中」的行引入一整套会话节点 + 渲染器注册，而且刷新/重载后事件仍在、内存态已空，节点要么撒谎要么消失，复杂度换不到信息量。
3. **用 session projection（`ctx.sessionProjections`）把状态推到客户端。** 不采用：projection 的 `apply(state, event)` 是**纯事件驱动**的，没有命令式 setter；驱动它同样要先写会话事件，回到问题 1。
4. **直接在聊天里 steer 一条 `user/message`（`form: 'notice'`）当提示。** 不采用：它是**真正的模型输入**，会在主请求与主回复之间插进一条合成消息，改变模型历史与 token 成本，且永久留在话题里；用一条会污染对话的消息解释一次几百毫秒到几十秒的等待，代价明显不成比例。
5. **在 `llm/stream` 里保留流式输出、边流边比较。** 不采用：那会改变 P06 的核心设计（宿主已经把原回复当最终答案消费掉了，「事后替换」只会让界面先显示一份再改写）。指示器是对既有设计的补充，不是替代。
6. **让 dock 常驻轮询。** 不采用：空闲会话每秒一个请求没有信息量。只在 `session.running === true` 或「已有内容要展示」时轮询。
7. **把状态写进统计/决策侧车再让客户端读文件。** 不采用：那是磁盘 I/O 与跨进程读取，为一行短暂的 UI 状态付出与长期记录同级的代价；RPC 内存查询是零成本的。

## Consequences

- 用户在等待期间能看见「正在生成候选 / 正在比较」，以及周期结束后是**替换**还是**保留**——这是 P06 第一次有聊天侧的可观察性。
- 指示器**只是提示**：它不进模型历史、不写会话日志、不参与判定、不写统计；重载后什么都不显示，因为那个周期确实已经不存在。
- 新增一条只读 RPC 分支（`kind: 'process'`）与客户端 dock 槽位注册，两者都不改变任何既有返回值；`route` 观测与统计行逐位不变。
- 代价：新建 `src/process-activity.ts` 与一次 dock 轮询；`ProcessSelector` 多了三个调用点（begin / phase / settle）与一个更正点，全部按 cycleId 守卫，失败路径不受影响。
- 若将来宿主为外部插件提供正式的「瞬态、可忽略」事件通道（当前那条 `ignorable` 通道需要 seed 写入能力），这套内存态可以原样替换为事件驱动，而客户端渲染逻辑不需要重写。
