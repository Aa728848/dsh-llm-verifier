# Agent Note: 工具拒绝携带结构化 detail，取消改用宿主原生取消语义

Status: implemented

## Problem

计划预审是本插件唯一会**拒绝工具调用**的地方：`exit_plan_mode` 的计划得分低于阈值时，`tools/pre-execute` 返回 `{ kind: 'deny', reason }`，把弱计划连同判官发现打回模型重写。

这段实现有两个问题：

1. **拒绝只有一句面向模型的文本，没有可供界面识别的结构**。判官发现被打包进 `reason` 的固定前缀 + 百分数 + 发现正文 + 整改指令里，任何读取方（Web 工具卡、诊断界面）都只能靠解析这句话来回答"这是被自动门禁拒的，还是用户拒的？拒的是哪条规则？"。
2. **信号已中止的调用被当作放行处理**。原守卫把三种情况并为一条提前返回：

   ```ts
   if (exec.name !== 'exit_plan_mode' || exec.agent === undefined || exec.signal.aborted) return next()
   ```

   即调用已被取消时，插件把决策权交还给瀑布链的后续监听者，最终落到默认的 `{ kind: 'allow' }`。语义上是"允许一个不会执行的调用"。

DSH 0.1.6 为这两点提供了原生手段：`PreToolDecision` 扩展出 `deny` 的 `info?: ToolErrorInfo` 与全新的 `cancel` 分支。但插件声明支持 0.1.1–0.1.6 全部版本线，而锁定在 `0.1.1-rc.2` 的类型里 `deny` 仅有 `{ kind: 'deny'; reason: string }`，**不存在 `info`，也不存在 `cancel`**。

## Decision

新增 `src/tool-decision.ts` 作为唯一的跨版本适配点，导出两个函数，并在计划预审处改用它们。

**`denyWithInfo(reason, info)`**：在**所有**宿主版本上都发射 `info`，理由是两侧行为都已核实：

- 0.1.6 把它作为持久化错误 detail 记入 `tool/result`（durable projection 保留、面向模型的内容不含它），于是模型侧句子保持简短、发现内容在界面可见；
- 旧宿主的分发代码是 `const denialReason = decision.kind === 'allow' ? this.guardReason(exec) : decision.reason`，**只读取 `reason`**，未知的 `info` 键被完全忽略。

`name` / `code` 取 `VerifierPlanPreReviewDenied` / `VERIFIER_PLAN_PRE_REVIEW_DENIED`，与 `auto-review` 的 `AutoReviewDeniedError` / `AUTO_REVIEW_DENIED` 同构。`info.reason` 与模型侧正文共用同一个 `PLAN_REVIEW_FEEDBACK_CHARS = 4000` 上限（该数字此前是裸字面量，本次提为具名常量）。

**`cancelledCall()`**：仅在**信号确已中止**时返回 `{ kind: 'cancel' }`。跨版本安全性来自对两侧分发路径的逐行核对，而非类型断言：

- 0.1.6 把 `cancel` 映射到 `toolAbortedBeforeDispatchResult()`，即宿主的规范取消结果；
- 旧宿主遇到未知 `kind` 时，`denialReason` 取到 `undefined`，于是**跳过拒绝分支**，紧接着执行它自己的 `callerCancelled(exec)` 检查——正是同一条取消路径。

因此旧宿主上这不是"未知分支被容忍"，而是**通过既有分支抵达了等价结果**。这也构成了使用该函数的硬前提：**只有信号真已中止才可调用**，否则会误拒一个活调用。

守卫相应拆分为两步，使 `cancel` 只影响被门禁覆盖的调用：

```ts
if (exec.name !== 'exit_plan_mode' || exec.agent === undefined) return next()
if (exec.signal.aborted) return cancelledCall()
```

## Alternatives considered

1. **按宿主版本分支发射**：否决。三个相关行为（读 `reason`、`callerCancelled` 兜底）在 0.1.1 到 0.1.6 之间稳定，引入版本探测只会增加一个更脆弱的判断面，而两侧等价性已经可以直接从宿主源码读出。
2. **只在 0.1.6 上发射 `info`，旧宿主退回纯文本**：否决。`info` 在旧宿主上的开销为零（被忽略），而"是否带结构"若依版本而变，会让界面逻辑与测试都必须双分支，收益为负。
3. **让 `cancel` 覆盖所有工具的已中止调用**（把中止判断提到工具名判断之前）：否决。那会把行为变更扩散到本插件并不门控的每一个工具调用上，只为语义整齐而扩大到全局；当前写法把影响面限制在计划预审这一条路径。
4. **不引入新模块，在 `index.ts` 内联断言**：否决。跨版本断言需要集中说明两侧分发行为才有可维护性，且独立模块可被单测直接覆盖（`index.ts` 的装配级测试只能覆盖到端到端路径）。
5. **把 `info.reason` 设为不设上限的判官原文**：否决。判官输出长度不受控，未经限长地写入会话日志是风险面；与模型侧共用同一上限，使"界面看到的内容"不会超过"模型看到的内容"太多。

## Consequences

- 面向前端的拒绝可诊断性提升：工具卡可依据稳定的 `code` 区分自动门禁拒绝与其他拒绝，并展示原始发现，而模型上下文不因此增长。
- 已取消的调用走宿主原生取消语义，不再表现为"放行一个不会执行的调用"。
- 新增 `src/tool-decision.test.ts`（3 条）与 `src/index.test.ts` 的 3 条端到端用例：计划低于阈值时拒绝**确实携带** `info`（此前仓库中**没有任何测试断言过 deny 返回值**，只走通过 allow 路径）、已中止的门禁调用返回 `{ kind: 'cancel' }` 且**不购买任何判官调用**、以及非门控工具即使信号中止也仍然委托。
- 跨版本验证基线：`npx tsc --noEmit -p tsconfig.build.json`（锁定 `0.1.1-rc.2`，该环境下 `info` 与 `cancel` 均不在类型中）与"把 `tsconfig.local.json` 的 `paths` 指向本地 harness 实际 checkout 后运行 `tsc --noEmit`"（真实 0.1.6 宿主类型，两者均存在；复现方式见 `implemented/process/2026-09-17-local-harness-typecheck-fallthrough.md`）双双通过——同一份源码满足两套声明。
