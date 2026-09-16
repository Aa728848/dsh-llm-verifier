import { useEffect, useState } from 'react'

export const zh = {
  // Settings Page
  'settings.title': 'LLM Verifier',
  'settings.intro': '选择已在 DSH「模型」中配置的模型作为独立裁判。修改后点击页面底部的保存按钮生效。',
  'settings.loading': '正在读取 DSH 模型和设置…',
  'settings.retry': '重试',
  'settings.nsUnregistered': '未注册 Verifier 设置命名空间，请重启 DSH 宿主。',

  // Section: Tools
  'section.tools': '工具',
  'field.enabled.title': '启用 Verifier 工具',
  'field.enabled.helpOn': '允许 Agent 调用 Verifier 评审工具并向裁判模型发起请求。',
  'field.enabled.helpOff': '停用后，所有 Verifier 工具均不可用并立即报错。',
  'field.enabled.warnDisabled': 'verifier_compare、verifier_select、verifier_track、verifier_best_of_n 和 verifier_current_session 当前不可用。',

  // Section: Automatic Verification
  'section.autoVerify': '自动验收',
  'field.autoVerifyMode.title': '调用策略',
  'field.autoVerifyMode.help': '手动：仅供主动调用；智能（推荐）：发现明确证据时自动复核与验收；严格：关键操作后强制全面复核与验收。',
  'field.autoVerifyMode.manual': '手动',
  'field.autoVerifyMode.smart': '智能（推荐）',
  'field.autoVerifyMode.strict': '严格',
  'field.criteriaPreset.title': '验收判据',
  'field.criteriaPreset.help': '自动复核与最终验收使用的评分标准预设。不同预设针对不同的工作任务场景。',
  'field.criteriaPreset.coding': '编码（默认）',
  'field.criteriaPreset.debug': '调试排错',
  'field.criteriaPreset.research': '研究问答',
  'field.criteriaPreset.ops': '运维操作',
  'field.criteriaPreset.writing': '文档写作',
  'field.criteriaPreset.custom': '自定义文件',
  'field.criteriaPreset.previewSummary': '预览判官提示词（{count} 条判据中的第 1 条）',
  'field.criteriaPreset.sampleTask': '（示例任务）修复登录接口返回 500 的问题。',
  'field.criteriaPreset.sampleA': '（示例轨迹 A）运行 pytest -k login，输出 1 failed … 修改 auth.py … 再次运行，输出 1 passed。',
  'field.criteriaPreset.sampleB': '（示例轨迹 B）已经改好了，应该没问题。',
  'field.criteriaFile.title': '判据文件',
  'field.criteriaFile.help': '自定义 Markdown 判据文件路径。若解析失败会自动回退为默认「编码」判据；判据条数较多时建议适当调高模型调用预算。',
  'field.autoRouteSemantic.title': '混合语义路由',
  'field.autoRouteSemantic.help': '缺少显式标记时，由裁判模型智能识别上下文，自动发起方案优选或进度跟踪。',
  'field.autoRouteMinConfidence.title': '语义路由置信度',
  'field.autoRouteMinConfidence.help': '触发自动路由所需的最低语义置信度（0–1，建议保持 0.9）。低于该值不触发。',
  'field.autoRouteMaxCandidates.title': '最多候选数',
  'field.autoRouteMaxCandidates.help': '多方案优选（select）单次最多对比的候选方案数（3–16）。',
  'field.autoRouteMaxPerTask.title': '每任务最多路由',
  'field.autoRouteMaxPerTask.help': '单个任务中自动对比与进度跟踪的最大尝试次数（独立计数，不消耗最终验收额度）。',
  'field.autoRouteMaxPerSession.title': '每会话最多路由',
  'field.autoRouteMaxPerSession.help': '整个会话中自动路由的最大尝试总次数。',
  'field.autoTrackCompletionThreshold.title': '进度完成阈值',
  'field.autoTrackCompletionThreshold.help': '进度检查点达标阈值（0–1）。最新进度低于此值时，将提示 Agent 尚未完成并继续执行。',
  'field.autoRouteMaxItemChars.title': '单项证据字符上限',
  'field.autoRouteMaxItemChars.help': '单次路由中单个候选方案或执行步骤脱敏后的最大字符数。',
  'field.autoRouteMaxInputChars.title': '路由证据总字符上限',
  'field.autoRouteMaxInputChars.help': '单次路由对比中所有候选证据的脱敏字符总上限。',
  'field.autoMaxModelCallsPerTask.title': '每任务模型调用预算',
  'field.autoMaxModelCallsPerTask.help': '单任务内所有自动评审阶段（路由、对比、最终验收）共享的模型调用上限。',
  'field.autoMaxModelCallsPerSession.title': '每会话模型调用预算',
  'field.autoMaxModelCallsPerSession.help': '整个会话内所有自动评审累计允许的最大模型调用总次数。',
  'field.autoVerifyThreshold.title': '通过阈值',
  'field.autoVerifyThreshold.help': '任务通过最终验收所需的最低得分（0–1）。得分未达标时会要求 Agent 继续修复。',
  'field.autoVerifyRepeats.title': '路由评估轮次',
  'field.autoVerifyRepeats.help': '自动方案对比每项判据的评分轮数（默认 1，增加可提高稳定性）。',
  'field.autoTrackRepeats.title': '进度跟踪轮次',
  'field.autoTrackRepeats.help': '进度跟踪的评分采样轮数（默认 3）。多次采样取平均可有效抑制单次随机误差。',
  'field.autoVerifyFinalRepeats.title': '最终验收轮次',
  'field.autoVerifyFinalRepeats.help': '最终验收每项判据的评分轮数（默认 2）。偶数轮会自动交换 A/B 位置以消除位置偏好。',
  'field.autoVerifyMinToolCalls.title': '智能模式最少工具调用',
  'field.autoVerifyMinToolCalls.help': '触发智能验收所需的最少非 Verifier 工具调用数（需包含实际操作与成功结果）。',
  'field.autoVerifyMaxChars.title': '最大证据字符',
  'field.autoVerifyMaxChars.help': '最终验收时截取并发送给裁判的最近会话轨迹字符上限。',
  'field.autoVerifyMaxPerTask.title': '每任务最多验收',
  'field.autoVerifyMaxPerTask.help': '单任务最终验收的最大尝试次数（独立计数，防止低分修复陷入死循环）。',
  'field.autoVerifyMaxPerSession.title': '每会话最多验收',
  'field.autoVerifyMaxPerSession.help': '整个会话中最终验收的最大尝试总次数。',
  'field.autoVerify.warnNotice': '自动评审按「多项优选 → 两项对比 → 进度跟踪 → 最终验收」顺序进行。脱敏后的任务信息、执行轨迹与工具输出将发送给裁判模型；进度或评分不足时将提示继续完善，验收未通过将要求修复后重新验证。',
  'field.autoMaxModelCallsPerTask.warnBudget': '当前单任务预算为 {current} 次模型调用，低于 {judges} 位裁判完整锦标赛所需的最差情况（{required} 次）。建议调大该预算以避免自动路由过早耗尽。',
  'field.autoMaxModelCallsPerSession.warnBudget': '当前会话预算为 {current} 次模型调用，低于 {judges} 位裁判推荐的最差情况（{required} 次）。建议调大该预算以避免会话验证过早耗尽。',

  // Section: Judge Model
  'section.model': '裁判模型',
  'field.provider.title': '供应商',
  'field.provider.help': '裁判模型的供应商（须已在 DSH「模型」中配置）。',
  'field.model.title': '模型',
  'field.model.help': '担任独立裁判的具体模型。',
  'field.reasoningEffort.title': '推理强度',
  'field.reasoningEffort.help': '推理模型的思考强度等级（low / medium / high），留空使用默认值。',
  'field.reasoningEffort.default': '模型默认',
  'field.maxTokens.title': '最大输出 Token',
  'field.maxTokens.help': '裁判模型单次评审回复的最大 Token 上限。',
  'field.temperature.title': '裁判采样温度',
  'field.temperature.help': '裁判调用的采样温度（0–2）。较低值（如 0.2）可提高评分的一致性与稳定性。',
  'field.label.title': '裁判标签',
  'field.label.help': '在看板和统计明细中显示的自定义裁判别名，留空时使用模型名称。',
  'field.label.placeholder': '默认使用模型名称',
  'field.extraJudges.title': '附加裁判',
  'field.extraJudges.help': '最多添加 4 个不同模型组成多裁判评审团，采用中位数综合打分以消除单一模型偏好。',
  'field.extraJudges.add': '添加裁判',
  'field.extraJudges.remove': '删除',
  'field.extraJudges.labelTitle': '标签',
  'field.extraJudges.labelPlaceholder': '自定义标签（可选）',
  'field.extraJudges.providerAria': '附加裁判 #{index} 供应商',
  'field.extraJudges.modelAria': '附加裁判 #{index} 模型',
  'field.extraJudges.effortAria': '附加裁判 #{index} 推理强度',
  'field.extraJudges.labelAria': '附加裁判 #{index} 标签',
  'field.extraJudges.removeAria': '删除附加裁判 #{index}',
  'field.extraJudges.conflictPrimary': '附加裁判 #{index} 与主裁判模型重复（{id}），请选择不同模型。',
  'field.extraJudges.conflictDuplicate': '附加裁判 #{index} 与附加裁判 #{other} 重复（{id}），请选择不同模型。',

  // Section: Execution
  'section.execution': '执行',
  'field.maxConcurrency.title': '最大并发',
  'field.maxConcurrency.help': '所有 Verifier 评审请求共享的最大并发数。',
  'field.maxRetries.title': '最多重试',
  'field.maxRetries.help': '遇到限流、超时或临时网络错误时的重试次数。',
  'field.retryBaseDelayMs.title': '重试基础延迟',
  'field.retryBaseDelayMs.help': '触发网络重试时的基础退避等待时间（毫秒）。',
  'field.timeoutMs.title': '请求超时',
  'field.timeoutMs.help': '单次裁判模型调用的超时时间（毫秒）。',
  'field.cacheDir.title': '缓存相对目录',
  'field.cacheDir.help': '评分结果持久化缓存的相对存放路径（相对于话题目录）。',
  'field.cacheMaxEntries.title': '缓存条目上限',
  'field.cacheMaxEntries.help': '本地持久化评分缓存保留的最大条目数，超限时自动淘汰旧记录。',

  // Section: Cost Estimation
  'section.cost': '费用估算',
  'field.estimatedInputUsdPerMillion.title': '输入价格',
  'field.estimatedInputUsdPerMillion.help': '每百万输入 Token 的美元单价（手动指定，用于看板费用估算）。',
  'field.estimatedOutputUsdPerMillion.title': '输出价格',
  'field.estimatedOutputUsdPerMillion.help': '每百万输出 Token 的美元单价（手动指定，用于看板费用估算）。',
  'field.estimatedCachedInputUsdPerMillion.title': '缓存读取价格',
  'field.estimatedCachedInputUsdPerMillion.help': '每百万命中缓存的输入 Token 美元单价。设为 0 则按普通输入价格计算。',
  'field.autoPriceFromCatalog.title': '从本机模型目录自动定价',
  'field.autoPriceFromCatalog.help': '优先从本机模型目录自动匹配对应模型的 Token 单价；手动填写的价格优先生效。',
  'field.autoPriceOnline.title': '在线价格库兜底',
  'field.autoPriceOnline.help': '本机未收录时，通过 models.dev 在线价格库精确匹配单价并缓存 24 小时。',
  'field.priceProviderOverride.title': '价格来源 Provider',
  'field.priceProviderOverride.help': '第三方转售或聚合模型未收录时，可填写参考供应商 ID（如 openrouter）折算单价，留空记为 0。',

  // Settings Actions & Alerts
  'settings.catalogFailures': '部分模型目录读取失败',
  'settings.saved': '设置已保存。',
  'settings.reload': '重新载入',
  'settings.unsaved': '当前页面有未保存的修改：点击「保存」后才会写入设置；「重新载入」会丢弃这些修改。',
  'settings.save': '保存设置',
  'settings.saving': '保存中…',

  // Statistics Page
  'stats.pageTitle': 'Verifier 工具统计',
  'stats.updatedAt': '数据更新于 {time} · 自动记录四个验证工具的实际执行结果',
  'stats.daysUnit': '{days} 天',
  'stats.currentSession': '当前会话',
  'stats.allSessions': '全部会话',
  'stats.refresh': '刷新',
  'probe.button': '判官自检',
  'probe.running': '检测中…',
  'probe.title': '判官自检',
  'probe.note': '每个判官发一次真实调用，并强制重新探测评分通道；结果不计入统计',
  'probe.reprobed': '已重新探测',
  'probe.rubric': '生效判据：{source}（{count} 条）{file}',
  'probe.rubricFallback': '自定义判据文件不可用：{error}（本次已退回编码判据）',
  'probe.channel': '通道 {channel}',
  'probe.scores': 'A {a} · B {b}',
  'probe.latency': '{ms} ms',
  'probe.calls': '{calls} 次调用',
  'probe.failed': '失败',
  'stats.requestFailed': '统计接口请求失败',
  'stats.hostRestartHint': '请确认宿主已重启并加载最新版本的 dsh-llm-verifier。',
  'stats.loading': '正在读取工具运行统计…',
  'stats.costSummary': '{days} 天估算费用',
  'stats.callsSummary': '{invocations} 次工具调用 · {calls} 次裁判模型请求',
  'stats.successCalls': '成功调用',
  'stats.failedCalls': '失败调用',
  'stats.avgDuration': '平均耗时',
  'stats.phase.explicit': '显式调用',
  'stats.phase.compare': '两项对比',
  'stats.phase.select': '多项优选',
  'stats.phase.track': '进度跟踪',
  'stats.phase.final': '最终验收',
  'stats.phase.plan_review': '计划预审',
  'stats.phase.team_task': 'Team 任务',
  'stats.phase.semantic': '语义路由',
  'stats.outcome.passed': '通过',
  'stats.outcome.below-threshold': '未达标',
  'stats.outcome.tie': '平局',
  'stats.outcome.compared': '已比较',
  'stats.outcome.error': '异常',
  'stats.outcome.dropped-over-budget': '超预算丢弃',
  'stats.outcome.invalid-references': '引用无效',
  'stats.winner.tie': '平局',
  'stats.verdict.winner': '胜方 {winner}',
  'stats.verdict.scoreThreshold': '得分 {score}（阈值 {threshold}）',
  'stats.verdict.scoreOnly': '得分 {score}',
  'stats.verdict.checkpoints': '检查点 {scores}',
  'stats.verdict.criteria': '标准 {criteria}',

  // Metrics
  'metric.cacheHitRate': '评分缓存命中率',
  'metric.cacheHitNote': '{hits} 命中 / {total} 次评分查询（本地复用，未调用模型）',
  'metric.prefixCacheHitRate': '前缀缓存命中率',
  'metric.prefixCacheHitNote': '输入 {cached} / {input} 命中（由模型服务计费口径统计）',
  'metric.tokens': 'Token',
  'metric.tokensNote': '输入 {input} · 输出 {output}',
  'metric.avgModelCalls': '平均模型请求',
  'metric.avgModelCallsNote': '{attempts} 次尝试 · {retries} 次重试',
  'metric.scoringMode': '评分模式',
  'metric.scoringModeNote': 'Top-logprobs · 显式标签 {explicit}',

  // Chart
  'chart.title': '每日工具调用与模型请求趋势',
  'chart.ariaLabel': '每日工具调用与模型请求趋势',
  'chart.legendToolCalls': '工具调用',
  'chart.legendModelCalls': '模型请求',

  // Tool breakdown table
  'table.title': '工具运行明细',
  'table.toolCount': '{count} 类工具',
  'table.colTool': '工具',
  'table.colInvocations': '调用',
  'table.colSuccessRate': '成功率',
  'table.colAvgDuration': '平均耗时',
  'table.colModelCalls': '模型请求',
  'table.colTokens': 'Token',
  'table.colCacheHits': '缓存命中',
  'table.colEstimatedCost': '估算费用',
  'table.empty': '所选范围内还没有 Verifier 工具调用。后续执行会自动出现在这里。',

  // Recent invocations
  'recent.title': '最近调用',
  'recent.maxCount': '最多 50 条',
  'recent.empty': '暂无记录',
  'recent.decision': '决策快照',
  'recent.decisionHide': '收起快照',
  'recent.decisionLoading': '正在读取…',
  'recent.decisionMissing': '找不到这次调用的快照（可能已被淘汰或从未捕获）',
  'recent.decisionEmpty': '这次调用没有捕获到模型调用（命中缓存或已关闭捕获）',
  'recent.decisionPrompt': '提示词',
  'recent.decisionOutput': '原始回答',
  'recent.details': '查看详情',
  'recent.detailsHide': '收起详情',
  'recent.detail.criterion': '判据',
  'recent.detail.score': '分数',
  'recent.detail.threshold': '阈值',
  'recent.detail.calls': '模型调用 {calls}',
  'recent.detail.tokens': '输入 {input} · 缓存 {cached} · 输出 {output}',
  'recent.detail.scoreCache': '评分缓存 {hits} 命中 / {misses} 未命中',
  'recent.detail.prefixCache': '前缀缓存命中 {rate}',
  'recent.detail.cost': '预估成本 {cost}',
  'recent.route.badge': '路由 {stage}→{destination}',
  'recent.detail.usageIncomplete': '用量不完整',
  'recent.detail.route': '周期 {cycle} · {trigger} · {stage}→{destination} · 第 {attempt} 次',
  'recent.detail.routeReserved': '预留 {reserved} / 实评 {actual}',
  'recent.detail.routeSkip': '跳过 {reason}',
  'recent.detail.routeProcess': '交付 {replayed} · 生成 {generated} · 裁判 {judges}',
  'recent.detail.replayOriginal': '原回复',
  'recent.detail.replayCandidate': '备选',
  'recent.detail.replayNone': '未回放',
  'recent.detail.routeSameCandidate': '两份候选相同（未请裁判）',
  'recent.detail.routeAugmented': '备选已注入失败证据',
  'recent.detail.routeAlternativeModel': '备选模型 {model}',
  'recent.detail.channelFallback': '通道降级 {count}',

  // Process-selection cycle pipeline (P06): one row per request the selection actually touched
  'processCycles.title': '过程选优周期',
  'processCycles.note': '最近 {count} 个周期 · 最新在前',
  'processCycles.cycle': '周期 {cycle}',
  'processCycles.rows': '{rows} 行记录',
  'processCycles.stage.cpPurchased': '已购买 · 第 {attempt} 次 · 预留 {reserved}',
  'processCycles.stage.cpPurchasedPlain': '已购买',
  'processCycles.stage.cpNotPurchased': '未购买',
  'processCycles.stage.cpCanceled': '购买前已取消',
  'processCycles.stage.generate': '生成备选 {count}',
  'processCycles.stage.generateWithModels': '生成备选 {count} · {models}',
  'processCycles.stage.generateNone': '未生成备选',
  'processCycles.stage.augmented': '备选附带失败证据',
  'processCycles.stage.judge': '评判 {count} 次',
  'processCycles.stage.judgeSame': '候选相同 · 未评判',
  'processCycles.stage.judgeNone': '未评判',
  'processCycles.stage.replayCandidate': '回放备选',
  'processCycles.stage.replayOriginal': '回放原回复',
  'processCycles.stage.replayNone': '未到达回放',
  'processCycles.stage.canceled': '已取消',
  'processCycles.stage.skip': '跳过 {reason}',

  // Model summary
  'models.title': '模型汇总',
  'models.calls': '{calls} 请求',
  'models.tokens': '{tokens} Token',
  'models.empty': '暂无模型调用',

  // Chat chip for the automatic stages that give no other sign of life
  'activity.route.classifying': '正在识别需要独立复核的对象…',
  'activity.route.compare': '正在比较候选方案（约 {n} 次调用）…',
  'activity.route.select': '正在为多个候选排名（约 {n} 次调用）…',
  'activity.route.track': '正在复核任务进度（约 {n} 次调用）…',
  'activity.final.accepting': '正在最终验收（约 {n} 次调用）…',
  'activity.final.accepted': '最终验收通过',
  'activity.final.rejected': '最终验收未通过',

  // Process selection (P06) chat chip: the reply is being buffered, so this is the only sign of life
  'process.generating': '正在过程选优：生成 {n} 份候选…',
  'process.comparing': '正在过程选优：裁判比较 {n} 份候选…',
  'process.replaced': '过程选优完成：已改用更优的回复',
  'process.kept': '过程选优完成：保留原回复',
  'process.same': '过程选优：备选与原回复相同，未比较',
  'process.failed': '过程选优未完成：保留原回复',

  // Slot label
  'slot.statistics': '工具统计',
  'slot.globalDashboard': 'Verifier 看板',
  'global.panelTitle': 'LLM Verifier 全局监控中心',
  'global.panelIntro': '跨会话全局统计、裁判模型效能大盘与任务验收总览。',
  'guide.verifier.title': 'Verifier 统计',
  'guide.verifier.desc': '大模型复核工具调用、耗时与成本统计',
  'field.autoVerifyTeamTasks.title': '自动验收 Team 任务',
  'field.autoVerifyTeamTasks.help': '多 Agent 团队任务状态变更或标记完成时，自动触发进度跟踪与任务验收。',
  'field.autoVerifyPlanMode.title': '计划模式自动预审',
  'field.autoVerifyPlanMode.help': 'Agent 退出计划模式提交计划前，自动由裁判模型预审其可行性与潜在风险。',
  'field.autoProcessSelection.title': '过程选优（受控）',
  'field.autoProcessSelection.off': '关闭',
  'field.autoProcessSelection.help': '关闭：不介入主循环；恢复触发：任务连续两次验证运行失败时触发一次（现状）；每步选优：每个主循环请求都额外生成备选并选优，受「每任务选优周期上限」约束。',
  'field.autoProcessSelection.recovery': '恢复触发',
  'field.autoProcessSelection.every-step': '每步选优',
  'field.autoProcessSelection.everyStepWarning': '「每步选优」会为每个步骤生成 N-1 份备选并逐一评判，成本与延迟显著上升。强烈建议配置能返回 logprobs 的判官（DeepSeek 官方或兼容 logprobs 的 OpenAI 服务），否则显式标签通道的单字母抖动会被放大。',
  'field.maxProcessCyclesPerTask.title': '每任务选优周期上限',
  'field.maxProcessCyclesPerTask.help': '仅在「每步选优」档生效：单个任务最多购买多少个过程选优周期（1–32，默认 4）。该额度与路由额度、最终验收额度相互独立。',
  'field.autoProcessFailureContext.title': '备选带上失败证据',
  'field.autoProcessCandidates.title': '过程选优候选数',
  'field.autoProcessCandidates.help': '过程选优生成的候选总数（含原回复，默认 2）。设为 3 或 4 时将采用多轮对决，消耗更多调用。',
  'field.autoProcessAlternativeModel.title': '备选用另一个模型',
  'field.autoProcessAlternativeModel.help': '用于生成备选方案的模型列表，逗号分隔的 provider/model。第 i 份备选使用第 i 项，条目不足时循环取用。留空则使用当前会话模型重新采样。',
  'field.autoProcessFailureContext.help': '生成备选方案时附带前两次失败的报错日志，促使模型尝试不同的解决路径。',
  'field.captureDecisions.title': '保存决策快照',
  'field.captureDecisions.help': '将裁判调用的提示词与原始回复脱敏后保存在本话题下，用于看板中追溯评审理由。',
  'field.autoVerifySubagents.title': '同时验收子 Agent',
  'field.autoVerifySubagents.help': '是否对派生的子 Agent 会话同样执行自动复核与验收。开启后会消耗更多裁判额度。',

  // Settings page: navigation, profiles, validation
  'section.routing': '自动路由',
  'section.budgets': '预算与限额',
  'section.storage': '存储与观测',
  'settings.advancedBadge': '高级',
  'settings.expandAll': '展开全部',
  'settings.collapseAll': '收起全部',
  'settings.sectionExpand': '展开「{title}」',
  'settings.sectionCollapse': '收起「{title}」',
  'settings.jumpToIssue': '跳到第一处问题',
  'settings.invalid.summary': '有 {count} 项需要修正后才能保存',
  'settings.invalid.required': '不能为空',
  'settings.invalid.range': '取值范围 {min}–{max}',
  'settings.invalid.min': '不能小于 {min}',
  'settings.invalid.max': '不能大于 {max}',
  'settings.invalid.integer': '必须是整数',
  'settings.invalid.cacheDirRelative': '必须是话题目录内的相对路径，且不能包含 ..',
  'settings.invalid.routeBudget': '至少要能放下 {factor} 个单项证据（≥ 单项上限 × {factor}）',
  'settings.invalid.altModelList': '半角逗号分隔，每一段都必须是 provider/model',
  'settings.fieldReset': '恢复默认',
  'settings.fieldChanged': '已改',
  'settings.recommend': '按当前裁判数填入推荐值',
  'settings.profile.title': '快速配置',
  'settings.profile.hint': '一键写入一组自洽的取值；裁判模型、判据、存储与执行参数不受影响。',
  'settings.profile.custom': '自定义（与预设不一致）',
  'settings.profile.balanced': '默认平衡',
  'settings.profile.strict': '严格验收',
  'settings.profile.frugal': '省额度',
  'settings.profile.toolsOnly': '仅工具',
  'settings.summary.line': '当前：{mode} · {preset} · 阈值 {threshold} · {judges} · 最坏 {task} 次/任务、{session} 次/会话',
  'settings.summary.manual': '当前：手动模式 — 只提供工具，不做自动路由与验收。',
  'settings.summary.judges': '{count} 位裁判',
  'settings.summary.on': '已启用',
  'settings.summary.off': '已关闭',
  'settings.summary.manualShort': '手动（仅工具）',
  'settings.summary.mode': '{mode} · {preset} · 阈值 {threshold}',
  'settings.summary.routing': '语义路由{state} · 路由 {task}/{session} · 选优 {selection}',
  'settings.summary.budgets': '任务 {task} · 会话 {session}',
  'settings.summary.storage': '快照{state} · 缓存 {entries}',
  'settings.summary.execution': '并发 {concurrency} · 超时 {timeout} ms',
  'settings.unit.ms': '毫秒',
  'settings.unit.chars': '字符',
  'settings.unit.calls': '次调用',
  'settings.unit.tokens': 'Token',
}

