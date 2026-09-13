# Agent Note: 验证失败从输出文本判定（P06 触发与 FAILED 标记修复）

Status: implemented

## Problem

三处判定「这次验证失败了没有」的地方，读的都是**工具级状态** `EvidenceCall.ok`，而不是这次运行自己报出的判决：

1. `router.ts` 的 `inspectRecoverySignal()` —— P06 过程选优的唯一触发条件，要求最近两次验证运行 `ok === false`；
2. checkpoint / 最近验证运行 / 最近工具摘要的 `— FAILED` / `[FAILED]` 标记；
3. `inspectDeliveryPhase()` 的 `verification.ok`（进交付阶段签名）。

而宿主对非零退出**不置 error**：`packages/shell/tool-pwsh/src/render.ts` 的文件头写着 “Non-zero exits are reported, not errored — only infrastructure failures (spawn errors, aborts) surface as isError results”，失败的退出码是拼进文本的 `[exit code: N]`（同文件 `:74-75`）。因此一次失败的 `pnpm test` 是 `ok === true` 的成功工具调用，于是：

- **P06 在真实宿主里几乎无法触发**（两次失败的测试运行看起来像两次成功，`runs.some(run => run.ok)` 直接返回 undefined）；
- 失败的测试运行在检查点里不带 FAILED 标记，裁判看到的是「一次正常输出」；
- 交付阶段签名里那一位 `ok` 也不反映判决。

插件自己的回归夹具（`index.test.ts` 的 `failed()`）用 `isError: true` 构造失败，**恰好把这个错误的宿主契约编成了期望**，所以测试套件完全看不到这个缺口。

同一处还存在识别面偏窄的问题：`VERIFICATION_SIGNATURES` 全是成功形状，`(?:TEST|TYPECHECK|BUILD|…)_EXIT` 只认 `= 0`，失败的 `tsc --noEmit`（`error TS2322`）**连带失败的那一侧**都算不上一「验证运行」。

## Decision

`src/router.ts`：

- 签名表拆成 `VERIFICATION_PASS_SIGNATURES`（原表，逐字保留）与 `VERIFICATION_FAILURE_SIGNATURES`（新增）：`[exit code: 1-9…]`、`Test Files N failed`、`Tests N failed`（N ≥ 1）、`N failed`、行首 `FAIL`/`FAILED`/`FAILURES`、`test result: FAILED`、`--- FAIL:`、`error TS<数字>`、`*_EXIT = <非零>`；二者并集仍是 `VERIFICATION_SIGNATURES`，`looksLikeVerificationRun()` 的语义（「这像不像一次验证运行」）不变，只是不再只认成功形状。**`0 failed` 不算失败**；
- 新增导出的 `verificationVerdict(text)`（失败形状优先于成功形状，都不匹配返回 undefined）与 `verificationFailed(call)`（`ok === false` 或判决为 failed；识别不出**不**算失败，避免在猜测上买周期）；
- 三个消费点改为 `verificationFailed`：`inspectRecoverySignal` 的两次判定、三处 FAILED 标记、`inspectDeliveryPhase` 的 `verification.ok`。

**刻意不动 `EvidenceCall.ok` 本身**：`pair.ok` 还在承担「失败的 PTC dispatch / 失败的显式复核 / 失败的工作流信封不能当候选」这类工具级语义，重定义会把这些一起改坏。新函数是「这次验证失败了没有」的唯一判据，与「这次工具调用成功没有」分开。

回归（`src/router.test.ts`：`verification verdicts` 一组 5 条，另在 `failed evidence in progress checkpoints` 补 1 条真实宿主形态的渲染断言）：用 `tool()`（`isError: false`，即真实宿主形态）构造 `Tests 1 failed | 2 passed (3)` + `[exit code: 1]` 两次，断言触发；`0 failed` 不触发；失败的 typecheck 触发且交付阶段 `verification.ok === false`；以及判决函数的边界值。

## Alternatives considered

1. **重定义 `EvidenceCall.ok` 为「判决通过」**：最省事，但 `pair.ok` 同时是候选资格、显式复核去重与工作流信封的门。把「工具调用成功」和「验证通过」合成一栏，会让一个失败的 `verifier_compare` 调用与一个失败的测试运行变得不可区分。否决。
2. **在 `successful()` 里解析 `[exit code: N]`**：等价于把判决塞回工具状态，和方案 1 是同一个错误，只是更隐蔽。否决。
3. **只认 `[exit code: N]` 标记**：构建脚本、`tsc`、部分 runner 不产生该标记（或输出被截断），而 pytest/cargo 的 `N failed` 才是唯一线索。只识别一种形状会把触发面重新收窄。否决。
4. **维持现状，等宿主把非零退出改为 isError**：这不是本插件能决定的；而且 P06 在此之前**一次都不会触发**，功能等于不存在。否决。

## Consequences

- P06 的触发条件第一次真正可达：契约由「工具报了错」变成「运行说了自己失败」，这正是它设计时要判的东西。
- 检查点现在会给失败的测试/类型检查打上 FAILED 标记，裁判不再把一次失败运行读成正常输出；这是**如实呈现**，不放松任何阈值。
- 交付阶段签名的 `ok` 位随判决翻转，签名会在「同一次运行被重新判定」时变化；该签名只用于「同一完成状态不重复跳过路由」，一次额外跳过的代价可接受。
- 启发式仍可能误判（例如一段引用了 `1 failed` 字样的非验证输出被标 FAILED）：影响只限于渲染标记与「两次失败」的触发，且不放松验收；失败形状集中在同一个列表，后续只需维护一处。
- `lib/` 同步重建（`pnpm run verify:release`）。
