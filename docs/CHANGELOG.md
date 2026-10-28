# Changelog

## Unreleased

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
