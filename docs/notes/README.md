# Agent Note 归档

这里存放开发过程中写下的决策记录：一条变更一页，正文是问题、决定、放弃的方案与后果。

**它不是当前规范。**当前生效的决策在 [../adr/](../adr/README.md)；模块为什么长成现在这样写在模块头部注释里；算法取舍在 [../DESIGN.md](../DESIGN.md)。本目录只在需要追溯"当时为什么这么想"时翻阅。

目录按状态与类别分：

```
implemented/    已交付：architecture / bug-fix / feature / process / simplification / testing
proposed/       未开工的计划，不是承诺
```

历史页里出现的路径（`src/*.ts`、`.agents/notes/`）是写作当时的布局，2026-11 的结构重构把源码拆进了 `src/<域>/`、测试移到了 `test/<域>/`。
