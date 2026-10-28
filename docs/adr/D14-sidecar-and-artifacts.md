# D14 侧车留在话题目录,构建产物不入库

## 背景

评分缓存、能力记忆、调用统计、决策快照与过程选优账目都需要跨进程持久化。同时,DSH 0.2.1 提供了一个实验性的 `appendPluginRecord()`。

## 决定

- 全部侧车写在当前话题的持久化目录下(`<session>/verifier/`),随话题生命周期归档与删除。
- **不**迁到 `appendPluginRecord()`:按宿主契约它只供实验性包保存可丢失状态,格式迁移只能尽力保留。
- `lib/` 是构建产物,`.gitignore` 中解除跟踪;发布时由 `prepublishOnly` 重新生成,再经 `files` 字段打进 tarball。
- 构建末尾的 `scripts/sync-installed-profiles.mjs` 不可省:它刷新已安装该插件的 profile 副本并解除硬链接,防止 Windows NTFS FileId 碰撞导致 `npm publish` 报 `415 Hard link is not allowed`。

## 后果

- 不同话题相互隔离,永久删除话题时侧车一并消失;项目工作目录里不再出现缓存目录。
- 仓库里看不到 `lib/` 是正常状态;宿主加载的那份来自发布时的重新构建。
