# Agent Note: 移除 docs/ 下的两份专题文档

Status: implemented

## Problem

仓库里同时存在 `docs/*.md`（上游对照、A 计划与验收记录）和新的 `.agents/notes/`：同一批决策有两处记录，
`docs/` 里的实测数据也不在任何变更日志里。Agent Notes 体系引入后，两边的分工没有明确写下。

## Decision

- 移除 `docs/plan-a-best-of-n.md` 与 `docs/upstream-turboagent-review.md`（提交 `c2b1f6d`），`docs/` 目录清空；
  变更决策与验收数据由 Agent Notes 承载。
- 如实记录：该提交的说明只有一句 `chore: remove unused file`，**删除的意图没有在仓库内留档**；两份文档的全文仍可从
  git 历史取回（例如 `git show c2b1f6d^:docs/upstream-turboagent-review.md`）。
- 处理随之产生的死链：`README.md` 两处引用与两篇 best-of-N 笔记里的三处引用，改为指向 Agent Notes 或提交号。

## Alternatives considered

1. **保留两份文档作为长期专题文档**：未采纳（已被该提交删除）。它们记载的探针数据与实施记录与笔记重叠。
2. **把两份文档迁入 `.agents/notes/archived/`**：本次未做。归档分类更适合「被后续变更取代的笔记」，而不是专题长文；
   需要保留时按 `c2b1f6d^` 取回更省事。
3. **什么都不做、只新增笔记**：否决。死链必须先处理，否则读者会点进不存在的文件。

## Consequences

- 仓库只有一套决策记录（`.agents/notes/`）；跨文档引用改为提交号与 `AGENTS.md`。
- 上游对照的完整论述（逐项评价上游做法的得与失）与 A 计划的排期/风险表不再有独立文档；需要时从 `c2b1f6d^` 取回。
- 若将来仍需要长期设计文档，应先在 `.agents/notes/README.md` 的「与其他文档的分工」一节里明确它放在哪里。

> 补录说明：本笔记由 2026-09-13 引入 Agent Notes 体系时补录，对应提交 `c2b1f6d`（及其父提交里被删除的两份文档）。