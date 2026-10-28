# Agent Note: 判官费用的自动定价与缓存读取单价

Status: implemented

## Problem

统计看板与每次调用的 `estimatedCostUsd` 只认两个手填字段（`estimatedInputUsdPerMillion` / `estimatedOutputUsdPerMillion`），默认 0；不填就永远是 0，填了就永远是那个数。使用者提出的问题是直接的：**「要我自己输入成本价格不合适」**。

根因不在插件而在宿主边界：`@deepseek-ai/dsh-llm` 的 usage 类型与 `llm.resolveModel()` 只有 token 与上下文容量，**没有任何价格字段**；`llm-pi-ai` 更是明确把 pi-ai 自带的 cost 元数据归零（`catalog.ts` 注释原文：'The harness never reads pi-ai cost metadata … no consumer reports spend'，`replay.ts` 把 `cost` 写成全 0）。插件问不到价格，只能自己找价格源。

同时暴露了第二个缺陷：旧公式 `(inputTokens + cachedInputTokens) × 输入价 + outputTokens × 输出价` 把**缓存读取按输入价全额计费**。真机记录里 `cachedInputTokens`（134912）远大于 `inputTokens`（2374），而 cache-read 单价通常是输入价的 1/50，因此只要填了单价，费用就会被显著高估。

## Decision

新增 `src/pricing.ts`，把「一次调用花了多少钱」拆成**四层来源 + 三档单价**：

1. **手填单价**（最高优先）：只要 `input > 0 || output > 0` 就整组以手工为准；`estimatedCachedInputUsdPerMillion` 为 0 时缓存读退回输入价，保持旧口径而不是凭空造折扣。
2. **本机 pi-ai 模型目录**（默认开，离线）：读 `@earendil-works/pi-ai/dist/providers/data/*.json`（models.dev 快照，本机 1352 条定价模型），按 `provider + model` 精确命中。
3. **models.dev 在线快照**（默认开，仅在目录 miss 时）：一次 `GET https://models.dev/api.json`，进程内缓存 24 小时并单飞合并并发请求。
4. **未定价**（`source: 'none'`）：单价全 0，绝不猜。

配套的工程量：

