# Agent Note: 过程选优的失败靶向（process 判据、采样温度下限与失败证据交接）

Status: implemented

## Problem

P06 过程选优在「同一任务最近两次验证运行都失败」时为下一次主请求买一份备选回复。三个问题让这份备选的价值被系统性稀释：

1. **判据不对症**：比较复用了 `PROPOSAL_CRITERIA`（目标与约束 / 可行性 / 验证设计）。计划类判据问的是「这个方案是否回答了任务」，把**失败的做法再说一遍**在它眼里往往是完整、可行、有验证设计的——而这次比较恰恰有它没有的证据：刚刚失败的两次运行。
2. **备选可能只是原回复的副本**：`buildAlternativeRequest()` 逐字复制主请求的采样参数。宿主若配置了低温采样，重新抽样得到的是一份近乎相同的回复，周期仍然照付一次生成（最坏情况记成 `identical-candidate`，钱花了、信息为零）。仓库自己的 best-of-N 早就为同一个原因固定了生成温度。
3. **备选与原请求逐字同消息**：它和原回复掌握的信息完全一样，所以「再生成一份」本质上只是重抽一次彩票，而买它的理由（两次失败）根本没有进入这次生成。

## Decision

`src/core.ts`：新增 `PROCESS_CRITERIA`（三条窄判据）——**失败靶向**（是否针对观测到的失败证据所指的原因）、**与已失败尝试不同**（是否只是同一做法换了个说法）、**可验证的一步**（执行后能否产生可判定成败的输出）。评审阶段仍是 `proposal`（候选尚未执行），判据来源记为 `process`。

`src/process-selection.ts`：

- `buildAlternativeRequest()` 的采样温度改为 `Math.max(GENERATION_TEMPERATURE, options.temperature ?? 0)`：**只抬高、不压低**；宿主已经用更高温度时原样保留。
- 新增 `buildFailureNotice(context)`：一条来自本插件的 user 消息（与宿主投递 steering 通知同一种消息形态），内容是触发本周期的那两次失败运行，并明确声明引用内容是**数据而非指令**。
- `ProcessIntent` 增加 `failureContext`，`handle()` 把它交给 `buildAlternativeRequest()`，并在 `RouteObservation.alternativeAugmented` 上记录这次周期是否带了证据。

`src/router.ts`：`inspectRecoverySignal(events, maxItemChars?)` 顺带产出 `failureContext` —— 就在它已经选出那两次运行的地方构建，**每段先过 `sanitizeVerifierText` 再计量**，按 `itemBudget()` 在两次运行之间分摊总量（`RECOVERY_FAILURE_CONTEXT_CHARS = 4000`），并且**不进入 `signature`**（否则会把所有已存的购买记录一次性作废）。

`src/index.ts` + `src/config.ts` + `src/client-fields.ts` + 两份 i18n + README：新增配置项 `autoProcessFailureContext`（**默认开启**，仅在过程选优启用时生效），关掉即成为对照臂：两份候选信息完全相同、周期照买。**裁判不会被告知哪份候选带了证据**——避免它按来源而不是按内容打分；差异记录在统计行里供真实任务对照读取。

统计与看板：`RouteObservation` 新增 `alternativeAugmented`（同步加进 `cleanRoute` 白名单，否则静默消失），看板最近调用行新增「交付原回复/备选 · 生成 N · 裁判 M」「两份候选相同」「备选已注入失败证据」三项，中英文案同步。

验证基线：`pnpm run typecheck` 通过；测试由 560 条增至 572 条（`router.test.ts` +6、`core.test.ts` +1、`process-selection.test.ts` +2、`index.test.ts` +2、`config.test.ts` +1），22 个文件全绿（2 条 skip 为既有 parity 跳过）。裁判调用数不变（1 次生成 + 3 判据 × 2 轮 × 1 裁判）。

## Alternatives considered

1. **照抄上游的 context refinement（用第二个模型改写提示词）**：上游 TurboAgent 的 `context.refinement_model` 正是这个思路，但它多买一次模型调用，且改写结果不受本插件的脱敏与限长约束，还会引入非确定性。我们用**已经握在手里的确定性证据**做同一件事，零额外调用。否决。
2. **把「哪份候选带了证据」写进裁判视图**：更透明，但会邀请裁判按来源打折/加分，而这次比较要回答的是「哪一步更可能解决失败」。选择按内容-blind 判定，把来源记进统计供实验读取。否决。
3. **`autoProcessFailureContext` 默认关闭**：默认臂会退化成「信息更少的那一臂」，而过程选优本身就是默认关闭的实验特性，开关存在的意义是对照，不是保护。默认开启、显式关闭即对照。否决。
4. **保留 `PROPOSAL_CRITERIA`，只在提示词里加一句说明**：判据文本本身就是评分缓存键与提示词骨架，加说明等于换提示词却留着不对症的量表；而且「与已失败尝试不同」这类判断只有独立判据才能真正进入分数。否决。
5. **多模型候选 / N=3 + 多数票短路（上游 ensemble 与 `majority_voting`）**：本次**不实现**。N=2 时「多数」无定义；N=3 的 `select` 是 5 对 × 3 判据 × 2 轮 = 30 次判官调用（现为 6 次），会吃掉任务预算的约三分之一，而必须配套的「多数/近似候选短路」还没有，且是否值得由真实任务对照决定。留待数据。否决（暂缓）。
6. **投机并发生成以吃掉一半新增延迟**：意图在 `agent/pre-step` 就已登记，理论上可以与原回复**并发**生成备选，把新增延迟从「生成 + 裁判」降到「max(两者) + 裁判」。本次**不实现**：它要求把「预约 + 购买记录」提前到原回复完成之前，于是原回复超限/不完整/被取消这些当前**不花钱**的分支都会变成「买了一次生成再作废」，同时改写 `handle()` 的全部记账语义。这条正是上一轮分析里标注为「需要真实对照数据支持」的一项。留待数据。否决（暂缓）。

## Consequences

- 备选第一次真正「带着失败信息生成」，而比较量表也第一次问对问题；两者都不增加模型调用。
- 提示词变化 → 评分缓存自然失效（判据文本是缓存身份的一部分），无需升 `cache.ts` / `engine.ts` 的版本号。
- `criteriaSource` 由 `proposal` 变为 `process`：看板与离线汇总可以区分两类比较；历史行按缺省字段渲染，不受影响。
- 新增一个配置项，schema / `resolveConfig` / 设置页字段注册表 / 两份字典 / README 表格同改（`client-fields.test.ts` 的默认值一致性断言仍然通过）。
- 裁判调用数与预算口径不变；`route.alternativeAugmented` 是新增的观测字段，不进判定路径。
- 已知权衡：这份证据交接让备选臂在信息上占优，所以它**不能**用来论证「过程选优整体有效」——那是开关级别的对照；它只回答「同一周期里带证据的备选是否更常胜出」。
