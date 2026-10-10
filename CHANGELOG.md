# Changelog

## Unreleased

## 0.9.4 - 2026-10-10

- **[构建 / 发布] `lib/` 转为构建产物，不再入库**
  - `lib/` 加入 `.gitignore` 并解除跟踪；发布时由 `prepublishOnly`（`verify:release`）重建，再经 `files` 字段打进 tarball
  - `files` 新增 `CHANGELOG.md`，并固定 `publishConfig.access` 为 `public`
- **[自动化] 接入 GitHub Actions 自动发版工作流与发版技能**
  - `v*` tag 触发：typecheck → build → test → 从 CHANGELOG 提取 release notes → `pnpm pack` 打包 → 发布 npm 与 GitHub Release
  - 附带 CI 工作流，在 Ubuntu 与 Windows 双平台验证
- **[修复] 发版工作流的三处失败点**
  - 锁定 pnpm 11：pnpm 9 无法解析 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，会把每条命令都误报成 `packages field missing or empty`
  - 移除会在任何测试运行前就失败的 pnpm 缓存步骤
  - `pnpm pack` 的完整清单曾被整体写入 `$GITHUB_OUTPUT`，导致 Release 收到多行 blob；现只取 `.tgz` 那一行，并在 `NPM_TOKEN` 缺失时直接给出补救提示，而非只抛裸 `ENEEDAUTH`
- **[测试] 两处断言改为平台无关表达**：缓存路径断言与 topic-storage fixture 改用平台辅助函数构造，不再依赖 POSIX 形式路径
- **[杂项] 清理失效的 `.claude/skills` 指针与临时截图**，`AGENTS.md` 硬性规矩 1 同步更正为「`lib/` 不入库」

## 0.9.3 - 2026-10-05

- **[UI / Client] 新增 LLM Verifier Web 界面组件与源码映射**