- `TokenPrices { input, output, cachedInput, source }` + `costUsd()`；`engine.ts` 的 `finishStats` 与 `index.ts` 里四处在用的内联公式（草稿生成、路由分类、过程选优周期）全部改走同一个函数。`VerifierEngine` 的 `prices` 参数新增可选的 `cachedInput`，**缺省退回 `input`**，所以旧调用点的行为逐位不变。
- **目录定位走文件系统向上游走**，不走模块解析：pi-ai 的 `exports` 不暴露任何子路径，`require.resolve('@earendil-works/pi-ai')` 直接抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`（实测），连它自己的 `package.json` 也取不到。因此从本模块所在目录逐级向上找 `node_modules/@earendil-works/pi-ai/dist/providers/data`，再退回 `$DSH_HOME/profiles/*/node_modules`（插件直接从 checkout 加载时的情形），`DSH_VERIFIER_PI_AI_DATA` 可覆盖。
- **绝不跨 provider 猜价**：同一个 model id 在 models.dev 上有 21 家 provider 挂牌、价差 6.5 倍（nano-gpt 0.10/0.40 ↔ nano-gpt TEE 0.65/1.45）。未定价的转售路由要靠显式的 `priceProviderOverride`（例如 `openrouter`）说明「跟随谁的挂牌价」，留空则老老实实记为未定价。
- 设置页新增四个字段（`estimatedCachedInputUsdPerMillion`、`autoPriceFromCatalog`、`autoPriceOnline`、`priceProviderOverride`），schema、`resolveConfig`、`client-fields.ts` 的 `FIELDS`/`CONFIG_DEFAULTS`、两份 i18n 字典、README 表格同步更新（仓库规矩 10）。
- **判官自检**（`{kind:'probe'}`）现在回显每个判官实际生效的 `prices { input, output, cachedInput, source }`：这是「我的判官到底按什么价在算、为什么」唯一可见的地方。
- `verifier_best_of_n` 的草稿改用**会话模型自己的单价**（原来借用判官那张表），因为草稿 token 是会话模型花的钱。

## Alternatives considered

1. **只手填、把默认值改成某个常见价目**：等于按模型名预设价格，必然随模型/转售商变化而腐烂，且违背仓库既有的「不按厂商或模型名预设」纪律。否决。
2. **只做本机目录、不做在线**：本机目录里没有 `deepseek-v4.1-flash`（只有 `v4-flash` / `v4-pro`），也没有 `command-code` 这家 provider，使用者的抱怨无法解决。否决（保留为默认路径）。
3. **按 model id 跨 provider 取价（或取中位数/最低价）**：21 家挂牌、6.5 倍价差，无论取哪个统计量都是把编造的数字写进成本列，而成本列恰恰是用来判断「这笔钱花得值不值」的。否决。
4. **要求上游把价格暴露给插件**（`llm.resolveModel` 增加 cost，或 llm-pi-ai 把 catalog 的 cost 透出）：这是最干净的解，但属于 DSH 上游变更，本地不可行；且已在 `catalog.ts` 的注释里看到上游**有意**不报告花销，故本轮不依赖它。记为后续可能。
5. **把 `priceSource` 写进统计行**：信息更完整，但要同时改 `statistics.ts` 的清洗白名单、看板渲染、工具输出 schema（新增输出字段必须同步 schema 与回归测试），收益不抵本轮风险；改为在判官自检里回显，定位更直接。
6. **每次调用都查在线价（不缓存）**：4.6 MB 快照，代价不可接受；单飞 + 24 小时 TTL 后仍能跟上价格变化。否决。
7. **把缓存读取与输入合并成一个字段**：无法表达 1/50 的折扣，正是本次要修的高估根因。否决。

## Consequences

- **收益**：catalog 内的 provider 零配置自动定价。真机核对（本机 profile 布局）：目录 1352 条定价模型，`deepseek/deepseek-v4-flash` → 0.14/0.28/0.0028，`kimi-coding/k3` → 3/15/0.3，全部无需任何配置；缓存读取按真实单价计费，缓存密集的调用不再被高估。
- **已知边界**：使用者在用的 `command-code/deepseek/deepseek-v4.1-flash` 两张表里都没有（模型 id 在 models.dev 上存在，但 commandcode 不在那 217 家 provider 里），因此仍是 `none`。要用自动价就得把 `priceProviderOverride` 指向 `openrouter`（models.dev 上该条为 0.15/0.60/0.003）。这是**有意为之**：宁可显示未定价，也不写一个看起来权威的错数。
- **对 pi-ai 目录布局的依赖**：上游若改动 `dist/providers/data` 的布局，自动定价会静默退回 `none`（并继续尝试在线），**不会**影响任何判定或让调用失败。
- **默认联网**：每个 host 进程首次遇到 catalog miss 会取一次 4.6 MB 的 models.dev 快照（24 小时缓存）；不需要可在设置页关掉 `autoPriceOnline`。手填或目录命中时完全不联网。
- **多裁判仍只有一条成本行**，按主裁判的单价折算，与旧的单表口径一致（引擎每条调用只报一个成本数字，拆分需要改 `RunStats` 与工具输出 schema）。
- **验证基线**：`pnpm run typecheck` 通过；`pnpm run build` 通过（`lib/` 已重建）；受限沙箱下 `vitest` 依旧因 esbuild 的 piped stdio `spawn EPERM` 无法运行（AGENTS.md 已登记的沙箱边界），因此另用 node 直跑 `lib/` 的运行时断言与真机目录端到端核对：7 项断言（缓存单价、手填优先、目录命中、在线仅在开启且经显式 override 时命中、失败降级为未定价、引擎成本公式与旧口径的差异、目录可定位）+ 真机目录 1352 条与两个 provider 的实际单价。`pnpm test` 需在非受限环境补跑。
