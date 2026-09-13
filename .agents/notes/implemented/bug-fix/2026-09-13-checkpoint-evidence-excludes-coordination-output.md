# Agent Note: 检查点证据排除记账/声明类工具，并为最新检查点补上验证运行

Status: implemented

## Problem

自动路由把「每个进度检查点之前最近一次成功工具输出」当作裁判的实测证据。但输出位只有一个，于是
「最近一次输出」经常落在**没有任何产出**的调用上：

- `present` 是每轮最后一个调用，它声明的是「交付物已宣告」，结果「最新观测输出」永远只剩声明本身；
  裁判按提示词自己的规矩把最新检查点封顶在 K（52.6%），连续四轮验收不过，而活儿早就干完并跑过测试。
- 同类问题还出现在 `todo_write` / `create_goal` / `get_goal` / `update_goal` / `interrupt_agent` /
  `list_agents` / `exit_plan_mode` / `skill` 等记账/协调类工具（它们的返回就是刚写进去的快照），
  以及 `run_code` 里**全部派发都是记账类工具**的包装结果。
- 后台子 Agent 的启动回执（`started subagent <id>` / `started background subagent job <id>`）也不是产出；
  而前台 `subagent` 的返回是子 Agent 的真实报告，属于交付物。

更深一层：最新检查点的证据位放不下「任务尾巴」和「被尾巴挡住的测试」，于是真正跑过测试的输出反而进不了提示词。

## Decision

1. 证据判据收敛为 `router.ts` 的 `isEvidenceOutput(name, text)` **一份定义**，检查点渲染、语义候选列表、
   语义引用校验、PTC 包装体归属四处共用。
2. 明确不算证据的三类：① 记账/协调类工具（含 `present`）；② 插件自己的 `verifier_*` 判决工具——必须留在
   证据索引里给 `successfulExplicitKinds` 用，但绝不作为观测输出渲染（否则裁判等于拿自己上一次的判决当证据）；
   ③ 后台子 Agent 启动回执。PTC 的 `run_code` 按 `tool/ptc-dispatch` 的 `rootCallId` 归属判断：派发全部不算
   证据时，整条包装结果一并排除。
3. 最新检查点额外附带 `verificationEvidence`：按 `VERIFICATION_SIGNATURES`（vitest/jest/pytest/go/tsc/
   `EXIT=0` 等输出形状）找回「最近一次验证运行」，并附一行确定性的 `trailingSummary`（此后发生了多少次工具
   结果、分别是哪些工具），让裁判自己判断这次测试还覆不覆盖当前状态。只补最新检查点——历史检查点描述的是
   过去的状态。

## Alternatives considered

1. **各处各写一份「不算证据」的名单**：否决。这类回归已经出现过三次（`router.test.ts`），名单漂移正是根因；
   收敛成一个判据才能被一处测试守住。
2. **把所有非 `edit`/`write`/`pwsh` 的调用都排除**：否决。会连带丢掉 `ask_user_question`（用户给的信息）、
   `job_output`（带 job 的真实输出）这类有真实产出的调用。
3. **给历史检查点也补验证运行**：否决。历史检查点描述的是当时的状态，补上「后来的验证」会让过去看起来比实际更完成。
4. **放松阈值让门控放行**：否决。`verificationEvidence` 不放松任何阈值，只是把会话里真实发生过的证据重新摆到裁判眼前。

## Consequences

- 每轮以一个声明（`present`）收尾的交付流程不再被系统性误判；实测最贵的那次回归（连续四轮不过）消失。
- 判据是启发式：漏判只是退回单输出渲染（不会更糟），误判只是多给裁判看一条真实输出，两者都不可能凭空造出证据。
- 新增证据来源时要先问「它有没有自己的产出」，并按 `isEvidenceOutput` 归类。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `b763333`、`24243c0`、`e92bcda`；
> 内容取自 `AGENTS.md`「已知的有意设计」中「检查点证据只有一个判据」一条与 `src/router.ts` 的实现。