# Agent Note: profile 同步不再"失败即丢插件"，并识别仓库搬家后的陈旧 pin

Status: implemented

## Problem

`pnpm run build` 末尾的 `scripts/sync-installed-profiles.mjs` 在真实环境里连续踩到两个问题，合起来表现为截图里的三行输出（`0 of 2 profile(s) refreshed`）：

1. **刷新是破坏性的，且失败不恢复。** 旧实现按"先删副本、再 `pnpm install`"执行，而 `pnpm install` 的失败只被 `stdio:'ignore'` 吞掉，最后只剩一句 `Command failed: cmd /c pnpm install`。实测后果不是"这次没刷新"，而是 **`web` profile 的 `node_modules/dsh-llm-verifier` 被删掉后再也没装回来**：宿主下次启动时该 profile 里根本没有这个插件（`.modules.yaml` 里还留着 `dsh-llm-verifier@file:...` 的旧记录，目录却不存在）。
2. **失败的真实原因被掩盖：仓库搬家后的陈旧 lockfile pin。** 仓库从 `C:\Users\A\Documents\dsh-llm-verifier` 移到了 `...\Documents\ChatGPT\dsh-llm-verifier`，profile 的 `package.json` 已指向新路径，但 profile 的 `pnpm-lock.yaml` 里 `dsh-llm-verifier` 的解析结果仍钉在旧路径（`version: file:../../../Documents/dsh-llm-verifier` 与 `resolution: {directory: ...}`）。pnpm 对 `file:` 目录依赖**按 lockfile 的 pin 解析，不看 manifest**，于是永远 `ENOENT`。在临时工程里逐一实测确认：`pnpm install`、`pnpm install --force`、`pnpm install --fix-lockfile`、`pnpm add file:<新路径>` **四种全部复用旧 pin 并失败**，只有让 pin 本身更新（`--fix-lockfile` 也不行）才会重新解析。
3. **`trading` profile 的提示是误报。** 旧实现只看 `<profile>/node_modules/<name>`，于是把"只把本包列进 `dsh.profile.bundles`、`dependencies` 为空"的 profile 也报成"有声明却没安装；去跑 pnpm install"——而这类 profile 由宿主自己的模块回退机制服务：`$DSH_HOME/profiles/node_modules/dsh-llm-verifier` 是一个指向包实体的链接（本机实测为 Junction → 仓库根），永远是最新的，`pnpm install` 在那里同样什么都不做（其 dependencies 就是空的）。

## Decision

重写 `scripts/sync-installed-profiles.mjs` 的刷新路径，保持"仍由 build 自动刷新、无 profile 时 no-op"这两个已有契约不变：

- **先移开、再安装、失败恢复**：把已安装副本 `rename` 成 `<dir>.sync-backup` 再跑 `pnpm install`；安装失败则删掉半成品、把备份改回原名，并打印 pnpm 自己日志的末几行。**旧副本被移开之后的任何失败路径都必须回到"至少还有旧副本"**——陈旧副本只是没跟上，缺插件是功能消失。
- **日志走文件、不走管道**：pnpm 的 stdout/stderr 写进 `os.tmpdir()` 下的日志文件再读末 8 行（宿主沙箱禁止管道 stdio，而 `stdio:'ignore'` 正是"只剩 Command failed"的来源）。文件打不开时退回 `ignore`，不因此中断构建。
- **删任何东西之前先修陈旧 pin**：从 manifest 的 `file:`/`link:` 说明符算出目标目录，与 lockfile 里该包 `@file:` 条的 `resolution.directory` 比对；pin 指向的目录不存在而 manifest 指向的目录存在时，把 lockfile 中该 pin 的**字面量整体替换**为新目录（相对 profile 的路径，正斜杠）。只动这一个包的 pin，避免整份 lockfile 重新解析把 profile 的其它依赖一起升级。`--check` 会打印 `would repair ...` 而不落盘。
- **manifest 指向的目录根本不存在**时按"仓库搬家"处理，不再只报一句：把该 profile 的 `package.json` 里这条 `file:` 依赖改写成**本仓库当前位置**（用调用者自己解析出的真实路径，所以谁跑 build 就指向谁），并把 lockfile 里镜像这条 specifier 的那一行一起改掉，然后照常修 pin、照常刷新。改写失败（例如 manifest 里的 JSON 转义形态和字面量对不上）时退回旧行为：只报一句、不动副本。理由与备选见文末追加节。
- **检查模式把计划说全**：`--check` 依次打印 `would repoint ...` / `would repair the stale ... pin` / `would refresh ...`，一律不落盘。
- **区分"没有副本"的两种原因**：`dependencies` 为空且 `$DSH_HOME/profiles/node_modules/<name>` 存在 → 打印"bundle-only，经共享回退解析，无需刷新"；其余情况才提示"跑 pnpm install"。
- 统计行改成 `N of M installed profile copy/copies refreshed`，分母只数**真正拥有副本**的 profile，健康的一轮不再显示成 `1 of 2`。

