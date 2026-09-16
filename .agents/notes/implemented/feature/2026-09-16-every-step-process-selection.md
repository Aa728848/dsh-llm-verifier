# Agent Note: 过程选优三档化（对齐上游 TurboAgent 的每步选优）与周期管线观测

Status: implemented

## Problem

上游 LLM-as-a-Verifier 的 Claude Code 插件 [TurboAgent](https://github.com/llm-as-a-verifier/TurboAgent) 以 API 代理形态运行：拦截客户端与模型 provider 之间的**每一次** LLM 请求，无差别地做 N 并发采样（温度 1，支持多模型池）→ PPT 锦标赛选优 → 缓冲后单次回放胜者，并配一个按请求展示管线的 visualizer。对照本插件，机制上同构的 P06 过程选优（`llm/stream` 拦截）却**默认关闭、仅在三连败……实为连续两次验证失败后才触发、每任务最多一个周期**——验证覆盖率与上游相差一个数量级，错误动作在进入会话历史前无法被拦截换掉。差距不在算法（两边同源），而在触发策略与默认档位。

## Decision

本轮把 P06 从"死循环打破器"升级为可选的"每步选优"，全部改动如下：

1. **三档开关**：`autoProcessSelection` 从 boolean 改为 `'off' | 'recovery' | 'every-step'`，默认 `off`。旧布尔兼容：`true`→`recovery`（原语义），`false`/缺省→`off`；非法字符串 fail-closed 抛错（`config.ts` 的 `normalizeAutoProcessSelection` / `autoProcessSelectionSchema`，注意 schemastery transform 会吞内层 default，外层必须再挂一次）。
2. **every-step 触发**：`registerProcessIntent`（`index.ts`）在 every-step 档下不再要求两连败信号，任务存在、无 pending intent、周期计数未达上限即为每个主循环请求登记意图；recovery 档语义逐位不变。recovery 信号恰好存在且 `autoProcessFailureContext` 开启时备选仍附带失败证据。
3. **每任务周期额度**：新增 `maxProcessCyclesPerTask`（整数 1–32，默认 4），是独立于路由额度与最终验收额度的第三本账（`index.ts` 的 `processAllowance` 映射进 router policy 的 `maxProcessPerTask`）。计数取路由内存计数（`AutoRouter.processAttemptCount`）与话题侧车 `process-selection-v1.json` 的 purchased 行数两者的较大值，插件重载不失忆；侧车文件格式仍为 v1，仅读取侧聚合出 `count`。
4. **指纹修正**：过程周期的 router fingerprint 原先按 `{sessionId, taskStartSeq, signal}` 哈希，而 router 的 completed 集合按任务去重——不改则 any 模式每任务都只能买 1 个周期。已把 `intent.registeredAt` 加入哈希使指纹按请求唯一（`process-selection.ts`），recovery 档语义不受影响。
5. **多模型备选池**：`autoProcessAlternativeModel` 支持逗号分隔的 `provider/model` 列表；第 i 份备选用第 i 项，列表短于备选数时取模轮转（`resolveAlternativeTargets` / `alternativeTargetAt`），整个归一化列表记进 `route.alternativeModel`。设置页校验逐条镜像 `resolveConfig`。
6. **观测对齐 visualizer**：看板新增「过程选优周期」区块——纯函数 `buildProcessCycles`（`client-process-cycles.ts`）把 recent 行按 `cycleId` 折叠成周期视图（数值取逐行 max 而非求和，避免 skip 行与购买行重复计费），渲染 购买→备选生成（含模型池与失败证据 chip）→评判（含相同候选短路）→回放（candidate/original/none + canceled/skipReason） 的 chip 管线；设置页在 every-step 档下就地渲染成本与判官通道警告（`field.autoProcessSelection.everyStepWarning`）。
7. **明确不照搬上游**：多数票短路（majority voting 直接放行未评判候选）、fail-open 回落第一候选、无预算计量、牺牲流式（burst 回放）——四项均维持本插件既有取舍。

验证基线：`pnpm run build` 通过；`npx vitest run` 25 文件 666 passed / 2 skipped（`pricing.test.ts` 需 $env:DSH_HOME='' 规避本机既存环境问题）；新增边界测试覆盖三档归一化、额度边界 1/32 与 0/33/2.5、侧车计数跨任务隔离、备选按池轮转、周期折叠不重复计数、中英 chip 文案。

## Alternatives considered

- **API 代理形态（照抄 TurboAgent）**：能拦截每一次请求且无需宿主配合，但要求用户把全部流量改道经过代理、失去 DSH 的会话/预算/看板集成，与"DSH 插件"的产品形态冲突。未采用；every-step 档用宿主内的 `llm/stream` waterfall 达到同等拦截位置。
- **为 every-step 放行共享路由会话额度**：过程周期目前仍消耗 `sessionRouteAttempts`（默认 8/会话），every-step 实际步数上限是 `min(maxProcessCyclesPerTask, 剩余路由额度)`。放行会让昂贵的每步配置挤占最终验收的保留额度，违反"额度相互独立"原则。未采用；在 README 与字段 help 中文档化。
- **every-step 作为新默认**：报告结论是可显著提效，但每步多一份完整生成加一次评判的成本与延迟真实存在，且回放前必须缓冲整段回复。未采用；默认保持 `off`，旧布尔 `true` 也只升到 `recovery`，绝不静默把既有安装升级到昂贵档。
- **docs/ 专题长文**：仓库既定决策（`implemented/process/2026-09-13-remove-docs-design-documents.md`）要求 docs/ 保持为空、判断与证据进 Agent Notes。本轮分析稿最初落在 docs/，已按该决策迁入本笔记并移除原文件。

## Consequences

- every-step 使本插件在触发覆盖率上与上游对齐：错误动作在污染会话历史之前即可被替换，而不是事后靠 steering 修复。
- 成本显性化：设置页警告 + 折叠摘要显示当前档位 + 看板逐周期管线，操作者能直接看到每一步买了什么、回放了什么。
- 后续约束：`autoProcessSelection` 的三个消费点（schema、resolveConfig、client-fields validateValues）必须保持同一归一化规则；新增第 4 档时三处同步。过程周期的指纹身份含 `registeredAt`，改动指纹字段必须重跑 `process-selection.test.ts` 的重放与计数用例。
- 已知限制：显式标签通道（判官不返回 logprobs 时）的单字母抖动在 every-step 密度下被放大，警告文案已引导配置 logprobs 判官；every-step 与宿主会话额度共用意味着长任务可能提前触顶，届时回退原路径并记 `no-process-budget`。
