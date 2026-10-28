# Agent Note: 设置保存走 replace，「恢复默认」才真正生效

Status: implemented

## Problem

快速配置预设上线后用户实测：调用策略原本是 `strict`，点「默认平衡」（= 插件默认 `smart`）后按「保存设置」，页面却仍然是 `strict`，快速配置框随即显示「自定义（与预设不一致）」。行内的「恢复默认」、清空裁判标签 / 推理强度 / 缓存目录同样无效。

根因不在预设，而在**写入语义**：

- 本插件的客户端一直用 `remote.settings.update(ns, patch, revision)` 保存；控制器把它映射到 `settings.update`，其定义是 **merge**——"Merge a partial patch into this namespace's user layer"（`packages/settings/settings/src/index.ts:129`）。**patch 里没有的键会保留已存值**。
- 而 `client-i18n.ts` 的 `sectionForSave` 是按**整层替换**的语义写的：草稿值"只是重复组合 base"的键会被 `delete` 掉，本意是"re-inherit base，让将来的默认值改动仍然能到达本安装"。在 merge 下，删掉键 = 不写这个键 = 旧覆盖原样留下，于是"回到默认值"这个动作**没有任何写入发生**。

实测取证（用户机器上的 `~/.dsh/settings.yaml`）：`llm-verifier` 段落里同时留着 `autoVerifyMode: strict` 与 `autoRouteMaxPerTask: 1`。这两键在"默认平衡"草稿里分别等于 base（smart / 2），按替换语义应当消失；它们仍在文件里，证明写入是合并而非替换。

这是**旧实现的潜伏缺陷**：改动之前用户也没有一种方便的方式把一组字段退回默认值，所以没人踩到；预设把"退回默认"变成主路径，缺陷立刻暴露。

## Decision

1. `sectionForSave` 增加 `options.reInheritBase`（默认 `true`，即原行为）：只有调用方会写整层时才丢弃"等于 base"的键。
2. 客户端保存优先使用 `remote.settings.replace`（控制器 `packages/api/settings-controller/src/index.ts:160` 的 `@Remote replace`，服务侧 `packages/settings/settings/src/index.ts:135`："Replace this namespace's user section wholesale; absent keys re-inherit the composition base"），并按 `reInheritBase: true` 构造 section。
3. 宿主没有暴露 `replace` 时（老版本兼容）退回 `update`，改传 `{reInheritBase: false}`：**把每个草稿值都写死**，用"显式写回默认值"换掉"省略键"。
4. 两种模式都继续带 `loaded.settings.revision`：整层替换会覆盖读到之后别人写入的键，只有版本校验能挡住并发写入。
5. `VerifierRemote.settings` 上把 `replace` 声明为可选方法，并在注释里写清两个模式的差别。

回归测试（`client.test.ts` 的 "settings save layer"）：同一组 `stored/draft/base` 在两种模式下都必须让解析结果等于草稿——replace 模式下断言 section 里没有该键、合并 base 后得到 `smart`；update 模式下断言该键被写死为 `smart`、合并进已存层后仍然是 `smart`。

## Alternatives considered

- **一律把草稿全部写死（去掉 pruning）**：能修好回退，但会让"一次保存 = 把所有字段钉死"，此后插件默认值再改也到不了这个安装了——正是 `sectionForSave` 文档里那段"预算曾经 48/160 → 64/240 → 96/240"的历史要避免的事。改为只在**只能合并**的宿主上退让到这个行为。
- **用 `settings.mutate` 发 `unset` 路径操作**：语义上最精准（只删要删的键），但那是第三个远程方法，同样需要老宿主兼容分支，而且要为"哪些键该删"再造一份清单；`replace` 已经由服务端把"缺失即继承"定义好了。
- **发 `{key: undefined}` 表示删除**：`update` 的入参约定是 "JSON-compatible data only"，`undefined` 在传输里会直接消失，等价于没写；旧代码注释里"undefined means clear"的假设只在整层替换下成立。
- **把 base 的值显式写回**：那就是"写死"，与 merge 回退分支等价，但会在**所有**宿主上（包括暴露 replace 的）永久钉死字段，代价同上。
- **靠"重新载入"让用户自己发现"：不行——保存成功、页面显示"设置已保存"，却悄悄什么都没改，这是最坏的一种失败（用户以为已经生效）。

## Consequences

- 「默认平衡」、行内「恢复默认」、清空可选项在暴露 `replace` 的宿主上真正生效；本机验证时 `settings.yaml` 里过期的 `autoVerifyMode: strict` 会在下一次保存时消失。
- 只有 `update` 的老宿主上，行为变成"保存时把每个草稿值写死"：用户可以退回默认值（显式写回），但此后再改插件默认值不会自动到达该安装。这是刻意的降级，已在 `AGENTS.md` 的「宿主契约速查」与「已知的有意设计」两处记录。
- `replace` 会重写整个用户层：本插件命名空间没有 `role('secret')` 字段，因此 `describe({redactSecrets:true})` 读回的脱敏占位符不会被写回去；若将来给这个命名空间加了密钥字段，就必须改用 `mutate` 或在保存前剔除这些键（已在注释里注明）。
- 保存路径仍然只用 `loaded.settings.user` + 草稿构造下一层，未被本表单接管的键照旧保留（测试覆盖）。
- 验证基线：`pnpm run typecheck` 通过；保存层契约用等价的 Node 断言脚本逐条跑过（prune / pin / 两种模式的解析结果 / 未知键保留），同一组断言已写入 `src/client.test.ts`。vitest 仍受沙箱 `spawn EPERM` 限制未能在本会话内执行。
