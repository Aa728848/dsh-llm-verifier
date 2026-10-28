# 贡献

## 命令

```bash
pnpm install
pnpm run build           # 清 lib/ → tsc 出类型 → tsdown 打包 → 刷新已安装 profile 副本
pnpm run typecheck       # 按 package.json 锁定的 @deepseek-ai/dsh-* 检查（发布门禁用这份）
pnpm run typecheck:local # 按 ../deepseek-harness 的实际类型检查
pnpm test                # 全量单测
npx vitest run test/routing/router.test.ts   # 单个文件
pnpm run verify:release  # typecheck + test + build，提交前必跑
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

版本号是**单独一次** `chore: bump ...`，不与功能混在同一次提交里。

## 发布

`v*` tag 触发 `.github/workflows/release.yml`：typecheck → build → test → 从 CHANGELOG 取 notes → `pnpm pack` → 发布 npm 与 GitHub Release。

手动发布时 `pnpm publish` 会先跑 `prepublishOnly`（即 `verify:release`），确保产物来自 npm 依赖而不是本地 checkout 的类型。

CHANGELOG 的条目在 `docs/CHANGELOG.md`，格式是 `## <版本> - <日期>` 加分类小节，发版工作流按标题提取。
