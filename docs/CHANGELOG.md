# Changelog

## Unreleased

## 0.16.0 - 2026-11-04
- **[DSH 0.2.2-rc.1 / Cordis 4.1.0 / 本机 master] 对齐最新宿主候选正式线与具名子代理协议**
  - `engines.dsh` 与 8 条 DSH peer 同步追加 `|| ^0.2.2-rc.1`，`@deepseek-ai/cordis` peer 追加 `|| ^4.1.0`；开发依赖精确锁定 `0.2.2-rc.1` 与 `4.1.0`，pnpm 发布年龄豁免同步更新
  - 原生模型选择器子插槽适配 `renderNativeModelSlot()` 支持省略 `options` 的列表插槽调用（`conversation.input.model.options`），修复在最新宿主点开主裁判选择器时的空引用异常
  - 子代理委托工具统一通过 `isSubagentDelegationTool()` 识别 `subagent` 与各实例变体（`subagent_fork`、`subagent_oar`、`subagent_*`）；`wait_agent` 与 `team_task_*` 纳入记账/被动工具表，避免挤占检查点真实工作证据
  - `hasPendingSubagents()` 结合父会话 `subagent/catalog` 的 `childId -> name` 映射与结算通知主语精确核销在途子任务，避免前缀重叠名字误删或无关兄弟通知驱逐活跃子任务；`interrupt_agent` 统一兼容新版 `{ agent }` 与旧版 `{ target }` / `{ agent_id }` 且仅在未失败时核销

## 0.15.0 - 2026-11-03
- **[DSH 0.2.1-rc.4 / rc.5 / 0.2.2-alpha.2 / alpha.3] 对齐最新宿主功能线**
  - `engines.dsh` 与 8 条 DSH peer 补齐四条发布线，开发门禁精确锁定 `0.2.2-alpha.3`，Cordis 锁定 `4.0.6-alpha.2` 并扩展 peer；pnpm 发布年龄豁免同步更新
  - `verifier_best_of_n` 优先通过 `agent.model.current()` 读取当前模型，旧宿主回退到最近请求头；设置读取优先采用 Cordis 已解析的 `fiber.effectiveConfig`
  - 辅助思考按上游指南通过 `dsh-compaction-basic` 加载 `compaction` 请求用途声明，保留端点 compact 元数据；原生模型选择器补齐新版 `resolveText`，支持供应商模型角标及英文回退
  - 能力对照结论：上游 `auto-review` 是逐工具权限审批 preset，Goal Round 没有独立评估器，Plan Mode 只负责人工评审，均不能替代候选评分、过程选优、进度与终验；继续复用 Workspace Changes 作为证据源，不把实验 Auto preset 隐式加入本插件 patch

- **[设置页] 首屏与模型目录解耦**：设置读取完成后立即渲染，模型目录在后台独立加载；目录慢或失败不再阻塞其他设置项，并可在选择器内重试。
- **[设置页] 主裁判复用宿主模型选择器**：供应商、模型与推理强度合并为一个选择器，仍写回原有配置键；安装支持通用控件挂载的 `dsh-claude-style` 时通过 `model-picker` 控件 ID 使用其选择器，否则使用 DSH 原生组件，旧宿主保留旧控件降级。
- **[测试] 新增异步加载与宿主选择器适配回归**：覆盖目录延迟、失败隔离、注册捕获和外部 store 订阅。
- **[修复] 补全辅助思考设置说明**：中英帮助文案重新说明生效供应商/模型、主 Agent 推理块、默认 low 强度及不参与裁判评分，与当前逐线路 opt-in 行为一致。

## 0.14.0 - 2026-11-03
- **[`修复`] 辅助思考不再受「启用 Verifier 工具」总开关影响**
  - `IoTSettings` 删除 `enabled`:档位 `off` 是它唯一的开关,`eligible()` 与 `mode()` 都不再读插件总开关,关掉评审工具不会再让辅助思考静默失效
  - 新增插件级回归:总开关关闭、档位与生效线路就绪时仍会改写思考块(旧实现下此断言失败)
  - 面板帮助文案、README、ARCHITECTURE 与 D15 写明:两个开关互相独立,关裁判工具只关裁判工具

