---
name: dsh-version-upgrade
description: Use when the local DeepSeek Harness (DSH) checkout has been updated and dsh-llm-verifier must be brought onto the new host version line, when adding support for another DSH line, when a DSH upgrade breaks this plugin, or when asked what a DSH version changed for this project. Covers the local harness path, how to diff the host's type surface between two tags, the verify loop, the recurring silent-failure traps, and the per-version key points.
---

# DSH 版本升级（dsh-llm-verifier）

本仓库是 DSH 的插件，同时声明支持多条宿主版本线，所以**宿主的每次改动都可能要求本仓库跟着改**。本技能是这条维护路线的唯一入口：流程、陷阱、以及每次升级的要点索引。深层决策理由（为什么这么选、放弃了什么）不在本文件，而在 `.agents/notes/implemented/`——本文件只放"怎么做"与"去哪里读"。

## 0. 前提：DSH 是本地开发版本

本机的 harness 是**本地开发 checkout，不是 npm 安装的副本**：

```text
C:\Users\A\Documents\deepseek-harness
```

注意它与本仓库**不是同级目录**（本仓库在 `C:\Users\A\Documents\ChatGPT\` 下），所以 `tsconfig.local.json` 里约定的 `../deepseek-harness` 在本机不成立。

每次动手前先确认"现在到底该对齐哪一版"：

```bash
# 本地 checkout 的版本与它精确停在哪个 tag
cd /c/Users/A/Documents/deepseek-harness
node -p "require('C:/Users/A/Documents/deepseek-harness/package.json').version"
git describe --tags && git log --oneline -3

