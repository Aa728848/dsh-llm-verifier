# 贡献

## 命令

```bash
pnpm install
pnpm run build           # 清 lib/ → tsc 出类型 → tsdown 打包 → 刷新已安装 profile 副本
pnpm run typecheck       # 按 package.json 锁定的 @deepseek-ai/dsh-* 检查（发布门禁用这份）
pnpm run typecheck:local # 按 ../deepseek-harness 的实际类型检查
pnpm test                # 全量单测
npx vitest run test/routing/router.test.ts   # 单个文件
pnpm run verify:release  # check:layout + typecheck + test + build，提交前必跑
node scripts/eval-replay.mjs                 # 离线回放，无模型调用，需先 build
```

`pnpm run typecheck` 与 `typecheck:local` 结论可能不同，**一律以 package.json 锁定的 npm 版本为准**。

## 布局

```
src/<域>/            生产代码，一个域一个目录，目录内单一扩展名
test/<域>/           同名单测，扩展名一律 .test.ts
docs/<主题>.md       长文档；docs/adr/ 一条决策一页
scripts/*.mjs        构建、门禁、回放、发版
lib/                 构建产物，不入库
```

新增模块时，在 `test/<同名域>/` 放同名测试。跨域引用直接写相对路径。

## 提交

英文 conventional commits：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。

版本号是**单独一次** `chore(release): bump ...`，不与功能混在同一次提交里。

## 发布

1. **审计提交并定版本**：`git describe --tags --abbrev=0`，再 `git log <tag>..HEAD --oneline`；按改动性质决定 SemVer。
2. **一条命令发版**：`pnpm run release <version>`。脚本更新 `package.json` 与 `docs/CHANGELOG.md`、跑 `verify:release`、预览 `pnpm pack`，最后提交并打 `v<version>` tag。
3. **推送触发 CI**：`git push origin main --tags`。`.github/workflows/release.yml` 从 `docs/CHANGELOG.md` 取 notes，发布 npm 与 GitHub Release。
4. **手动兜底**：`npm whoami` 后 `pnpm publish --access public --no-git-checks`；`prepublishOnly` 会再跑一次 `verify:release`。
5. **预发布**：npm 11+ 必须显式传 `--tag <dist-tag>`；CI 会从 `v<version>-<tag>` 自动识别。

`lib/` 永远不入库；`files` 决定 tarball 内容，改 README 的文档链接时同步检查 `pnpm pack --dry-run`。CHANGELOG 条目在 `docs/CHANGELOG.md`，格式是 `## <版本> - <日期>` 加分类小节。