## 0.13.0 - 2026-11-03
- **[`变更`] 辅助思考改为「档位只管强度，生效线路决定范围」**
  - 删除 `deepseek-official` 的内建默认豁免：档位只决定压缩强度，是否生效只由 `iotThinkingTargets` 决定，列表为空则任何请求都不改写（`findIoTTarget` 成为唯一判定）
  - 辅助线路未显式配置时**跟随生效线路自身**：辅助调用使用主请求的供应商与模型，强度仍默认 `low`；全局「辅助思考模型」保留，供应商留空即跟随线路
  - 全局 `iotThinkingProvider` 默认值改为空串；「指定辅助模型但未指定供应商」（全局或逐条）由 `resolveConfig` 抛错、设置面板保存前拦截，不再静默落空
  - 设置面板：供应商下拉新增「跟随生效线路」，跟随态下模型选择禁用；档位非关闭且线路为空时给出一行提示
  - 升级行为收紧：既有"只靠默认豁免生效"的配置升级后不再改写思考块，需自行添加生效线路，不提供迁移

## 0.12.0 - 2026-11-03
- **[文档] 记录 DeepSeek 思考重写旁路（D15）**
  - 新增 ADR D15：独立可选模块、默认关闭、只作用于 `deepseek-official` 主循环、`compact` / `balanced` / `full` 三档固定强度；每块一次低投入辅助调用（不携带主会话 `sessionId`、不挂工具、60 秒超时），失败即原样回放原始流
  - 全局设置经既有设置系统持久化；已删除 `/iot` 及会话覆盖。全局辅助模型默认 `deepseek-official + 主模型 low`，`iotThinkingTargets` 支持增加其他主供应商/模型并逐条覆盖辅助供应商、模型和推理档位；指标是进程内内存态，重载即重置
  - 复用既有的唯一 `llm/stream` 钩子，顺序为重写 → 过程选优；不介入评分、门控与缓存身份（`cache.ts` 的 `version` 不变）
  - 边界如实写出：签名沿用既有回放形状、端点接受，属用户提供的端点事实，本仓库不复验线上签名；无自定义预设、不归档原始 CoT、无真实网络测试、不承诺节省缓存
  - README 补「辅助思考」、全局辅助模型与生效线路配置，ARCHITECTURE 补 `src/iot/` 模块表行与 `test/iot/` 归属、旁路数据流与两条不变量，ADR 索引补 D15；UI 不出现 IoT 字样，无版本号变更

## 0.11.1 - 2026-11-02
- **[修复] 兼容不支持 `temperature` 参数的模型路由（如 `sub2api/gpt-6-astra` 等固定采样/推理模型）**
  - `top_logprobs` 直连通道：新增 `isTemperatureUnsupportedMessage()` 精确识别上游对 `temperature` 参数的 HTTP 400/422 拒绝，当场省略 `temperature` 重发请求，不再被通用 `unsupported` 规则误判为不支持 `top_logprobs` 而错误降级通道
  - `llm.stream` 显式标签与 `best-of-N` 草稿生成通道：当模型拒绝 `temperature` 时自动省略该参数重试，并将 `temperatureUnsupported` 状态持久化至 `capabilities-v1.json`（共享 24h TTL 与判官自检 `forget()` 重置），后续调用直接省略 `temperature`
  - 过程选优（`ProcessSelector`）备选生成：流式备选生成遇到 `temperature` 拒绝时自动剥离该字段重发并在实例内记忆路由