## Alternatives considered

1. **保留"先删后装"，只在失败时重装一次。** 不采用：失败原因（陈旧 pin）不会因为重试而改变，重试只会再删一次；而且"删掉后有没有恢复"仍取决于第二次安装，风险叠加。
2. **失败时用备份恢复，但不检测陈旧 pin。** 不采用：这样只是把"插件消失"降级成"刷新永远失败 + 每次都白删一次"，用户仍要自己去读 pnpm 的 ENOENT 才能知道为什么（而旧实现连 ENOENT 都不打印）。
3. **自动删掉整份 profile `pnpm-lock.yaml` 让 pnpm 重新解析。** 不采用：会把该 profile 的其它依赖（如 `dsh-context`、`dsh-history-tree`）一起按 semver 重新解析到更新版本，为了修一个包而改变别人的依赖图；实测删除 lockfile 确实能修复（pin 被重算成正确路径），所以把它作为"最后手段"留给使用者，而不是脚本的默认行为。
4. **让 profile 改走共享回退（删掉 `file:` 依赖，靠 `$DSH_HOME/profiles/node_modules` 的链接解析）。** 不采用：那会改变使用者 profile 的依赖声明，且在回退链接不存在时直接失去插件；本插件刻意要求"包实体位于 profile 树内"以保证 `@deepseek-ai/*` peer 解析到宿主实例（见 `2026-09-13-build-refreshes-installed-profile-copies.md` 备选 2/3）。
5. **给 `pnpm install` 加 `--fix-lockfile` 重试。** 不采用：实测对该 pin 无效（仍走旧目录），加上去只会让失败信息更绕。
6. **在 `scripts/` 下加 vitest 回归。** 不采用：该路径不在 vitest 的 `src` 收集范围内，且刷新分支必然 `spawn` pnpm（受限沙箱下是已知的 EPERM 边界，会让测试变成环境判定）。改用一次性临时 `--home` 夹具手工验证全部分支（见下）。

## Consequences

- **`pnpm install` 失败不再能让 profile 失去插件**；失败时保留旧副本，并把 pnpm 的原始报错（末 8 行）打到构建日志里。
- **仓库再次搬家时 `build` 能自愈**：脚本在删除副本前把 profile lockfile 里这一条 `file:` pin 修到 manifest 当前指向的目录，随后正常刷新。本机已按此修复 `web` profile 并装回副本（`lib/index.js` 内容哈希与仓库一致）。
- 构建输出语义变化：bundle-only 的 profile 不再出现在"declares ... but has no installed copy"里，分母只统计有副本的 profile。`AGENTS.md` 硬性规矩 1 已同步这两条边界规则。
- 新增依赖：无。脚本仍然只读写 `<profile>/node_modules/<name>`（及其 `.sync-backup` 临时名）与 `<profile>/pnpm-lock.yaml` 里该包的 pin 文本。
- 已知权衡：pin 修复依赖"2 空格缩进的 `<name>@file:<path>:` + 下一行 `resolution: {directory: ...}`"这一 lockfile v9 形状，格式变化时只是**不再触发修复**（退化为旧行为：备份/恢复 + 报错），不会误改。临时 pin 的替换是整份文件里的字面量替换，路径串足够独特，且 `--check` 可先看结果。

## 验证基线（一次性临时 `--home` 夹具 + 本机真实 profile）

- 陈旧 pin：`would repair ... (../../../GONE/dsh-llm-verifier -> ../../../../../../../Documents/ChatGPT/dsh-llm-verifier)`；实跑后 lockfile 的 `version: file:` 已变为新路径，且副本内容仍是修复前的旧副本（证明"先修 pin 再删"）。
- 安装失败：把 PATH 收窄到只剩 `C:\Windows\System32`（`pnpm` 不可用）后实跑，输出 `! ... could not refresh ... — 'pnpm' is not recognized as an internal or external command, ... (kept the previous copy)`；副本内容 `SENTINEL-OLD` 未变，无 `.sync-backup` 残留。
- manifest 指向不存在的目录（仓库已经不在那儿）：先把它改写成本仓库当前位置再刷新（夹具读数见文末追加节）；只有**改写失败**时才打印 `... which does not exist and could not be rewritten; kept the installed copy untouched` 并保留副本。
- bundle-only：有共享链接时打印 `bundle only; it resolves through <shared> (nothing to refresh)`；无共享链接时保留原有的"run pnpm install there"提示。
- 无 profile 时仍为 `no profile installs dsh-llm-verifier (nothing to refresh)` 且 `exit 0`。
- 本机真实 `DSH_HOME`：`--check` 输出 `trading` 为 bundle-only、`web` `would refresh`，`0 of 1 installed profile copy/copies refreshed`（`--check` 不落盘）。