export type I18nDict = typeof zh

export const en: I18nDict = {
  // Settings Page
  'settings.title': 'LLM Verifier',
  'settings.intro': 'Select a model configured in DSH "Models" as an independent judge. Click the Save button at the bottom of the page to apply changes.',
  'settings.loading': 'Loading DSH models and settings…',
  'settings.retry': 'Retry',
  'settings.nsUnregistered': 'Verifier settings namespace is not registered. Restart the DSH host.',

  // Section: Tools
  'section.tools': 'Tools',
  'field.enabled.title': 'Enable Verifier Tools',
  'field.enabled.helpOn': 'Allows the Agent to call Verifier tools and send review requests to the judge model.',
  'field.enabled.helpOff': 'When disabled, all Verifier tools will be unavailable and return an error.',
  'field.enabled.warnDisabled': 'verifier_compare, verifier_select, verifier_track, verifier_best_of_n, and verifier_current_session are currently unavailable.',

  // Section: Automatic Verification
  'section.autoVerify': 'Automatic Verification',
  'field.autoVerifyMode.title': 'Invocation Policy',
  'field.autoVerifyMode.help': 'Manual: explicit calls only; Smart (recommended): automatically reviews and gates when sufficient evidence is present; Strict: enforces full review and acceptance after any consequential action.',
  'field.autoVerifyMode.manual': 'Manual',
  'field.autoVerifyMode.smart': 'Smart (Recommended)',
  'field.autoVerifyMode.strict': 'Strict',
  'field.criteriaPreset.title': 'Acceptance Rubric',
  'field.criteriaPreset.help': 'Evaluation rubric preset for automatic review and final acceptance. Different presets tailor to different tasks.',
  'field.criteriaPreset.coding': 'Coding (default)',
  'field.criteriaPreset.debug': 'Debugging',
  'field.criteriaPreset.research': 'Research Q&A',
  'field.criteriaPreset.ops': 'Operations',
  'field.criteriaPreset.writing': 'Writing',
  'field.criteriaPreset.custom': 'Custom file',
  'field.criteriaPreset.previewSummary': 'Preview the judge prompt (criterion 1 of {count})',
  'field.criteriaPreset.sampleTask': '(sample task) Fix the login endpoint returning 500.',
  'field.criteriaPreset.sampleA': '(sample trajectory A) Ran pytest -k login: 1 failed … changed auth.py … ran it again: 1 passed.',
  'field.criteriaPreset.sampleB': '(sample trajectory B) Already fixed it, should be fine.',
  'field.criteriaFile.title': 'Criteria File',
  'field.criteriaFile.help': 'Path to a custom Markdown rubric file. Automatically falls back to the default "coding" rubric on failure. Increase model call budget if defining more than 3 criteria.',
  'field.autoRouteSemantic.title': 'Hybrid Semantic Routing',
  'field.autoRouteSemantic.help': 'When explicit clues are absent, the judge model analyzes context to identify targets for candidate comparison or progress tracking.',
  'field.autoRouteMinConfidence.title': 'Semantic Route Confidence',
  'field.autoRouteMinConfidence.help': 'Minimum confidence (0–1, 0.9 recommended) required for semantic routing before triggering reviews.',
  'field.autoRouteMaxCandidates.title': 'Max Candidates',
  'field.autoRouteMaxCandidates.help': 'Maximum number of candidate options evaluated in a single candidate selection (3–16).',
  'field.autoRouteMaxPerTask.title': 'Max Routes per Task',
  'field.autoRouteMaxPerTask.help': 'Maximum automatic comparison and progress tracking attempts per task (counted separately from final acceptance).',
  'field.autoRouteMaxPerSession.title': 'Max Routes per Session',
  'field.autoRouteMaxPerSession.help': 'Maximum automatic routing attempts allowed across the entire session.',
  'field.autoTrackCompletionThreshold.title': 'Progress Completion Threshold',
  'field.autoTrackCompletionThreshold.help': 'Progress checkpoint threshold (0–1). When the latest progress is below this value, the Agent is prompted to continue.',
  'field.autoRouteMaxItemChars.title': 'Max Chars per Route Item',
  'field.autoRouteMaxItemChars.help': 'Maximum sanitized characters allowed for a single candidate or step in a route review.',
  'field.autoRouteMaxInputChars.title': 'Total Route Input Chars Cap',
  'field.autoRouteMaxInputChars.help': 'Total sanitized character budget across all candidates and steps in a single route review.',
  'field.autoMaxModelCallsPerTask.title': 'Model Call Budget per Task',
  'field.autoMaxModelCallsPerTask.help': 'Maximum model calls shared across all automatic review stages (routing, comparison, final acceptance) per task.',
  'field.autoMaxModelCallsPerSession.title': 'Model Call Budget per Session',
  'field.autoMaxModelCallsPerSession.help': 'Maximum cumulative model calls allowed for all automatic reviews across the entire session.',
  'field.autoVerifyRepeats.title': 'Routing Repeats',
  'field.autoVerifyRepeats.help': 'Scoring repeats per criterion for candidate comparison (default 1, higher values increase stability).',
  'field.autoTrackRepeats.title': 'Progress Repeats',
  'field.autoTrackRepeats.help': 'Number of scoring rounds for progress tracking (default 3). Averaging multiple rounds reduces sampling noise.',
  'field.autoVerifyFinalRepeats.title': 'Final Acceptance Repeats',
  'field.autoVerifyFinalRepeats.help': 'Scoring rounds per criterion for final acceptance (default 2). Even rounds swap A/B positions to cancel position bias.',
  'field.autoVerifyThreshold.title': 'Pass Threshold',
  'field.autoVerifyThreshold.help': 'Minimum score (0–1) required to pass final acceptance. Agent will be prompted to remediate if below this score.',
  'field.autoVerifyMinToolCalls.title': 'Min Tool Calls (Smart Mode)',
  'field.autoVerifyMinToolCalls.help': 'Minimum non-Verifier tool calls required to trigger smart acceptance (must include consequential actions and success).',
  'field.autoVerifyMaxChars.title': 'Max Evidence Characters',
  'field.autoVerifyMaxChars.help': 'Maximum recent session trajectory characters retained and sent to the judge for final acceptance.',
  'field.autoVerifyMaxPerTask.title': 'Max Verifications per Task',
  'field.autoVerifyMaxPerTask.help': 'Maximum final acceptance attempts per task (counted separately to prevent infinite remediation loops).',
  'field.autoVerifyMaxPerSession.title': 'Max Verifications per Session',
  'field.autoVerifyMaxPerSession.help': 'Maximum final acceptance attempts allowed across the entire session.',
  'field.autoVerify.warnNotice': 'Automatic review follows the sequence: candidate selection → comparison → progress tracking → final acceptance. Sanitized task info, trajectories, and tool outputs are sent to the judge; insufficient progress prompts continuation, and failed acceptance requires remediation.',
  'field.autoMaxModelCallsPerTask.warnBudget': 'Current task budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s) in a full tournament. Consider increasing it to avoid premature budget exhaustion.',
  'field.autoMaxModelCallsPerSession.warnBudget': 'Current session budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s). Consider increasing it to avoid premature budget exhaustion.',

  // Section: Judge Model
  'section.model': 'Judge Model',
  'field.provider.title': 'Provider',
  'field.provider.help': 'Model provider of the judge (must be configured in DSH "Models").',
  'field.model.title': 'Model',
  'field.model.help': 'Specific model to serve as the independent judge.',
  'field.reasoningEffort.title': 'Reasoning Effort',
  'field.reasoningEffort.help': 'Reasoning effort level (low / medium / high). Leave empty to use model default.',
  'field.reasoningEffort.default': 'Model Default',
  'field.maxTokens.title': 'Max Output Tokens',
  'field.maxTokens.help': 'Maximum output tokens allowed in a single judge completion.',
  'field.temperature.title': 'Judge Sampling Temperature',
  'field.temperature.help': 'Sampling temperature for judge calls (0–2). Lower values (e.g. 0.2) improve verdict consistency and stability.',
  'field.label.title': 'Judge Label',
  'field.label.help': 'Custom display name for the judge in dashboards and records. Defaults to the model name.',
  'field.label.placeholder': 'Defaults to model name',
  'field.extraJudges.title': 'Extra Judges',
  'field.extraJudges.help': 'Add up to 4 extra judge models for an ensemble review, using median scores to mitigate individual bias.',
  'field.extraJudges.add': 'Add Judge',
  'field.extraJudges.remove': 'Remove',
  'field.extraJudges.labelTitle': 'Label',
  'field.extraJudges.labelPlaceholder': 'Custom label (optional)',
  'field.extraJudges.providerAria': 'Extra judge #{index} provider',
  'field.extraJudges.modelAria': 'Extra judge #{index} model',
  'field.extraJudges.effortAria': 'Extra judge #{index} reasoning effort',
  'field.extraJudges.labelAria': 'Extra judge #{index} label',
  'field.extraJudges.removeAria': 'Remove extra judge #{index}',
  'field.extraJudges.conflictPrimary': 'Extra judge #{index} duplicates primary judge ({id}). Please select a different model.',
  'field.extraJudges.conflictDuplicate': 'Extra judge #{index} duplicates extra judge #{other} ({id}). Please select a different model.',

  // Section: Execution
  'section.execution': 'Execution',
  'field.maxConcurrency.title': 'Max Concurrency',
  'field.maxConcurrency.help': 'Maximum concurrent requests shared across all Verifier reviews.',
  'field.maxRetries.title': 'Max Retries',
  'field.maxRetries.help': 'Maximum retry attempts on rate limits, timeouts, or transient network errors.',
  'field.retryBaseDelayMs.title': 'Retry Base Delay',
  'field.retryBaseDelayMs.help': 'Base backoff wait time (ms) before retrying network errors.',
  'field.timeoutMs.title': 'Request Timeout',
  'field.timeoutMs.help': 'Timeout duration (ms) for a single judge model request.',
  'field.cacheDir.title': 'Cache Relative Directory',
  'field.cacheDir.help': 'Relative directory path for persistent score cache (relative to topic directory).',
  'field.cacheMaxEntries.title': 'Max Cache Entries',
  'field.cacheMaxEntries.help': 'Maximum entries retained in the local persistent score cache before pruning oldest records.',

  // Section: Cost Estimation
  'section.cost': 'Cost Estimation',
  'field.estimatedInputUsdPerMillion.title': 'Input Price',
  'field.estimatedInputUsdPerMillion.help': 'USD price per million input tokens (manually specified for dashboard cost estimation).',
  'field.estimatedOutputUsdPerMillion.title': 'Output Price',
  'field.estimatedOutputUsdPerMillion.help': 'USD price per million output tokens (manually specified for dashboard cost estimation).',
  'field.estimatedCachedInputUsdPerMillion.title': 'Cached Input Price',
  'field.estimatedCachedInputUsdPerMillion.help': 'USD price per million cached prompt tokens. Set to 0 to calculate using standard input price.',
  'field.autoPriceFromCatalog.title': 'Auto Price From Catalog',
  'field.autoPriceFromCatalog.help': 'Automatically retrieves token prices from the local pi-ai model catalog. Manually entered prices take priority.',
  'field.autoPriceOnline.title': 'Online Price Lookup',
  'field.autoPriceOnline.help': 'When missing locally, queries the online models.dev database for exact price matching (cached for 24 hours).',
  'field.priceProviderOverride.title': 'Price Source Provider',
  'field.priceProviderOverride.help': 'For unlisted reseller or aggregator routes, specify a reference provider ID (e.g. openrouter) to convert pricing.',

  // Settings Actions & Alerts
  'settings.catalogFailures': 'Some model catalogs failed to load',
  'settings.saved': 'Settings saved.',
  'settings.reload': 'Reload',
  'settings.unsaved': 'This page has unsaved changes: click Save to write them; Reload discards them.',
  'settings.save': 'Save Settings',
  'settings.saving': 'Saving…',

  // Statistics Page
  'stats.pageTitle': 'Verifier Tool Statistics',
  'stats.updatedAt': 'Updated at {time} · Automatically records execution results of the 4 verifier tools',
  'stats.daysUnit': '{days} Days',
  'stats.currentSession': 'Current Session',
  'stats.allSessions': 'All Sessions',
  'stats.refresh': 'Refresh',
  'probe.button': 'Probe judges',
  'probe.running': 'Probing…',
  'probe.title': 'Judge probe',
  'probe.note': 'One real call per judge, forcing a fresh scoring-channel probe; not counted in the statistics',
  'probe.reprobed': 're-probed',
  'probe.rubric': 'Rubric in effect: {source} ({count} criteria) {file}',
  'probe.rubricFallback': 'Custom criteria file unusable: {error} (fell back to coding for this run)',
  'probe.channel': 'channel {channel}',
  'probe.scores': 'A {a} · B {b}',
  'probe.latency': '{ms} ms',
  'probe.calls': '{calls} calls',
  'probe.failed': 'Failed',
  'stats.requestFailed': 'Failed to query statistics API',
  'stats.hostRestartHint': 'Please make sure the host has restarted and loaded the latest version of dsh-llm-verifier.',
  'stats.loading': 'Loading tool execution statistics…',
  'stats.costSummary': '{days}-Day Estimated Cost',
  'stats.callsSummary': '{invocations} tool calls · {calls} judge requests',
  'stats.successCalls': 'Successful',
  'stats.failedCalls': 'Failed',
  'stats.avgDuration': 'Avg Duration',
  'stats.phase.explicit': 'Explicit',
  'stats.phase.compare': 'Compare',
  'stats.phase.select': 'Select',
  'stats.phase.track': 'Track',
  'stats.phase.final': 'Final Acceptance',
  'stats.phase.plan_review': 'Plan Review',
  'stats.phase.team_task': 'Team Task',
  'stats.phase.semantic': 'Semantic Route',
  'stats.outcome.passed': 'Passed',
  'stats.outcome.below-threshold': 'Below Threshold',
  'stats.outcome.tie': 'Tie',
  'stats.outcome.compared': 'Compared',
  'stats.outcome.error': 'Error',
  'stats.outcome.dropped-over-budget': 'Dropped (over budget)',
  'stats.outcome.invalid-references': 'Invalid references',
  'stats.winner.tie': 'Tie',
  'stats.verdict.winner': 'Winner {winner}',
  'stats.verdict.scoreThreshold': 'Score {score} (threshold {threshold})',
  'stats.verdict.scoreOnly': 'Score {score}',
  'stats.verdict.checkpoints': 'Checkpoints {scores}',
  'stats.verdict.criteria': 'Criteria {criteria}',

  // Metrics
  'metric.cacheHitRate': 'Score Cache Hit Rate',
  'metric.cacheHitNote': '{hits} hits / {total} lookups (reused locally, no model call)',
  'metric.prefixCacheHitRate': 'Prefix Cache Hit Rate',
  'metric.prefixCacheHitNote': '{cached} of {input} input tokens served from cache',
  'metric.tokens': 'Tokens',
  'metric.tokensNote': 'Input {input} · Output {output}',
  'metric.avgModelCalls': 'Avg Model Calls',
  'metric.avgModelCallsNote': '{attempts} attempts · {retries} retries',
  'metric.scoringMode': 'Scoring Mode',
  'metric.scoringModeNote': 'Top-logprobs · Explicit tags {explicit}',

  // Chart
  'chart.title': 'Daily Tool Calls & Model Requests Trend',
  'chart.ariaLabel': 'Daily tool calls and model requests trend',
  'chart.legendToolCalls': 'Tool Calls',
  'chart.legendModelCalls': 'Model Requests',

  // Tool breakdown table
  'table.title': 'Tool Breakdown',
  'table.toolCount': '{count} Tool Types',
  'table.colTool': 'Tool',
  'table.colInvocations': 'Calls',
  'table.colSuccessRate': 'Success Rate',
  'table.colAvgDuration': 'Avg Duration',
  'table.colModelCalls': 'Model Calls',
  'table.colTokens': 'Tokens',
  'table.colCacheHits': 'Cache Hits',
  'table.colEstimatedCost': 'Estimated Cost',
  'table.empty': 'No verifier tool calls found in the selected range. Subsequent executions will appear here automatically.',

  // Recent invocations
  'recent.title': 'Recent Invocations',
  'recent.maxCount': 'Max 50',
  'recent.empty': 'No records',
  'recent.decision': 'Decision snapshot',
  'recent.decisionHide': 'Hide snapshot',
  'recent.decisionLoading': 'Loading…',
  'recent.decisionMissing': 'No snapshot for this invocation (pruned, or never captured)',
  'recent.decisionEmpty': 'No model calls were captured for this invocation (cache hit, or capture disabled)',
  'recent.decisionPrompt': 'Prompt',
  'recent.decisionOutput': 'Raw answer',
  'recent.details': 'Details',
  'recent.detailsHide': 'Hide details',
  'recent.detail.criterion': 'Criterion',
  'recent.detail.score': 'Score',
  'recent.detail.threshold': 'Threshold',
  'recent.detail.calls': '{calls} model calls',
  'recent.detail.tokens': 'input {input} · cached {cached} · output {output}',
  'recent.detail.scoreCache': 'score cache {hits} hits / {misses} misses',
  'recent.detail.prefixCache': 'prefix cache {rate}',
  'recent.detail.cost': 'est. {cost}',
  'recent.route.badge': 'route {stage}→{destination}',
  'recent.detail.usageIncomplete': 'usage incomplete',
  'recent.detail.route': 'cycle {cycle} · {trigger} · {stage}→{destination} · try {attempt}',
  'recent.detail.routeReserved': 'reserved {reserved} / actual {actual}',
  'recent.detail.routeSkip': 'skip {reason}',
  'recent.detail.routeProcess': 'delivered {replayed} · generated {generated} · judges {judges}',
  'recent.detail.replayOriginal': 'original reply',
  'recent.detail.replayCandidate': 'alternative',
  'recent.detail.replayNone': 'not replayed',
  'recent.detail.routeSameCandidate': 'identical candidates (no judge called)',
  'recent.detail.routeAugmented': 'alternative generated with the failure evidence',
  'recent.detail.routeAlternativeModel': 'alternative model {model}',
  'recent.detail.channelFallback': 'channel fallbacks {count}',

  // Process-selection cycle pipeline (P06): one row per request the selection actually touched
  'processCycles.title': 'Process Selection Cycles',
  'processCycles.note': 'last {count} cycles · newest first',
  'processCycles.cycle': 'cycle {cycle}',
  'processCycles.rows': '{rows} rows',
  'processCycles.stage.cpPurchased': 'purchased · try {attempt} · reserved {reserved}',
  'processCycles.stage.cpPurchasedPlain': 'purchased',
  'processCycles.stage.cpNotPurchased': 'not purchased',
  'processCycles.stage.cpCanceled': 'canceled before purchase',
  'processCycles.stage.generate': 'generated {count} alternative(s)',
  'processCycles.stage.generateWithModels': 'generated {count} alternative(s) · {models}',
  'processCycles.stage.generateNone': 'no alternative generated',
  'processCycles.stage.augmented': 'alternative carried the failure evidence',
  'processCycles.stage.judge': 'judged {count} time(s)',
  'processCycles.stage.judgeSame': 'identical candidates · not judged',
  'processCycles.stage.judgeNone': 'not judged',
  'processCycles.stage.replayCandidate': 'replayed the alternative',
  'processCycles.stage.replayOriginal': 'replayed the original reply',
  'processCycles.stage.replayNone': 'never reached replay',
  'processCycles.stage.canceled': 'canceled',
  'processCycles.stage.skip': 'skipped {reason}',

  // Model summary
  'models.title': 'Model Summary',
  'models.calls': '{calls} Requests',
  'models.tokens': '{tokens} Tokens',
  'models.empty': 'No model calls',

  // Chat chip for the automatic stages that give no other sign of life
  'activity.route.classifying': 'Identifying what needs independent review…',
  'activity.route.compare': 'Comparing the candidate replies (about {n} calls)…',
  'activity.route.select': 'Ranking the candidate set (about {n} calls)…',
  'activity.route.track': 'Reviewing task progress (about {n} calls)…',
  'activity.final.accepting': 'Running the final acceptance (about {n} calls)…',
  'activity.final.accepted': 'Final acceptance passed',
  'activity.final.rejected': 'Final acceptance did not pass',

  // Process selection (P06) chat chip: the reply is being buffered, so this is the only sign of life
  'process.generating': 'Selecting the best reply: generating {n} candidates…',
  'process.comparing': 'Selecting the best reply: judging {n} candidates…',
  'process.replaced': 'Process selection: a better reply replaced the original',
  'process.kept': 'Process selection: the original reply was kept',
  'process.same': 'Process selection: the alternative was identical, so nothing was judged',
  'process.failed': 'Process selection did not finish: the original reply was kept',

  // Slot label
  'slot.statistics': 'Statistics',
  'slot.globalDashboard': 'Verifier Dashboard',
  'global.panelTitle': 'LLM Verifier Global Dashboard',
  'global.panelIntro': 'Cross-session statistics, judge model metrics, and task acceptance overview.',
  'guide.verifier.title': 'Verifier Stats',
  'guide.verifier.desc': 'LLM verifier tool calls, duration and cost statistics',
  'field.autoVerifyTeamTasks.title': 'Verify Team Tasks',
  'field.autoVerifyTeamTasks.help': 'Automatically routes progress tracking and acceptance when Agent Teams tasks change status or complete.',
  'field.autoVerifyPlanMode.title': 'Plan Mode Pre-verification',
  'field.autoVerifyPlanMode.help': 'Automatically pre-verifies plan feasibility and risks before exit_plan_mode submits the plan for user review.',
  'field.autoProcessSelection.title': 'Process Selection (Controlled)',
  'field.autoProcessSelection.help': 'Off (default): never touches the main loop; Recovery: fires once after two consecutive failed verification runs (the original behaviour); Every step: generates and judges alternatives on every main-loop request, bounded by the per-task cycle ceiling.',
  'field.autoProcessSelection.off': 'Off',
  'field.autoProcessSelection.recovery': 'Recovery trigger',
  'field.autoProcessSelection.every-step': 'Every step',
  'field.autoProcessSelection.everyStepWarning': '"Every step" generates N-1 alternatives and judges every one of them on each step, so cost and latency rise sharply. Configure a judge that returns logprobs (DeepSeek official, or an OpenAI-compatible logprobs service): otherwise the single-letter jitter of the explicit-tag channel is amplified.',
  'field.maxProcessCyclesPerTask.title': 'Process cycles per task',
  'field.maxProcessCyclesPerTask.help': 'Only the "Every step" arm reads this: how many process-selection cycles one task may buy (1-32, default 4). This allowance is independent of the routing quota and of the final-acceptance quota.',
  'field.autoProcessFailureContext.title': 'Give the alternative the failure evidence',
  'field.autoProcessCandidates.title': 'Process-selection candidates',
  'field.autoProcessCandidates.help': 'Total candidates generated for process selection (including original, default 2). 3 or 4 runs a tournament and uses more calls.',
  'field.autoProcessAlternativeModel.title': 'Generate the alternative with another model',
  'field.autoProcessAlternativeModel.help': 'Comma-separated list of provider/model routes used to generate the candidates. Candidate i uses entry i, wrapping around when the list is shorter. Leave empty to resample with the session model.',
  'field.autoProcessFailureContext.help': 'Attaches error logs from the two failed runs to the alternative request to encourage a different troubleshooting approach.',
  'field.captureDecisions.title': 'Keep decision snapshots',
  'field.captureDecisions.help': 'Saves sanitized prompts and raw outputs of judge calls in the topic directory for dashboard tracing.',
  'field.autoVerifySubagents.title': 'Verify Subagent Sessions',
  'field.autoVerifySubagents.help': 'Whether to also run automatic routing and acceptance on delegated child sessions. Consumes additional judge budget.',

  // Settings page: navigation, profiles, validation
  'section.routing': 'Automatic Routing',
  'section.budgets': 'Budgets & Limits',
  'section.storage': 'Storage & Observability',
  'settings.advancedBadge': 'Advanced',
  'settings.expandAll': 'Expand all',
  'settings.collapseAll': 'Collapse all',
  'settings.sectionExpand': 'Expand {title}',
  'settings.sectionCollapse': 'Collapse {title}',
  'settings.jumpToIssue': 'Jump to the first issue',
  'settings.invalid.summary': '{count} field(s) must be fixed before saving',
  'settings.invalid.required': 'Must not be empty',
  'settings.invalid.range': 'Must be between {min} and {max}',
  'settings.invalid.min': 'Must be at least {min}',
  'settings.invalid.max': 'Must be at most {max}',
  'settings.invalid.integer': 'Must be an integer',
  'settings.invalid.cacheDirRelative': 'Must be a relative path inside the topic directory, without ".."',
  'settings.invalid.routeBudget': 'Must fit at least {factor} route items (>= item limit x {factor})',
  'settings.invalid.altModelList': 'Comma-separated, and every entry must be provider/model',
  'settings.fieldReset': 'Reset',
  'settings.fieldChanged': 'Changed',
  'settings.recommend': 'Fill the recommended floor for the current judge count',
  'settings.profile.title': 'Quick configuration',
  'settings.profile.hint': 'Writes one coherent set of values; judge models, rubric, storage and execution settings are left untouched.',
  'settings.profile.custom': 'Custom (no profile matches)',
  'settings.profile.balanced': 'Balanced (default)',
  'settings.profile.strict': 'Strict acceptance',
  'settings.profile.frugal': 'Frugal',
  'settings.profile.toolsOnly': 'Tools only',
  'settings.summary.line': 'Currently: {mode} · {preset} · threshold {threshold} · {judges} · worst case {task} calls/task, {session}/session',
  'settings.summary.manual': 'Currently: manual mode — tools only, no automatic routing or acceptance.',
  'settings.summary.judges': '{count} judge(s)',
  'settings.summary.on': 'On',
  'settings.summary.off': 'Off',
  'settings.summary.manualShort': 'Manual (tools only)',
  'settings.summary.mode': '{mode} · {preset} · threshold {threshold}',
  'settings.summary.routing': 'Semantic routing {state} · routes {task}/{session} · selection {selection}',
  'settings.summary.budgets': 'Task {task} · session {session}',
  'settings.summary.storage': 'Snapshots {state} · cache {entries}',
  'settings.summary.execution': 'Concurrency {concurrency} · timeout {timeout} ms',
  'settings.unit.ms': 'ms',
  'settings.unit.chars': 'chars',
  'settings.unit.calls': 'calls',
  'settings.unit.tokens': 'tokens',
}

