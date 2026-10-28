# Agent Note: 判官自检（诊断，不是验收）

Status: implemented

## Problem

「判官到底能不能用、现在走哪条评分通道、回答能不能被解析出 A–T」这三件事此前只存在于日志里。看板是全局页面，
没有当前会话；而通道能力有最多 24 小时的缓存标记，重启后还会从文件里被 max-merge 复活——于是「通道显示
`explicit-tag`」既可能是真的，也可能只是复述一个陈旧标记。

## Decision

1. `index.ts` 新增 `{kind:'probe'}` 诊断，与统计/决策走同一条 `/api/llm-verifier/statistics` 路由；对每个判官发一次
   **真实**调用（超时上限 30s、不重试、不写入统计、不写评分缓存），回报可达性、实际通道、能否解析出 A–T、延迟与
   当前生效判据。
2. **强制重新探测**：调用前先 `topLogprobCapabilities.forget(provider, model)`。`forget` 必须在序列化写入**内部**
   再删一次键（hydration 会把文件 max-merge 回内存，只在前台删会被自己的写入复活），并持久化。
3. 看板是全局页面：`ctx.agents.currentInitiator()` 通常为 undefined，退回 `sessionHeaders()`（按 `createdAt` 倒序，
   兼容 `{header}` 包装与裸 header 两种持久化形态）里最新的 header，用 `engineForHeader(header)` 构造判官；
   一个话题都没有时返回明确说明，绝不复用 `requireAgent()` 那句「随话题删除」的报错。
4. 面板显示「通道 … · 已重新探测」，让「这次是真的重探」肉眼可见。

## Alternatives considered

1. **只做可达性 ping**：否决。可达不等于能解析出判决；探针要回答的是「回答能不能用」。
2. **复用一次真实验收当诊断**：否决。会写统计与评分缓存，污染成本口径与缓存身份。
3. **按 provider / 模型名预设通道**：否决（硬性规矩 7）。评分通道能力必须运行时探测。
4. **在面板上手动删能力文件**：否决。忘记删、忘记重启都会复现陈旧标记；`forget` 才是唯一正确的语义。
5. **自检失败时把门控也拦下来**：否决。自检是诊断，不得参与任何判定。

## Consequences

- 「我现在到底走哪条通道」有了可重复的答案：本机实测 `antigravity/gemini-3.8-flash` 强制重探后仍是 `explicit-tag`
  （方向正确 A 100% / B 0%，单次约 21.8 s）。
- 副作用：探到支持 logprobs 时，后续真实验收也改走概率期望通道——期望行为，但会改变缓存身份，需要留意。
- 看板不要求「有会话」，因此探针只能挂在最新话题的能力记忆上（评分缓存与能力标记按 topic 隔离）。

> 补录说明：本笔记于 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `eafc5ee`、`197522f`、`7b65c9a`；
> 内容取自 `AGENTS.md`「判官自检是诊断，不是验收」一条与 `src/index.ts` 的 `handleProbe`。