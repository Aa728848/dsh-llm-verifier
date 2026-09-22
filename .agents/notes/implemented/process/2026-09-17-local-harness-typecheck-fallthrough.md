# Agent Note: 拦截 `typecheck:local` 的静默回退，并补齐 0.1.6 的版本声明

Status: implemented

## Problem

本轮对 DSH 0.1.6 做兼容对齐时，发现仓库的两道类型检查**都没有在检查它声称检查的东西**：

1. **`pnpm run typecheck`（发版门禁）** 按 `package.json` 的 devDependencies 解析，而 `pnpm-lock.yaml` 当时把全部 `@deepseek-ai/dsh-*` 钉在 **`0.1.1-rc.2`**。这是有意的最低版本基线，本身不是缺陷，但它意味着门禁看不见 0.1.2 到 0.1.6 之间的任何变化。**该 pin 此后已在 2026-09-22 上移到 `0.1.7-alpha.1`**：客户端面的图标名在 0.1.7 整体改名，一份源码无法同时满足两套名字，锁最低基线就无法验通客户端面；决策见 `implemented/architecture/2026-09-22-dsh-0.1.7-alignment.md` 的 Alternatives 第 6 条。
2. **`pnpm run typecheck:local`** 才是为"提前探测新宿主兼容性"而存在的检查，但 `tsconfig.local.json` 的 `paths` 指向 `../deepseek-harness/<pkg>/lib/types`，而该目录在本机上**根本不存在**（本地 harness 在 `C:/Users/A/Documents/deepseek-harness`，不是仓库的兄弟目录）。

关键机制在于：**`paths` 解析失败时 TypeScript 不报错**，而是继续按常规解析，最终落到 `node_modules`。用 `--traceResolution` 逐条核对确认：

```text
# 修正路径后
Module name '@deepseek-ai/dsh-session' was successfully resolved to
  'C:/Users/A/Documents/deepseek-harness/packages/core/session/lib/types/index.d.ts'.

# 仓库现有的 tsconfig.local.json
Loading module '@deepseek-ai/dsh-session' from 'node_modules' folder ...
File '.../node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts' exists - use it as a name resolution result.
```

即 `typecheck:local` 实际退化成与 `pnpm run typecheck` 完全相同的检查。**两道门禁验的是同一个旧版本**，而整个仓库没有任何一处提示这件事发生过——命令退出码为 0，只是绿得没有意义。

同类隐患还有第二层：即使路径正确，`lib/types` 也是**构建产物**。本地 harness 源码在 2026-09-17 更新到 0.1.6-alpha.2，而其 `lib/types` 停留在 2026-09-10（0.1.5-rc.2 时代），`pnpm run typecheck:local` 同样会安静地对旧类型报绿。

附带问题：`package.json` 的 `peerDependencies` 上限当时为 `~0.1.5`，而本机全局 `dsh` CLI 与 profile bundles 已走到 `0.1.6-alpha.2`，声明与实际运行线不符（此后 0.1.7-alpha.1 已按同一写法补入）。

## Decision

1. **新增 `scripts/check-harness-types.mjs`**，并由 `typecheck:local` 前置执行。它从 `tsconfig.local.json` 的 `paths` **反推**包根（不维护第二份手写清单），对每个包根检查两件事：目录/声明文件是否存在，以及 `lib/types/index.d.ts` 的 mtime 是否早于 `<pkgRoot>/src` 下最新的源文件。任一不满足即失败，并打印重建命令。
2. **把回退机制本身写进失败信息**：错误文案明确指出"`paths` 目标不存在时 TypeScript 会静默落到 `node_modules`，于是命令验的是 npm 锁定版本"，避免后续会话把这条护栏当成纯粹的路径检查。
3. **保留 `../deepseek-harness` 作为约定路径**，不写入机器相关的绝对路径（该文件入库）。失败信息给出两条出路：把 checkout 放到该位置（目录 junction 亦可），或改映射。
4. **留应急逃生阀** `DSH_VERIFIER_SKIP_HARNESS_CHECK=1`，用于确实需要在未重建 harness 时跑一次的场景。
5. **`peerDependencies` 补齐 0.1.6 版本线**。注意 semver 细节：`^0.1.6` **不匹配** `0.1.6-alpha.2` 这类预发布版，故照既有写法显式列出 `^0.1.6-alpha.1 || ^0.1.6-alpha.2 || ~0.1.6`（0.1.7-alpha.1 后来以同一写法追加在各包末尾）。
6. **`AGENTS.md` 命令节**补充两条：护栏的存在与逃生阀、以及"客户端面因缺可选依赖可能长期停在旧产物上"这一已知限制。