export const dictionaries = { zh, en }

export const toolLabels: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    verifier_route_classify: '路由分类',
    verifier_compare: '两项对比',
    verifier_select: '多项优选',
    verifier_track: '进度跟踪',
    verifier_best_of_n: '生成选优',
    verifier_current_session: '会话验收',
  },
  en: {
    verifier_route_classify: 'Route Classification',
    verifier_compare: 'Pairwise Comparison',
    verifier_select: 'Candidate Selection',
    verifier_track: 'Progress Tracking',
    verifier_best_of_n: 'Best-of-N Drafting',
    verifier_current_session: 'Session Acceptance',
  },
}

export function tFormat(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
}

/** The chat chip's wire shape (a subset of the server's `ActivityView`). */
export interface ActivityChipView {
  active?: { stage?: unknown; phase?: unknown; destination?: unknown; candidates?: unknown; expectedCalls?: unknown }
  settled?: { stage?: unknown; outcome?: unknown }
}

/** How the chip renders: a busy accent, a settled confirmation, or a failure note. */
export type ActivityTone = 'busy' | 'ok' | 'error'

/** A count that is safe to print, falling back to the given minimum for a missing/garbled value. */
function activityCount(value: unknown, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : minimum
}

/**
 * Render the chat chip, or nothing when there is nothing to say.
 *
 * Pure on purpose (no React, no locale detection): both the chip and its regression tests read the
 * same mapping. Unknown enum values degrade to the least surprising copy — a newer host describing a
 * phase or a stage this build does not know must still show that work is happening, not disappear.
 * @param view - the server's activity view, or nothing.
 * @param t - the active dictionary.
 * @returns The tone and copy, or null to render no row at all.
 */