## 0.11.0 - 2026-10-24
- **[DSH 0.2.1-rc.3 / 本机 master] 对齐宿主版本与新增会话边界**
  - `engines.dsh` 与 8 条 DSH peer 同步追加 `|| ^0.2.1-rc.3`，全部 DSH 开发依赖精确锁定至 `0.2.1-rc.3`，pnpm 发布年龄豁免同步更新；Cordis 保持 `4.0.5`
  - 审查本机 `22ddee37924`（rc.3 后 1533 个提交）：工具执行器拆包、条件工具、会话写入收紧与图标 sprite 化未移除本插件消费的接口；新增 `model/selection` 不进入裁判证据
  - 普通 fork 不再携带 `parentSession`，`isSubagentSession()` 明确以 `origin: 'subagent'` 为现行标识、仅为历史记录保留 parent 兼容读取；回归测试钉住无 parent/origin 的独立 fork 不会被误分类
  - `verify:release`、peer 检查、宿主 engines/peer 回退兼容调用与构建产物加载均通过；本机 HEAD 的 Host/Client 调用面通过独立声明镜像类型检查

## 0.10.1 - 2026-10-17
- **[DSH 0.2.1-rc.1 / 0.2.1-rc.2] 对齐宿主预发布候选线与 vendor `cordis 4.0.5`**
  - `engines.dsh` 与 8 条 `@deepseek-ai/dsh-*` peerDependencies 同步追加 `|| ^0.2.1-rc.1 || ^0.2.1-rc.2`，`@deepseek-ai/cordis` peer 追加 `|| ^4.0.5`
  - 全部 DSH 开发依赖精确锁定至 `0.2.1-rc.1`（与 `0.2.1-rc.2` 在消费的 16 个包上源码与类型逐字节一致，且已在 npm 全量就绪），`@deepseek-ai/cordis` 同步锁定至 `4.0.5`，`pnpm peers check` 全绿
  - `alpha.5 → rc.1` 宿主仅晋升包版本号；`rc.1 → rc.2` 新增 `ui-deepseek-model-label-1017` 与设置开关后的 DeepSeek Search / Fetch API（`web/web-deepseek-api`、`ui-settings-web-search`），本插件消费的 16 个宿主包源码零改动

## 0.10.0 - 2026-10-17
- **[DSH 0.2.1-alpha.5] 对齐宿主并采用新版兼容声明**
  - 新增顶层 `engines.dsh`，供 0.2.1-alpha.3+ 宿主与插件市场优先读取；8 条 `@deepseek-ai/dsh-*` peer 保留为旧宿主回退，两套范围均覆盖 `0.2.1-alpha.1`–`alpha.5` 且由回归测试强制一致
  - DSH 开发依赖精确锁定 `0.2.1-alpha.5`，避免 npm `next` 的 `0.2.1-rc.1` 被未审查地纳入类型门禁；`@deepseek-ai/cordis` 同步到 `4.0.5-alpha.2`，`pnpm peers check` 全绿
- **[修复] 子 Agent 动态在途探针改用真实执行状态**
  - 不再把 `subagents.listChildren()` 的持久目录项误读为 `kind/activity` 活动记录；改用 `AgentRegistry.list()` 按父子关系发现运行中的后代，并以 visited 集合防环
  - 旧 Job-backed 回退按宿主契约修正为 `jobs.list(agent.id)`；新版 managed activation 继续复用既有启动回执与 `subagent-settled` 日志判定，不把所有后台 Job 纳入门控
- **[新能力评估] 不为换新而替换稳定路径**
  - 话题侧车不迁到实验性的 `appendPluginRecord()`；裁判传输不改写为 `prepareCall()`；PTC 展示 `meta` 不作为模型证据；`working-directory/change` 不改变侧车归属
  - `index.test.ts` 新增清单一致性与 Agent/Job 动态探针回归

## 0.9.5 - 2026-10-15

- **[UI / 打包] 补上插件包图标**
  - 新增根目录 `icon.svg`：与侧栏徽章同一套紫→蓝→青渐变，白色护盾与对勾，48×48 viewBox 覆盖卡片 36px 与列表行 30px 两种渲染尺寸
  - `package.json` 新增 `icon` 字段并把 `icon.svg` 加入 `files`；宿主插件管理器按该字段为插件卡片、列表行与详情页渲染封面，缺省时仍回落宿主缺省图