## Alternatives considered

1. **在 `tsconfig.local.json` 里写死本机绝对路径**：否决。该文件入库，写死 `C:/Users/A/...` 对其他克隆与 CI 都是错误信息，且会把"路径不对"这一真实问题掩盖成"看起来能跑"。
2. **只改 `tsconfig.local.json` 指向相对路径 `../../deepseek-harness`**：否决。仓库布局是使用者本地的选择，把它编码进入库文件等于替所有使用者决定目录结构；护栏负责说清期望位置，比猜测更诚实。
3. **让护栏只告警不失败**：否决。告警会被忽略，而这里失败的代价极低（重建 harness 或设一次逃生阀），收益是把"假绿"变成"明确的分岔"。唯一会让人不适的情形是客户端面缺可选依赖时无法重建——该情形已在失败文案与 `AGENTS.md` 中单独说明。
4. **把 devDependencies 升到 0.1.6 让发版门禁直接验新宿主**：否决（当时）。锁定最低版本是有意的兼容性基线，升上去等于放弃"旧宿主仍可用"的验证；新宿主由 `typecheck:local` 负责，两者分工不同。**该取舍已在 2026-09-22 被反转**：客户端面的图标名在同一份源码里无法同时满足 0.1.6 与 0.1.7 两套拼写，锁最低基线就无法验通客户端面，于是门禁改锁 `0.1.7-alpha.1`，旧宿主的宿主面兼容改由运行时双形态读取与回归测试承担。反转理由与边界见 `implemented/architecture/2026-09-22-dsh-0.1.7-alignment.md`。
5. **让护栏校验构建产物的时间戳标记而非比对源码 mtime**：否决。harness 没有写入构建时间戳的约定，比对源码 mtime 无需上游配合，且直接对应"源码比产物新"这一真实失效条件。

## Consequences

- `typecheck:local` 从此**要么真的验本地 harness，要么明确失败**，不再存在"退出码 0 但验的是旧版本"的中间态。
- 本机 harness 不在约定路径上，因此 0.1.6 的结论是用一份**临时**配置取得的（取证后即删除，未入库）：新建一份 `extends ./tsconfig.local.json` 的配置，把 13 条 `paths` 逐条指向 `C:/Users/A/Documents/deepseek-harness` 下的实际产物（`tsconfig.local.json` 此后补上 `@deepseek-ai/dsh-client-ui-renderer/client`，共 14 条），然后 `npx tsc --noEmit -p <该配置>`。**必须用 `--traceResolution` 复核解析落点**，否则无法区分"真的读了 harness"与"又静默回退到 node_modules"——本轮第一次得出 0.1.6 结论时正是栽在后者上。复核输出为 `was successfully resolved to 'C:/Users/A/Documents/deepseek-harness/packages/core/session/lib/types/index.d.ts'`，随后 tsc 退出码 0，宿主面确实对 0.1.6-alpha.2 的类型零错误。
- 代价：本地 harness 未构建或未更新时，该命令会失败而非"通过"。这是有意的取舍，`AGENTS.md` 已说明重建步骤与逃生阀。
- 客户端面的结论仍然不完整：`client/ui-settings`、`client/ui-conversation`、`client/locale`、`api/remotes` 依赖 harness 的可选依赖（`@xterm/*`、`esbuild`、`diff`、`simple-icons` 等）才能 emit，本机缺失时这些包的 `lib/types` 停在 2026-09-02。护栏会如实报告这些条目，不会假装它们已验证。0.1.6 时曾以独立取证确认客户端面无风险：仓库客户端代码未触碰 0.1.6 改动的任何符号（`provenance` 重命名、`settings.plugin.item` 移除、`turnTail` 由 `chain` 改 `list`），只注册四个未变动的槽位。**该结论只对 0.1.6 成立**：0.1.7 确实改动了客户端面（`ctx.slots` 的声明包与整套图标名），那两处已在 `implemented/architecture/2026-09-22-dsh-0.1.7-alignment.md` 中单独处理。
- 验证基线：护栏在缺目录与源码较新两种情形下均以非零退出并给出可执行指引；`DSH_VERIFIER_SKIP_HARNESS_CHECK=1` 下退出码 0 并打印跳过说明。