export function verifierActivityText(
  view: ActivityChipView | null | undefined,
  t: I18nDict,
): { tone: ActivityTone; text: string } | null {
  const active = view?.active
  if (active !== undefined && active !== null) {
    if (active.stage === 'route') {
      if (active.phase !== 'reviewing') return { tone: 'busy', text: t['activity.route.classifying'] }
      const calls = activityCount(active.expectedCalls, 1)
      if (active.destination === 'select') return { tone: 'busy', text: tFormat(t['activity.route.select'], { n: calls }) }
      if (active.destination === 'track') return { tone: 'busy', text: tFormat(t['activity.route.track'], { n: calls }) }
      return { tone: 'busy', text: tFormat(t['activity.route.compare'], { n: calls }) }
    }
    if (active.stage === 'final') {
      return { tone: 'busy', text: tFormat(t['activity.final.accepting'], { n: activityCount(active.expectedCalls, 1) }) }
    }
    // Process selection: the reply is buffered, so this is the only sign of life it has.
    const candidates = activityCount(active.candidates, 2)
    return active.phase === 'comparing'
      ? { tone: 'busy', text: tFormat(t['process.comparing'], { n: candidates }) }
      : { tone: 'busy', text: tFormat(t['process.generating'], { n: candidates }) }
  }
  const settled = view?.settled
  if (settled?.stage === 'final') {
    if (settled.outcome === 'accepted') return { tone: 'ok', text: t['activity.final.accepted'] }
    if (settled.outcome === 'rejected') return { tone: 'error', text: t['activity.final.rejected'] }
    return null
  }
  switch (settled?.outcome) {
    case 'replaced': return { tone: 'ok', text: t['process.replaced'] }
    case 'kept': return { tone: 'ok', text: t['process.kept'] }
    case 'same': return { tone: 'ok', text: t['process.same'] }
    case 'failed': return { tone: 'error', text: t['process.failed'] }
    default: return null
  }
}

