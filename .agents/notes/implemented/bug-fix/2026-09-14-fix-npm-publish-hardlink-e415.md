# Agent Note: 修复 Windows 下 profile 硬链接与 NTFS FileId 截断导致 npm publish 报 415 硬链接错误

Status: implemented

## Problem

在 Windows 环境下运行 `npm publish --access public` 时，npm 发布失败并返回 HTTP 415 错误：

```text
npm error code E415
npm error 415 Unsupported Media Type - PUT https://registry.npmjs.org/dsh-llm-verifier - Hard link is not allowed
```

经排查，该错误由 Windows NTFS 文件系统特性、Node.js 双精度浮点数限制、pnpm 本地依赖安装机制以及 `node-tar`（npm pack 内部归档器）共同作用引发：

1. **本地 profile 依赖与硬链接**：
   本仓库配置了 `"prepublishOnly": "pnpm run verify:release"`。在构建阶段 `pnpm run build` 末尾，`scripts/sync-installed-profiles.mjs` 会检索当前系统中的 DSH profile 并对依赖该插件的 profile 运行 `pnpm install`。由于 profile 的 `package.json` 使用本地 `file:` 协议安装当前仓库（`file:C:/Users/A/Documents/dsh-llm-verifier`），pnpm 在 Windows 下默认通过**硬链接（Hard Link）**将仓库文件链接到 profile 的 `node_modules` 目录中。这使得本仓库内所有被同步文件的磁盘硬链接计数从 1 变为 2（`stat.nlink === 2`）。
2. **NTFS 64 位 FileId 溢出与哈希碰撞**：
   在 NTFS 分区中，文件系统分配给文件的 64 位索引号（FileId）高位较大（超过 $2^{53} - 1 = 9,007,199,254,740,991$）。Node.js 标准 `fs.statSync` 返回的 `stat.ino` 为 JavaScript `number`（双精度浮点数），超过安全整数范围后发生尾数舍入截断。导致仓库中完全不相干的两个不同文件（如 `lib/core.js` 与 `lib/caller.js`，或 `lib/types/replay.js` 与 `lib/types/replay.js.map`）计算出了**完全相同的 `stat.ino`**。
3. **`node-tar` 误判为硬链接**：
   在 `prepublishOnly` 完成后，npm 开始打包 tarball。`node-tar`（`tar` 包的 `write-entry.js`）检查到 `stat.nlink > 1`，并维护了一个 `${dev}:${ino}` 的 LinkCache 映射。当第二次遍历到拥有相同（碰撞后）`stat.ino` 的文件时，`node-tar` 将其判定为同一个文件的内部硬链接，并在生成的 tar 包中写入 `typeflag: '1'`（Hard Link），同时将其 Payload 大小置为 0 字节。
4. **npm Registry 拦截**：
   npm Registry 严禁发布含有硬链接的 tarball（出于安全沙箱隔离及跨平台提取规范考虑），收到该 tarball 后拒绝接收并报错 `415 Hard link is not allowed`。此外，若被错误当成硬链接发布，用户安装后该文件内容将被损坏为 0 字节或指向错误内容。

## Decision

在 `scripts/sync-installed-profiles.mjs` 中引入自动硬链接解除（Break Hardlinks）机制：

1. **实现 `breakHardlinks(target)` 纯函数**：
   递归遍历目标路径下的所有文件。凡检测到 `stat.nlink > 1` 的文件，读取原字节内容，使用 `unlinkSync` 移除其旧文件引用（从而断开与另一端的硬链接共享），再使用原权限（`stat.mode`）使用 `writeFileSync` 重新写入为独立文件。
2. **在 profile 侧安装完成后脱钩**：
   在 `execFileSync('cmd', ['/c', 'pnpm install'], { cwd: profile, stdio: 'ignore' })` 完成后，立即对 `installed` 目录执行 `breakHardlinks(installed)`。这将 profile 内部的副本转换为独立实体，同时自动使本仓库源文件的 `stat.nlink` 降回 1。
3. **仓库侧双重防御兜底（Defense-in-depth）**：
   在脚本退出前（包括没有 profile 时的快速退出分支，以及全部 profile 刷新完毕后），对仓库内将要发布的文件（`lib`、`src`、`scripts`、`package.json`、`README.md`、`LICENSE`、`cordis.patch.yml`）统一执行 `ensureRepoHasNoHardlinks()`。无论此前是因为历史遗留构建还是手动在外部执行了 `pnpm install`，均确保打包前仓库内所有文件的 `stat.nlink` 均为 1。
4. **同步规范文档**：
   在 `AGENTS.md` 硬性规矩第 1 条中补充记录该机制与 NTFS FileId 碰撞背景。

验证基线：
- `pnpm run verify:release`：typecheck、23 个测试套件（604 tests）全部通过，构建成功。
- 文件状态验证：仓库 `lib/`（109 个文件）及 profile `lib/` 的 `nlink > 1` 数量全部为 0。
- Tarball 结构验证：`npm pack` 生成的 tarball 解包扫描，`typeflag !== '0'` 的特殊条目数量为 0，`lib/core.js` 等关键文件大小恢复完整（非 0B）。
- 发布演练：`npm publish --access public --dry-run` 完整通过。

## Alternatives considered

1. **直接移除 `scripts/sync-installed-profiles.mjs`**：否决。
   AGENTS.md 硬性规矩 1 明确要求在构建后自动刷新 profile。本地 DSH profile 依赖此机制加载最新构建代码，移除会导致开发者本地调试脱节。
2. **改用 Node.js BigInt 修复 node-tar 的 `ino` 比较**：否决。
   `node-tar` 是 npm 内部引用的三方依赖（位于 npm 自身安装目录下），无法直接修改全局/宿主 npm 源码；即便向上游提交 PR，也无法解决存量开发机上的 npm 发布失败。
3. **仅在发布前手动执行脚本清理**：否决。
   开发者直接执行 `npm publish` 时会先触发 `prepublishOnly`，如果清理不在构建流程闭环内，`build` 重新生成的硬链接会在打包前再次引发故障。
4. **把 profile 的依赖改为拷贝（`cpSync`）而不是 `pnpm install`**：评估后作为备用。
   `pnpm install` 会同时处理 profile 的依赖锁文件与上下文环境。在 `pnpm install` 后打破硬链接既尊重了 pnpm 的包管理契约，又以极低成本（几毫秒）消除了硬链接副作用。

## Consequences

- 彻底解决了 Windows 环境下 `npm publish` 遇到 415 Hard link is not allowed 的问题，恢复正常发版能力。
- 打包出的 npm 包中不再有被误判为空内容的 0 字节硬链接文件，保证了包体在其他操作系统的解压与使用完整性。
- profile 内部与仓库各自保留独立文件，互不影响；解除硬链接耗时小于 10ms，对构建性能无感知影响。