# npm 上已发布的版本线与 dist-tag
npm view @deepseek-ai/dsh-tools dist-tags --json
npm view @deepseek-ai/dsh-tools versions --json | tr -d '\n '
```

**关键判断**：若 `git describe --tags` 正好等于 npm 的 `next`/`alpha` 标签那一版（例如都是 `dsh-v0.1.7-rc.1`），那么 `package.json` 锁定的 npm 版本与本机 checkout 是**同一套公开 API**——`pnpm run typecheck` 已经验过本地源码对应的类型，不必再去搭 `typecheck:local`。只有本地 checkout **跑在已发布版本之前**时，才必须接通本地类型检查（见 §4）。

## 1. 本插件消费的宿主面

改任何东西之前先知道边界在哪。宿主包（`peerDependencies` + `devDependencies`）：

`@deepseek-ai/cordis`、`dsh-tools`、`dsh-agent`、`dsh-session`、`dsh-llm`、`dsh-attachment`、`dsh-settings`、`dsh-credentials`、`dsh-api-remotes`、`dsh-client-connection`、`dsh-client-ui-renderer`、`dsh-client-ui-slots`、`dsh-client-ui-settings`、`dsh-client-ui-conversation`、`dsh-client-ui-primitives`、`dsh-client-locale`。

宿主**服务名**（通过 `ctx.get()` / `ctx.inject()` 读，类型系统看不见，**改名就是静默失效**）：`llm`、`settings`、`credentials`、`subagents`、`jobs`、`workspaceChanges`、`connection`、`sidebarRightTabs`、`slots`、`remote`/`remote.session`。

宿主**事件**（`ctx.on()`）：`agent/pre-step`、`agent/turn-stopping`、`agent/disposed`、`tools/pre-execute`、`llm/stream`。

## 2. 升级流程

1. **确认目标版本线**（§0）。
2. **找破坏性变更**——不要靠猜，直接 diff 宿主的类型源文件：

   ```bash
   cd /c/Users/A/Documents/deepseek-harness
   git diff <旧tag> <新tag> -- packages/llm/llm/src/message.ts
   git diff <旧tag> <新tag> -- packages/llm/llm/src/types.ts
   git diff <旧tag> <新tag> -- packages/core/tools/src/types.ts
   git diff <旧tag> <新tag> -- packages/session/session-format-v3-to-v4/src/
   ```

   同时读宿主自己的决策日志：`/c/Users/A/Documents/deepseek-harness/.agents/notes/implemented/**`——它记录了"哪些是被有意删掉的"，比类型错误更早给出迁移意图。
3. **改 `package.json`**：`peerDependencies` 补新线（**硬要求**：0.1.7-rc.1 起宿主对 `@deepseek-ai/dsh*` 逐个强制校验，缺线就是整个插件被停用，见 §3）、`devDependencies` 上移、`dsh.client.inject` 同步增删包名。
4. **`pnpm install`**，然后 `npx tsc --noEmit -p tsconfig.build.json` 收敛错误。**逐个错误都要判断是"类型搬家"还是"行为搬家"**——后者必须改运行时读取逻辑，不能只改类型。
5. **把变化点收口成唯一的读取函数**，而不是在每个调用点各写一遍分支（`toolResultBlocks` / `toolResultFailed` 就是这个模式的样板）。
6. **补回归测试**：断言边界值（两种形态各一条、缺失标志、空数组），并至少一条端到端路径（真实 `Session` + `extractSession`）。
7. **`pnpm run verify:release`**（typecheck + 全量测试 + 重建 `lib/` + 刷新已安装 profile 副本）必须全绿；`lib/` 是宿主实际加载的产物，**必须与 `src/` 同一次提交入库**。
8. **文档收尾**：`README.md` 的版本兼容段、`AGENTS.md` 第 7 节与第 8 条硬规矩、宿主契约速查表；非平凡决策按治理规则写/更新 Agent Note（`implemented/architecture/` 或就地更新 Owning Note）。
9. **提交**：英文 conventional commits；`peerDependencies`/行为变更算 `feat:`，纯修复算 `fix:`；版本号是**单独一次** `chore: bump ...`。
10. **在本文件 §5 追加一条要点索引**（一行一句 + 链到 Agent Note）。

## 3. 反复踩到的陷阱

- **`paths` 解析失败会静默回退到 `node_modules`**。`tsconfig.local.json` 的目标不存在时 TypeScript **不报错**，于是命令看起来绿、实际验的是 npm 锁定版本。这是本仓库曾经"绿得没有意义"的根因，`scripts/check-harness-types.mjs` 就是拦它的。判断真假要用 `--traceResolution` 看落点。
- **`as any` / `as never` 会把宿主面藏起来**。`tsc` 通过 ≠ 宿主面正确。改动 `client.tsx` 或 `index.ts` 里的宿主读取后，要**手动**回宿主动手核对服务名与签名，不要依赖类型检查。
- **npm 上删掉的包仍可能在 `node_modules` 里解析成功**。`@deepseek-ai/dsh-client-runtime` 在 0.1.2 就被删除，但插件一直从它导入——因为 `latest` 标签停在 `0.1.1-rc.2`，解析成功、编译通过，于是这个"死导入"潜伏了五个版本线。**升级后顺手核对 `dsh.client.inject` 与所有导入的包是否仍然存在**（`ls node_modules/@deepseek-ai/`）。
- **客户端 bundle 的宿主模块是 external**。宿主端整体改名的具名导入（如整套图标名）在另一侧宿主上就是 `undefined`；React 遇到 `undefined` 作为组件类型会**抛错**，会让整个页面白屏而不是少一个图标。跨版本改写要对这类名字做运行时探测 + 优雅降级。
- **测试可能跑在旧宿主类型上**。`Session.events` 早就被 `snapshotEvents()` 取代，但测试直接读 `session.events` 时不会报错，只是**全部断言失效**（`undefined.length`）。升级后要检查测试有没有依赖已删除的宿主成员。
- **宿主服务的方法会整批消失，而 `any` 让类型检查看不见**。0.1.7 把 `settings` 的注册式接缝换成 `SettingsForms` 后，`get(ns)` 被删除（原型上只剩 `configure` / `describe`），调用点抛 `settings.get is not a function` 并从路由解析一路穿透到验收崩溃。插件读宿主服务的每一处都要**按能力探测**（`typeof x.get === 'function'` 再退化到新 API）并包 `try/catch` 降级；同时回宿主源码/`git show <tag>:<file>` 核对服务名与方法集，别信 `as any`。
- **预发布版本的 semver，以及 0.1.7-rc.1 起宿主对它的强制执行**：`^0.1.7` **不匹配** `0.1.7-alpha.1`。新增版本线必须显式列预发布形态（照现有写法追加 `|| ^0.1.7-alpha.2 || ^0.1.7-rc.1`）。更要紧的是：`packages/boot/app-boot/src/plugin-compatibility.ts` 的 `evaluatePluginCompatibility()` 现在对每个 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 条目跑 `semver.satisfies(运行版本, 范围, { includePrerelease: true })`（运行版本取 **app-boot 自己的 `package.json`**，不是 CLI 的），不满足的行直接标 `disabled`，bundle 层则在 `profile.ts` 里整个跳过并打 stderr。所以**漏一条版本线 = 插件在 profile 里根本不加载**，不是降级；用户只能靠 `dsh plugin allow-version` 写 profile 目录下的 `compatibility.json` 做精确版本豁免。`@deepseek-ai/cordis` 不在检查范围内。自己复核范围是否覆盖运行版本时，注意要用 `includePrerelease: true`（否则会得出与宿主相反的结论）。
- **harness 的 `lib/types` 是构建产物**。本地 checkout `git pull` 之后源码变了、产物没重建，`typecheck:local` 会对着旧类型报绿——护栏比对源码 mtime 就是为了这个。
- **harness 的 `lib/`（运行时产物）同样会滞后，而本机全局 `dsh` 正是链到它**。`C:\Users\A\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*` 全是指向 checkout `packages/**` 的 symlink，`main` 指向各自的 `lib/`。因此"`dsh --version` 已经是新版"**不等于**"新版代码在跑"：`package.json` 的版本号随 `git pull` 立即变，而 `lib/` 要重建跟上。核对办法是比对 mtime（`find packages/boot/app-boot/src -newer packages/boot/app-boot/lib/index.js`）并确认新符号真的出现在 `lib/` 里。这是 harness 侧的构建状态，**不要**在本仓库的升级里顺手重建 harness——报告给用户。
- **`lib/` 里的旧 chunk 文件名**：`build` 会先清空 `lib/`，产物文件名带 hash，所以升级后 `git status` 里必然出现成对的新增/删除；这是正常的，不要手工保留旧文件。

## 4. 接通 `typecheck:local`（需要验未发布的本地源码时才做）

约定路径是 `../deepseek-harness`，本机不成立。两条出路：

```bash
# 出路 A：建目录 junction（仓库内零改动，rmdir 即可撤销）
cmd //c "mklink /J C:\\Users\\A\\Documents\\ChatGPT\\deepseek-harness C:\\Users\\A\\Documents\\deepseek-harness"

# 出路 B：不动仓库文件，另建一份 extends tsconfig.local.json 的临时配置逐条改 paths
```

无论走哪条，**必须先用 `--traceResolution` 复核解析落点确实是 harness**，否则无法区分"真的验了 harness"与"静默回退到 node_modules"。

harness 的类型产物还需要先重建（在其 checkout 内）：

```bash
pnpm install
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.client.json
```

客户端面（`client/ui-*`、`api/remotes`）依赖 harness 的可选依赖才能 emit，缺依赖时它们的 `lib/types` 会停在旧产物上，护栏会如实报"源码比产物新"——这不是本仓库的问题。应急可用 `DSH_VERIFIER_SKIP_HARNESS_CHECK=1` 跳过护栏一次。

## 5. 每次升级的要点索引

最新在上。每条只写"这一版动了什么、我们怎么应对"，深层理由链到 Agent Note。

### 2026-09-23 → DSH `dsh-v0.1.7-rc.1`

- **本版对插件消费的宿主面全是加法**：`dsh-session` / `dsh-llm` / `dsh-settings` / `dsh-agent` / `dsh-credentials` / `dsh-client-ui-renderer` / `dsh-client-ui-slots` / `dsh-client-ui-settings` / `dsh-client-connection` 源码零改动；`packages/core/tools` 只新增可选 `projectContent`，`ui-primitives` 只加图标与组件，`locale` 只加词条。**结论：只换版本线，不动插件代码。**
- **宿主开始强制 peer 兼容**：`app-boot` 新增 `plugin-compatibility.ts` / `compatibility-preflight.ts` / `profile-compatibility.ts`，对每个 `@deepseek-ai/dsh*` 条目做 `semver.satisfies(运行版本, 范围, { includePrerelease: true })`，不满足即停用该插件行、跳过整个 bundle。`peerDependencies` 因此从"声明"变成"门禁"，本次为各包追加 `|| ^0.1.7-alpha.2 || ^0.1.7-rc.1`。
- **重跑流程验证了 §0 的判断**：本机 checkout 正停在 `dsh-v0.1.7-rc.1`，与 npm `next` 标签同版，`pnpm run typecheck` 即已验过该版公开 API，不必搭 `typecheck:local`。
- 决策全文：`.agents/notes/implemented/architecture/2026-09-22-dsh-0.1.7-alignment.md`

### 2026-09-22 → DSH `dsh-v0.1.7-alpha.1`

- **工具结果从内容块变成独立消息**：`tool-result` 块类型被删除，工具结果改为 `role: 'tool'` 消息，`isError` 从块上移到消息上。收口为 `src/session.ts` 的 `toolResultBlocks()` / `toolResultFailed()`，`router.ts`、`auto.ts` 全部改走它们。
- **注入消息来源改为生产者自报 kind**：`MessageSourceMap` 删除 `{ kind: 'plugin', plugin }` 包装，且 V4 持久化准入**直接拒绝**该字面量。新增 `src/message-source.ts` 声明 `kind: 'llm-verifier'`，14 处注入点统一改用。
- **客户端面搬家**：`ctx.slots` 由 `@deepseek-ai/dsh-client-ui-renderer` 声明，`Context` 取自 `@deepseek-ai/cordis`；`ModelProviderGroup` 不再从 remotes 桶转出，改为本地声明视图类型。
- **整套图标改名**（`…16` → `…Regular`，仅 0.1.7 改）：改为运行时按名探测 + 缺失时渲染空。
- **`devDependencies` 上移到 `0.1.7-alpha.1`**：图标名让"锁最低基线"在实现上不可满足，门禁锁哪条线就只能验哪条线。**这反转了一条既有的有意决策**，已记录。
- 决策全文：`.agents/notes/implemented/architecture/2026-09-22-dsh-0.1.7-alignment.md`

## 6. 已知待决（不要当成 bug 顺手"修"掉）

- **门禁 pin 现锁新线**（`0.1.7-rc.1`）。代价：0.1.1–0.1.6 的**宿主面**不再被自动化类型检查，只靠运行时双形态读取 + 回归测试保证；**客户端面**其余部分只在 0.1.7 类型下受检。想锁回最低基线，需要先把宿主图标换成插件自有的内联 SVG。
- **本机 `typecheck:local` 未接通**（§4 的 junction 没建）。这是有意的：本地 checkout 与 npm `next`/`alpha` 同版时它不带来额外覆盖。
- **本机 harness checkout 的 `lib/` 比源码旧**：`packages/boot/app-boot/lib/` 是 2026-09-23 16:32 的产物，早于该目录里 rc.1 的源码（`plugin-compatibility.ts` 等），且 `packages/boot/app-boot/node_modules/semver` 未安装。也就是说**全局 `dsh` 报 `0.1.7-rc.1`，但跑的 app-boot 代码还不是 rc.1**，新的 peer 强制在用户机器上尚未生效。这是 harness 侧的构建状态，需重建 harness 才消解；不属于本仓库的升级动作。
- **`lib/types/message-source.d.ts` 是孤立产物**：`message-source.ts` 只含类型层声明，运行时被 tree-shake，因此没有对应的 `lib/message-source.js`；包对外的 `lib/types/index.d.ts` 也不引用它，属正常。
