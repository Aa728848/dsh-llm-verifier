# AGENTS.md

面向在本仓库工作的编码代理。人读 `README.md`，本文只放每次会话都必须遵守的规矩。

## 这是什么

`dsh-llm-verifier` 是 DeepSeek Harness 的 Cordis 插件：给主 Agent 配一个独立裁判模型，复核候选方案、任务进度与会话交付。宿主加载 `lib/`，源码在 `src/`。仓库形状见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 命令

```bash
pnpm run build           # 清 lib/ → tsc 类型 → tsdown → 刷新已安装 profile 副本
pnpm run typecheck       # 发布门禁用这份
pnpm test                # vitest run
pnpm run verify:release  # 提交前必跑
```

## 硬性规矩

1. **改 `src/` 必须 `pnpm run build`，但 `lib/` 不入库**。构建末尾的 `scripts/sync-installed-profiles.mjs` 不可省：它刷新已安装副本并解除硬链接，防 Windows NTFS FileId 碰撞导致发布报 `415 Hard link is not allowed`。
2. **提交前跑 `pnpm run verify:release`**。英文 conventional commits，版本号单独一次 `chore(release): bump ...`。
3. **一个事实只有一个归宿**。机制写在代码里；为什么这么设计写 `docs/adr/D*.md`；跨模块地图写 `docs/ARCHITECTURE.md`。代码注释只允许写"为什么这行不显然"，并在需要时引用 ADR 编号——**不要**在注释里复述文档已经说过的机制，也不要让测试去断言文档里的一句话。
4. **失败即抛出**（[D3](docs/adr/D3-fail-closed.md)）：判决解析不出必须报错，不静默给分、不静默放行。语义路由分类必须是严格 JSON，多余字段一律拒绝。
5. **证据双层限长**（[D10](docs/adr/D10-evidence-budget.md)）：新增候选或检查点来源必须经 `itemBudget()` 分摊总预算，单项与总量都不越界，截断标记计入预算。
6. **每次自动 steering 都消耗额度**（[D5](docs/adr/D5-three-budgets.md)）：无线额时只能发一次性通知，不允许活锁。
7. **宿主差异只在一个读取点收敛**（[D12](docs/adr/D12-host-seams.md)）：不要在调用点重写 `tool-result` / `snapshotEvents` / `settings.get` 的分支。
8. **缓存身份字段变更必须升 `cache.ts` 的 `version`**（[D13](docs/adr/D13-cache-identity.md)）。
9. **发给判官的一切先脱敏**，并包进确定性分隔块（[D11](docs/adr/D11-prompt-boundary.md)）。
10. **i18n 中英字典键严格一一对应**（`I18nDict = typeof zh` 编译期保障）。新增配置项必须同步：schema、`resolveConfig`、`client/model/client-fields.ts` 字段注册、中英文案、README。
11. **工具 output schema 必须覆盖所有真实返回字段**：宿主严格校验，缺失或多余字段会让整轮调用以 `INVALID_TOOL_OUTPUT` 崩溃。

## 测试

- 每个模块在 `test/<同名域>/` 有同名 `.test.ts`；用 `test/engine/engine.test.ts` 的 scripted stream 模式模拟模型调用，不写跨模块大集成测试。
- 回归测试必须断言**边界值**（上限截断的边缘、两种宿主形态、空数组），而不只是 happy path。
- 断言必须能在旧实现上失败。写着"应该被调用"却不断言调用次数或结果的，等于没测。
- 网络请求一律注入 mock `fetch` / `llm.stream`，禁止真实外网请求。
- `test/scoring/parity.test.ts` 依赖同级 `../llm-as-a-verifier` 仓库，缺失时跳过。

## 不要顺手"修"掉的地方

`docs/HOST-COMPAT.md` 第 4 节列了完整清单。最常被误改的两处：

- `snapshotEvents()` 上的 `@deprecated` **不要**换成 `SessionController.page()`：后者只放行 user/assistant 消息，工具调用与结果全都取不到，本插件没有证据可判。
- `PreToolDecision` 的 `info` / `cancel` 是有意的跨版本发射，不是冗余字段。