export function detectLanguage(): 'zh' | 'en' {
  if (typeof document === 'undefined') return 'en'
  const lang = (document.documentElement.lang || '').toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export function useLanguage(): 'zh' | 'en' {
  const [lang, setLang] = useState<'zh' | 'en'>(detectLanguage)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => { setLang(detectLanguage()) }
    update()
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'lang') {
          update()
        }
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])
  return lang
}

export function compact(value: number, lang: 'zh' | 'en' = 'en'): string {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.NumberFormat(locale, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: value >= 1_000 ? 1 : 0 }).format(value)
}

export function money(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: value < 0.01 ? 4 : 2 })
}

export function duration(value: number): string {
  if (value < 1000) return Math.round(value) + ' ms'
  if (value < 60_000) return (value / 1000).toFixed(1) + ' s'
  return (value / 60_000).toFixed(1) + ' min'
}

export function dateTime(value: number, lang: 'zh' | 'en' = 'en'): string {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)
}

export interface VerdictSummary {
  phase?: string
  outcome?: string
  score?: number
  /** Per-checkpoint progression of a `verifier_track` verdict, oldest first; absent on older records. */
  scores?: number[]
  /** Candidate B's score of a two-way comparison; `score` is the winning side. */
  scoreB?: number
  /** Per-criterion A-side scores of a session acceptance; the mean alone can hide a failed requirement. */
  criteria?: Array<{ id: string; score: number }>
  baselineScore?: number
  winner?: 'A' | 'B' | 'tie'
  threshold?: number
}

