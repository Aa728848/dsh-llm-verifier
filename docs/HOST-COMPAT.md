# 宿主兼容

本插件声明支持 DSH 0.1.1 到 0.2.1 的多条版本线，因此**宿主的每次改动都可能要求本仓库跟着改**。本文是这条维护路线的唯一入口：流程、陷阱、以及不要动的地方。决策理由见 [adr/D12](adr/D12-host-seams.md)，逐版本结论见 [CHANGELOG](CHANGELOG.md)。

## 1. 本插件消费的宿主面

宿主包：`@deepseek-ai/cordis`、`dsh-tools`、`dsh-agent`、`dsh-session`、`dsh-llm`、`dsh-attachment`、`dsh-settings`、`dsh-credentials`、`dsh-api-remotes`、`dsh-client-connection`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-client-ui-settings`、`dsh-client-ui-conversation`、`dsh-client-ui-primitives`、`dsh-client-locale`。

宿主**服务名**（`ctx.get()` / `ctx.inject()` 读取，类型系统看不见，改名就是静默失效）：`agents`、`llm`、`settings`、`credentials`、`jobs`、`workspaceChanges`、`connection`、`sidebarRightTabs`、`slots`、`remote` / `remote.session`。

宿主**事件**（`ctx.on()`）：`agent/pre-step`、`agent/turn-stopping`、`agent/disposed`、`tools/pre-execute`、`llm/stream`。

## 2. 升级流程

1. **确认目标版本线**：本地 checkout 的 `package.json` 版本、`git describe --tags`、以及 npm 上的 dist-tag 三者可能不一致，先对齐再说。
2. **直接 diff 宿主类型源文件**，不要靠猜：

   ```bash
   git diff <旧tag> <新tag> -- packages/llm/llm/src/message.ts
   git diff <旧tag> <新tag> -- packages/llm/llm/src/types.ts
   git diff <旧tag> <新tag> -- packages/core/tools/src/types.ts
   ```

   同时读宿主自己的决策日志，它比类型错误更早给出迁移意图。
3. **改 `package.json`**：`engines.dsh` 与 8 条 DSH peer 同步补新线（两套范围必须逐字一致），`devDependencies` 精确 pin 目标版——不用会浮到未审查版本的 caret。`dsh.client.inject` 增删同步。
4. **`pnpm install`**，`pnpm run typecheck` 收敛错误。每个错误都要判断是**类型搬家**还是**行为搬家**；后者必须改运行时读取逻辑，不能只改类型。
5. **把变化点收口成唯一的读取函数**，不要在调用点各写一遍分支。
6. **补回归测试**：断言边界值（新旧两种形态各一条、缺失标志、空数组），并至少一条端到端路径。
7. **`pnpm run verify:release`** 必须全绿。
8. **文档收尾**：本文件的兼容表、`CHANGELOG.md` 加一条、受影响的 ADR 就地更新。
9. **提交**：英文 conventional commits；peerDependencies 或行为变更算 `feat:`，纯修复算 `fix:`；版本号是单独一次 `chore: bump ...`。

## 3. 反复踩到的陷阱

| 陷阱 | 表现 | 对策 |
| --- | --- | --- |
| `paths` 解析失败静默回退 | `typecheck:local` 看起来全绿，实际验的是 npm 锁定版本 | `scripts/check-harness-types.mjs` 比对源码与声明产物的 mtime；用 `--traceResolution` 看落点 |
| `as any` / `as never` 把宿主面藏起来 | `tsc` 通过，运行时报 `xxx is not a function` | 宿主服务的每一处读取都按能力探测（`typeof x.get === 'function'`）+ `try/catch` 降级 |
| npm 上已删的包仍在 `node_modules` 里解析成功 | 死导入潜伏多个版本线 | 升级后核对 `dsh.client.inject` 与所有导入的包是否仍存在 |
| 客户端 bundle 的宿主模块是 external | 具名导入在另一侧宿主上是 `undefined`，React 抛错导致整页白屏 | 跨版本改写的名字要运行时探测 + 优雅降级 |
| 测试跑在旧宿主类型上 | 断言不会报错，只是全部失效（`undefined.length`） | 升级后检查测试有没有依赖已删除的宿主成员 |
| 预发布版本的 semver | `^0.1.7` **不匹配** `0.1.7-alpha.1`；漏一条线 = 插件在 profile 里根本不加载 | 显式列出每个预发布形态；增删后跑宿主 `evaluatePluginCompatibility()` |
| harness 的 `lib/types` 是构建产物 | `git pull` 后源码变了、产物没重建，对着旧类型报绿 | 重建 harness 再跑 `typecheck:local` |
| harness 的 `lib/` 也是产物 | `dsh --version` 已是新版 ≠ 新版代码在跑 | 比对 mtime，确认新符号真的出现在 `lib/` 里；这属于 harness 侧，不在本仓库修 |

## 4. 不要当成 bug 顺手"修"掉

- **门禁精确锁在 `0.2.1-rc.3`，兼容声明也停在这条线**。代价是 0.1.1–0.1.6 的宿主面不再被自动化类型检查覆盖，只靠运行时双形态读取与回归测试保证。精确 pin 是为了防止门禁在未逐 tag 审查时浮到半发布版本。
- **`snapshotEvents()` 是有豁免的调用**：见 [D12](adr/D12-host-seams.md)。
- **`lib/types/plugin/message-source.d.ts` 是孤立产物**：该模块只含类型层声明，运行时被 tree-shake，没有对应的 `lib/plugin/message-source.js`，属正常。
- **`lib/` 里的 chunk 文件名带 hash**：`build` 先清空 `lib/`，磁盘上成对的新增/删除是正常的，不要手工保留旧文件。