- **[对齐上游 v0.3.0] 判官默认输出预算 32768 → 65536**
  - 上游 `llm-as-a-verifier` 自 `8db8a114`（v0.2.0）推进到 `90e8fc21`（v0.3.0），**算法零改动**（评分、锦标赛与进度模块逐文件未变），只改了接入层三处：判官模型 id 改用滚动别名端点、输出预算翻倍、以及"没有答案 logprobs"时的错误分类
  - 本插件据此把判官默认 `maxTokens` 对齐到 **65536**（`config.ts` 的 schema 默认值与 `resolveConfig` 兜底、`client-fields.ts` 的 `CONFIG_DEFAULTS` 三处同步）：`deepseek-flash` 推理开销比上一代更高，旧预算会让百分之几的比较拿不到分数
  - 评分缓存身份版本随之 **6 → 7**（`engine.ts` 的 `identity`），避免旧预算写入的评分被新默认值命中
  - `GENERATION_MAX_TOKENS`（草稿上限，16384）**不受影响**：它受"实测单份推理用量约 2 倍"与"两份草稿仍留在 24 万字符证据上限内"两个独立约束，与判官预算无关
- **[修复] 判官拿不到 logprobs 时区分"预算耗尽"与"能力不足"**
  - 此前两者都抛 `TopLogprobsUnsupportedError`，而该类型正是降级判据：命中即 `markUnsupported(provider, model)` 把路由**记进通道能力记忆**（24h）并回退到显式标签通道。因此一次"推理吃满输出预算"的配置失误，会被误记成"该模型不支持 logprobs"，让该路由在 TTL 内持续以单字母采样（A–T 每档约 5.3%）的精度出分
  - 现按响应自身的 `finish_reason` 分流：`'length'` 抛新增的 `TopLogprobsBudgetError`（**直接继承 `Error`，不是 `TopLogprobsUnsupportedError` 子类**，故不触发降级、不写能力记忆），消息带出实际预算与两条可操作建议；其余成因（含字段缺失回落 `unknown`）保持原能力探测语义与降级行为
- **[修复] 重试判据的数字边界与确定性失败排除**
  - `RETRYABLE_MESSAGE` 的 `5\d\d` 无数字边界，任何"以 5 开头的三位数字"都被读成 HTTP 5xx；判官预算升到 65536 后，`65536` 的子串 `553` 命中该规则，使这条**确定性**失败被判成可重试，在默认 `maxRetries: 3` 下白跑 4 次满额推理调用
  - 现按类型排除预算错误，并把 5xx 规则锚定到数字边界（`"HTTP 503"` 仍命中，`"65536"` 不再命中）；两条修改相互独立
- **[改进] Ground Truth Note 补强**
  - 融合上游 v0.3.0 新增的反奖励黑客指引：漂亮的总结、整齐的表格与"已完全验证"的声称在失败的运行里同样常见；缺少自认问题**不是**证据，但自认的问题**就是**证据并须据此计权；含糊其辞、表达不确定与轨迹长度均属中性；判实质与如何被检查，不判语气
- **[文档] 上游核对基准更新为 v0.3.0**
  - README 的核对基准注释由 `8db8a114`（v0.2.0）更新为 `90e8fc21`（v0.3.0），并补一段本次对齐说明；「最大输出 Token」条目补默认值与预算吃满时的行为；「自适应降级」条目区分"供应商未回传概率"与"推理吃满预算"；备选模型池示例由 `deepseek-v4-flash` 更新为滚动别名 `deepseek-flash`
- **[测试] 新增 7 条回归断言**
  - `top-logprobs.test.ts`：三种成因分流（`length` 走预算错误、`stop` 走能力探测、字段缺失回落 `unknown`）
  - `caller.test.ts`：预算错误不重试且**不污染能力记忆**、纯消息边界（引用大额数字的普通失败仍只跑一次）、`HTTP 503` 仍可重试
  - `core.test.ts`：Ground Truth Note 的金丝雀断言，防止后续被裁回旧版单句

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