export function resolveCacheDirOnSave(
  draft: string | undefined | null,
  previous?: string | null,
): string | undefined {
  if (typeof draft === 'string' && draft.trim()) return draft.trim()
  if (typeof previous === 'string' && previous.trim()) return previous.trim()
  return undefined
}

/**
 * Deep equality for JSON-shaped settings values, insensitive to object key
 * order and treating a missing key as `undefined`. The settings page compares a
 * draft against a resolved view that was built from a different object shape,
 * so identity comparison is never enough.
 */
export function sameSettingValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!sameSettingValue(left[index], right[index])) return false
    }
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) return false
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!sameSettingValue(a[key], b[key])) return false
  }
  return true
}

export interface SectionForSaveOptions {
  /**
   * Build a complete replacement layer (default) instead of a patch to merge.
   *
   * The two host write modes are not interchangeable. `settings.replace`
   * re-inherits every key the caller leaves out, so omitting a field *undoes*
   * its override. `settings.update` merges the patch into the stored section,
   * where an omitted key simply keeps its old value — the stored
   * `autoVerifyMode: 'strict'` survived every save of a draft that read
   * 'smart', because 'smart' equalled the base and was therefore pruned.
   * A client that can only merge must pin every draft value instead.
   */
  reInheritBase?: boolean
}

