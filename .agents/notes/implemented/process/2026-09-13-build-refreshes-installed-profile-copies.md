# Agent Note: `build` 顺带刷新 profile 里已安装的插件副本

Status: implemented

## Problem

插件在 profile 里是**安装副本**（pnpm 对 `file:` 依赖做硬链接复制，实测 `nlink=2` 同一 inode）。而 `pnpm run build` 第一步就是 `rm -rf lib` 再重建，**全是新 inode**，于是那份副本停在旧内容上。更麻烦的是重新安装并不能修复：

- `pnpm install --dir <profile>`：inode 不变（pnpm 认为依赖没变）；
- `pnpm install --force`：inode 不变；
- `dsh plugin --profile <p> add file:...`：inode 不变；
- **只有删掉 `<profile>/node_modules/dsh-llm-verifier` 再 `pnpm install`** 才重建硬链接（实测两边重新同 inode、`nlink=2`）。

结果是：改完源码、跑过 `build`、看日志一切正常，而宿主实际加载的仍是旧代码——过程选优这类新功能会以"明明构建过了"的假象静默失效。

## Decision

把刷新并进既有的 `build`（不新增命令，按用户要求）：

- 新脚本 `scripts/sync-installed-profiles.mjs` 扫描 `$DSH_HOME/profiles/*/package.json`，凡是把本包列为 dependency 或 bundle 的 profile，就删除其 `node_modules/dsh-llm-verifier` 并就地 `pnpm install`；
- `build` 变成 `… && tsdown && node scripts/sync-installed-profiles.mjs`；
- **没有匹配 profile 时 no-op 并 `exit 0`**（CI、新克隆、别的机器），因此 `verify:release` / `prepublishOnly` 不受影响；
- 单个 profile 刷新失败只打印醒目警告、不让构建失败（构建本身已成功），并且只读写 `<profile>/node_modules/dsh-llm-verifier` 这一个目录；
- 发现有 profile 声明了本包却没有安装副本时，打印提示而不是失败（实测 `trading` profile 就是这种状态）。

验证基线（inode 实测）：build 前 repo/profile 同为 `ino=…222, nlink=2` → build 后 repo `…248`、profile 同步为 `…248, nlink=2`；安装后的插件仍解析宿主实例（`SHARED_WITH_HOST = true`）；空 `DSH_HOME` 下 `no profile installs dsh-llm-verifier (nothing to refresh)`、exit 0。

## Alternatives considered

1. **新增一条 `pnpm run dev`。** 不采用（用户明确要求不增加命令）：`build` 本身就是开发循环里的唯一构建入口，多一条命令只会多一处要记的东西。
2. **回到软链安装（改完即生效、零刷新）。** 不采用：Node 按真实路径解析，软链会让插件用到**开发仓库那份** `@deepseek-ai/dsh-llm`，与宿主不是同一模块实例——`isAgentLoopRequest` 的模块私有 WeakSet 因此不共享，过程选优静默失效（这正是最初那个 bug）。
3. **profile 里放一个 junction 指向仓库外的暂存目录。** 不采用：暂存目录不在 profile 树内，`@deepseek-ai/*`（peer）解析不到宿主实例；peer 解析依赖"包实体位于 profile 树内"这一事实。
4. **宿主进程加 `--preserve-symlinks`。** 不采用：那是 DSH 的启动参数，且会改变 harness 自身 workspace 的软链解析，风险与影响面都超出本插件。
5. **靠人工记得在 build 后跑一次安装。** 不采用：实测常规安装/强制安装/重新 add **都刷不动**，这条"记得"本身就是无效操作。

## Consequences

- `pnpm run build` 现在同时完成"重建产物"与"让宿主用上它"，改完只需重启 DSH（插件加载本身没有热重载）。
- 每次构建多约 0.5 秒，并会重写 profile 中该包目录；除此之外不触碰 profile 的任何其它内容。
- 发布链路不变：CI/新克隆没有 profile，这一步是 no-op；`lib/` 仍入库、`prepublishOnly` 仍只在锁定依赖下 typecheck + 测试 + 构建。
- 提醒：这条脚本只解决"产物 → 已安装副本"的同步；**同一个模块实例**这件事由"包安装在 profile 树内、peer 从宿主解析"保证，不要再引入软链安装。

> 更新（2026-09-15）：刷新改为「先移开、失败恢复」，并在删除任何东西之前修复仓库搬家后陈旧的 `file:` pin；只把本包列进 `dsh.profile.bundles` 的 profile 不再被报成"有声明却没安装"。见 `.agents/notes/implemented/bug-fix/2026-09-15-profile-sync-loses-install-on-failed-refresh.md`。