> 相关：`.agents/notes/implemented/process/2026-09-13-build-refreshes-installed-profile-copies.md`（本脚本的引入与"必须删目录才能重建硬链接"的实测）。

## 追加：为什么"认死地址"，以及怎么让它自己变（同日第二次提交）

`file:` 目录依赖在 pnpm 里**就是一个路径**，manifest 里写不出"这个包，不管它现在在哪"。所以 profile 里的
`"dsh-llm-verifier": "file:C:/.../dsh-llm-verifier"` 一旦写死，仓库一搬就同时废掉 manifest 与 lockfile 两处。既然如此，让**本仓库的 build** 来改写它就是自然的：它是唯一同时知道"旧地址（profile 里写的）"和"新地址（自己所在的路径）"的一方。

那能不能干脆不用副本——改成 `link:`、junction，或者删掉依赖走 `$DSH_HOME/profiles/node_modules` 的共享回退？不行，代价是 peer 的模块实例。同日实测两条解析路径：

```text
从 profile 副本 web/node_modules/dsh-llm-verifier/lib/index.js 解析
  @deepseek-ai/dsh-llm   -> C:\Users\A\Documents\deepseek-harness\packages\llm\llm\lib\index.js     （宿主实例）
  @deepseek-ai/dsh-tools -> C:\Users\A\Documents\deepseek-harness\packages\core\tools\lib\index.js  （宿主实例）

从仓库真实路径 ...\ChatGPT\dsh-llm-verifier\lib\index.js 解析
  @deepseek-ai/dsh-llm   -> ...\dsh-llm-verifier\node_modules\.pnpm\@deepseek-ai+dsh-llm@0.1.1-...\...  （仓库自己那份）
  @deepseek-ai/dsh-tools -> ...\dsh-llm-verifier\node_modules\.pnpm\@deepseek-ai+dsh-tools@0.1.-...\... （仓库自己那份）
```

链接类安装（`link:` / junction）会让 Node 按 realpath 落到上面第二条：插件用的是**仓库自己的** `@deepseek-ai/*`，与宿主不是同一个模块实例，`isAgentLoopRequest` 那个模块私有 WeakSet 也就不共享。这正是本插件刻意要求"包实体在 profile 树内"的原因（见 `2026-09-13-build-refreshes-installed-profile-copies.md` 备选 2/3）——"认死地址"换来的就是这份副本。

本次追加的备选：

1. **把 specifier 写成相对路径。** 不采用：相对的是"profile → 仓库"这段布局，仓库一搬照断，只是把绝对地址换成相对地址。
2. **改用 `link:` 让 pnpm 建软链。** 不采用：见上面的实例实测，peer 会落到仓库自己那份。
3. **删掉依赖、靠宿主的共享回退。** 不采用：同样按 realpath 解析到仓库；而且回退链接是宿主启动时建/改的，profile 自己不再握有"我要哪一份"的声明。
4. **让人手工改。** 不采用：这次故障的起因正是"搬完家没人记得改"，而 build 本来每次都要跑。
5. **脚本去读 `DSH_HOME` 之外的注册表/配置来推断新地址。** 不采用：调用者自己的位置就是最权威的新地址，不需要第二个信息源。

改写范围刻意收得很窄：只动 `dependencies.<name>` 这一条字符串，以及 lockfile 里镜像它的 specifier 行与该包的 pin；不重排 JSON、不碰 profile 的其它依赖。夹具验证（临时 `--home`，manifest 指向搬家前的 `C:/Users/A/Documents/dsh-llm-verifier`，lockfile 的 specifier 与 pin 也都是旧地址）：

- `--check`：`would repoint ... at file:C:/Users/A/Documents/ChatGPT/dsh-llm-verifier` → `would repair the stale pnpm-lock.yaml pin ... (../../../Documents/dsh-llm-verifier -> ../../../../../../../Documents/ChatGPT/dsh-llm-verifier)` → `would refresh ...`。
- 实跑（PATH 里换成"什么都不做、exit 0"的 pnpm 存根，保证离线，并借"install 没建出目录"顺带触发剪枝守卫）：manifest 与 lockfile 里的旧地址全部消失、新地址两处一致、副本内容原样保留、无 `.sync-backup` 残留。
- 本机真实 `DSH_HOME`（依赖已指向正确位置，无需改写）：仍然 `refreshed ...web...` / `1 of 1 installed profile copy/copies refreshed`。