/**
 * Build the user layer for one settings save.
 *
 * Keys this client does not own survive untouched and every draft field is
 * written, but a field that only repeats the base composition is *dropped*
 * rather than pinned. Pinning is what makes a shipped default change
 * unreachable: the budget fields once defaulted to 48/160, and a section that
 * stored those numbers kept overriding 64/240 and then 96/240 forever. `base`
 * is the descriptor's composition base (the resolved plugin config), so the
 * stored section keeps exactly what the user really overrode.
 *
 * An explicit `undefined` draft value means "clear this override": it deletes
 * the stored key instead of pinning a valueless one, which is how the form
 * removes a judge label, a reasoning effort or a cache directory.
 *
 * A host that reports no `base` cannot be pruned against and keeps the old
 * write-everything behavior.
 *
 * Dropping a key only clears it when the caller writes the result with
 * `replace`; see {@link SectionForSaveOptions.reInheritBase} for the merge
 * fallback (`reInheritBase: false`), which pins the draft instead.
 */
export function sectionForSave(
  user: Record<string, unknown>,
  draft: Record<string, unknown>,
  base: Record<string, unknown> | undefined,
  options: SectionForSaveOptions = {},
): Record<string, unknown> {
  const reInherit = options.reInheritBase !== false
  const section: Record<string, unknown> = { ...user }
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined || (reInherit && base !== undefined && sameSettingValue(value, base[key]))) {
      delete section[key]
      continue
    }
    section[key] = value
  }
  return section
}

/**
 * Criteria per comparison the worst-case estimate assumes.
 *
 * All five built-in presets have three, which is what keeps the historical constants below
 * unchanged. A CUSTOM rubric file can have any number, and the engine reserves budget from the
 * real count (\`rubric.criteria.length\`), so a custom file with more criteria needs a larger
 * budget than a warning built on three would suggest — pass the count in when it is known.
 */
export const WORST_CASE_CRITERIA_PER_COMPARISON = 3
/** An eight-candidate select: 18 pairs (ring + pivot rounds) x criteria, one round (the per-pair orientation removes the slot bias). */
export function worstCaseRouteCallsPerJudge(criteria = WORST_CASE_CRITERIA_PER_COMPARISON): number { return 18 * Math.max(1, criteria) }
/** Final acceptance: criteria x the default two repeats (one per A/B position). */
export function worstCaseFinalCallsPerJudge(criteria = WORST_CASE_CRITERIA_PER_COMPARISON, repeats = 2): number { return Math.max(1, criteria) * Math.max(1, repeats) }
/** @deprecated Kept at the three-criteria value; prefer {@link worstCaseRouteCallsPerJudge}. */
export const WORST_CASE_ROUTE_CALLS_PER_JUDGE = worstCaseRouteCallsPerJudge()
/** @deprecated Kept at the three-criteria value; prefer {@link worstCaseFinalCallsPerJudge}. */
export const WORST_CASE_FINAL_CALLS_PER_JUDGE = worstCaseFinalCallsPerJudge()
export const WORST_CASE_TASK_PER_JUDGE = WORST_CASE_ROUTE_CALLS_PER_JUDGE + WORST_CASE_FINAL_CALLS_PER_JUDGE
export const WORST_CASE_SESSION_PER_JUDGE = 160

export function computeJudgeCount(extraJudgesCount: number): number {
  return 1 + Math.max(0, extraJudgesCount)
}

export function computeWorstCaseBudget(judgeCount: number, criteria = WORST_CASE_CRITERIA_PER_COMPARISON): {
  worstCaseTask: number
  worstCaseSession: number
} {
  const count = Math.max(1, judgeCount)
  return {
    worstCaseTask: count * (worstCaseRouteCallsPerJudge(criteria) + worstCaseFinalCallsPerJudge(criteria)),
    worstCaseSession: count * WORST_CASE_SESSION_PER_JUDGE,
  }
}

export interface BudgetWarningState {
  judgeCount: number
  worstCaseTask: number
  worstCaseSession: number
  warnTask: boolean
  warnSession: boolean
}

export function evaluateBudgetWarning(
  autoVerifyMode: string,
  extraJudgesCount: number,
  autoMaxModelCallsPerTask: number,
  autoMaxModelCallsPerSession: number,
  criteria = WORST_CASE_CRITERIA_PER_COMPARISON,
): BudgetWarningState | null {
  if (autoVerifyMode === 'manual') return null
  const judgeCount = computeJudgeCount(extraJudgesCount)
  const { worstCaseTask, worstCaseSession } = computeWorstCaseBudget(judgeCount, criteria)
  const warnTask = autoMaxModelCallsPerTask < worstCaseTask
  const warnSession = autoMaxModelCallsPerSession < worstCaseSession
  if (!warnTask && !warnSession) return null
  return { judgeCount, worstCaseTask, worstCaseSession, warnTask, warnSession }
}

export function isVerdictFailed(verdict?: VerdictSummary | null, success: boolean = true): boolean {
  if (!success) return true
  if (!verdict) return false
  return verdict.outcome === 'below-threshold' || verdict.outcome === 'error'
}

export function formatPercentage(val: number): string {
  if (!Number.isFinite(val)) return '--'
  return `${(val * 100).toFixed(1)}%`
}

export function formatVerdictDetails(
  verdict: VerdictSummary,
  t: I18nDict,
): {
  outcomeText?: string
  phaseText?: string
  scoreText?: string
  checkpointsText?: string
  criteriaText?: string
  winnerText?: string
  isFailed: boolean
} {
  const isFailed = verdict.outcome === 'below-threshold' || verdict.outcome === 'error'
  const outcomeKey = verdict.outcome ? (`stats.outcome.${verdict.outcome}` as keyof I18nDict) : undefined
  const outcomeText = outcomeKey && t[outcomeKey] ? t[outcomeKey] : verdict.outcome

  const phaseKey = verdict.phase ? (`stats.phase.${verdict.phase}` as keyof I18nDict) : undefined
  const phaseText = phaseKey && t[phaseKey] ? t[phaseKey] : verdict.phase

  let scoreText: string | undefined
  if (typeof verdict.score === 'number') {
    const scorePct = formatPercentage(verdict.score)
    if (typeof verdict.threshold === 'number') {
      const threshPct = formatPercentage(verdict.threshold)
      scoreText = tFormat(t['stats.verdict.scoreThreshold'], { score: scorePct, threshold: threshPct })
    } else {
      scoreText = tFormat(t['stats.verdict.scoreOnly'], { score: scorePct })
    }
  }

  // One track verdict carries a whole progression; showing only the newest score
  // hides why the route decided to continue.
  let checkpointsText: string | undefined
  if (Array.isArray(verdict.scores) && verdict.scores.length > 1) {
    checkpointsText = tFormat(t['stats.verdict.checkpoints'], { scores: verdict.scores.map(formatPercentage).join(' → ') })
  }

  // The acceptance mean can hide a requirement that failed on its own, so the breakdown
  // is what tells the reader which one is holding the task back.
  let criteriaText: string | undefined
  if (Array.isArray(verdict.criteria) && verdict.criteria.length > 0) {
    criteriaText = tFormat(t['stats.verdict.criteria'], { criteria: verdict.criteria.map(criterion => criterion.id + ' ' + formatPercentage(criterion.score)).join(' · ') })
  }

  let winnerText: string | undefined
  if (verdict.winner) {
    const winnerValue = verdict.winner === 'tie' ? t['stats.winner.tie'] : verdict.winner
    winnerText = tFormat(t['stats.verdict.winner'], { winner: winnerValue })
  }

  return { outcomeText, phaseText, scoreText, checkpointsText, criteriaText, winnerText, isFailed }
}

