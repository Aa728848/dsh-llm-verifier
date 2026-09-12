import { useEffect, useState } from 'react';
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
    'field.enabled.helpOn': '允许 Agent 调用四个 verifier 工具并向裁判模型发起请求。',
    'field.enabled.helpOff': '停用后，所有 verifier 工具都会立即返回错误。',
    'field.enabled.warnDisabled': 'verifier_compare、verifier_select、verifier_track 和 verifier_current_session 当前不可用。',
    // Section: Automatic Verification
    'section.autoVerify': '自动验收',
    'field.autoVerifyMode.title': '调用策略',
    'field.autoVerifyMode.help': '手动仅暴露工具；智能在有结构化/高置信证据时路由四工具；严格还会主动执行语义路由并对任何关键操作做最终验收。',
    'field.autoVerifyMode.manual': '手动',
    'field.autoVerifyMode.smart': '智能（推荐）',
    'field.autoVerifyMode.strict': '严格',
    'field.autoRouteSemantic.title': '混合语义路由',
    'field.autoRouteSemantic.help': '结构化候选或检查点不足时，由裁判模型保守识别真实的 compare/select/track 对象。智能模式仅在有候选线索时运行；严格模式每次结束边界都会检查。',
    'field.autoRouteMinConfidence.title': '语义路由置信度',
    'field.autoRouteMinConfidence.help': '语义识别达到该置信度才执行 compare/select/track；范围 0–1，建议保持 0.9。',
    'field.autoRouteMaxCandidates.title': '最多候选数',
    'field.autoRouteMaxCandidates.help': '一次自动 select 最多纳入的真实候选数量，至少 3。',
    'field.autoRouteMaxPerTask.title': '每任务最多路由',
    'field.autoRouteMaxPerTask.help': '自动路由（compare/select/track 与语义分类）的任务尝试上限；与「每任务最多验收」共享同一个计数器，实际可用次数是两者之和。',
    'field.autoRouteMaxPerSession.title': '每会话最多路由',
    'field.autoRouteMaxPerSession.help': '同一会话中自动路由的尝试上限；与「每会话最多验收」共享计数器，实际可用次数同样是两者之和。',
    'field.autoTrackCompletionThreshold.title': '进度完成阈值',
    'field.autoTrackCompletionThreshold.help': 'track 最新检查点低于该值时 steering 要求 Agent 继续执行；更早的检查点只作展示，范围 0–1。',
    'field.autoRouteMaxItemChars.title': '单项证据字符上限',
    'field.autoRouteMaxItemChars.help': '每个候选或检查点在脱敏后允许发送给裁判的最大字符数。',
    'field.autoRouteMaxInputChars.title': '路由证据总字符上限',
    'field.autoRouteMaxInputChars.help': '一次 compare/select/track 所有候选或步骤的总字符预算。',
    'field.autoMaxModelCallsPerTask.title': '每任务模型调用预算',
    'field.autoMaxModelCallsPerTask.help': '语义分类、中间路由和最终验收共享的估算模型调用上限。',
    'field.autoMaxModelCallsPerSession.title': '每会话模型调用预算',
    'field.autoMaxModelCallsPerSession.help': '整个会话所有自动验证阶段共享的估算模型调用上限。',
    'field.autoVerifyThreshold.title': '通过阈值',
    'field.autoVerifyThreshold.help': '会话证据分数达到该值且胜过空工作基线才允许结束；范围 0–1。',
    'field.autoVerifyRepeats.title': '路由评估轮次',
    'field.autoVerifyRepeats.help': '自动路由（compare / select / track）每项标准的评分重复次数；1 为低成本初筛。',
    'field.autoVerifyFinalRepeats.title': '最终验收轮次',
    'field.autoVerifyFinalRepeats.help': '最终会话验收每项标准的评分重复次数；偶数轮会交换 A/B 位置以抵消位置偏好，默认 2。',
    'field.autoVerifyMinToolCalls.title': '智能模式最少工具调用',
    'field.autoVerifyMinToolCalls.help': '统计除 Verifier 之外的全部工具调用（含 read/grep 等只读工具）；此外还必须存在写入/执行类操作与至少一条成功结果。',
    'field.autoVerifyMaxChars.title': '最大证据字符',
    'field.autoVerifyMaxChars.help': '发送给裁判前保留的最近会话证据字符数。',
    'field.autoVerifyMaxPerTask.title': '每任务最多验收',
    'field.autoVerifyMaxPerTask.help': '最终验收的任务尝试上限；与「每任务最多路由」共享同一个计数器，实际可用次数是两者之和，用于防止低分反馈形成无限修复循环。',
    'field.autoVerifyMaxPerSession.title': '每会话最多验收',
    'field.autoVerifyMaxPerSession.help': '同一会话中最终验收的尝试上限；与「每会话最多路由」共享计数器，实际可用次数同样是两者之和。',
    'field.autoVerify.warnNotice': '自动路由按 select → compare → track → current_session 的阶段顺序处理；脱敏后的任务、Assistant 轨迹与真实工具输出会发送给所选裁判模型。候选选择或进度不足会 steering 继续工作，最终验收未通过会要求修复并重新验证。',
    'field.autoMaxModelCallsPerTask.warnBudget': '当前单任务预算为 {current} 次模型调用，低于 {judges} 位裁判完整锦标赛所需的最差情况（{required} 次）。建议调大该预算以避免自动路由过早耗尽。',
    'field.autoMaxModelCallsPerSession.warnBudget': '当前会话预算为 {current} 次模型调用，低于 {judges} 位裁判推荐的最差情况（{required} 次）。建议调大该预算以避免会话验证过早耗尽。',
    // Section: Judge Model
    'section.model': '裁判模型',
    'field.provider.title': '供应商',
    'field.provider.help': '当前 DSH 中可路由的模型供应商。',
    'field.model.title': '模型',
    'field.model.help': '用作裁判的具体模型。',
    'field.reasoningEffort.title': '推理强度',
    'field.reasoningEffort.help': '留空时使用所选模型的默认值。',
    'field.reasoningEffort.default': '模型默认',
    'field.maxTokens.title': '最大输出 Token',
    'field.maxTokens.help': '单次裁判请求允许生成的最大 Token 数。',
    'field.temperature.title': '裁判采样温度',
    'field.temperature.help': '裁判模型调用的采样温度，范围 0–2；较低值可保证判决的一致与可复现性，默认值为 0.2。',
    'field.label.title': '裁判标签',
    'field.label.help': '在统计看板和明细中显示的裁判名称，留空时默认使用模型名称。',
    'field.label.placeholder': '默认使用模型名称',
    'field.extraJudges.title': '附加裁判',
    'field.extraJudges.help': '添加最多 4 个额外裁判模型组成评审团。同一供应商与模型不能重复，且不能与主裁判相同。',
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
    'field.maxConcurrency.help': '所有 verifier 工具共享的请求并发上限。',
    'field.maxRetries.title': '最多重试',
    'field.maxRetries.help': '限流、超时和短暂网络错误的重试次数。',
    'field.retryBaseDelayMs.title': '重试基础延迟',
    'field.retryBaseDelayMs.help': '遇到限流或暂时网络错误时重试的基础等待时间，单位为毫秒。',
    'field.timeoutMs.title': '请求超时',
    'field.timeoutMs.help': '单次模型请求的超时时间，单位为毫秒。',
    'field.cacheDir.title': '缓存相对目录',
    'field.cacheDir.help': '评分持久化缓存存放的相对目录路径（相对于话题目录），不能为空。',
    'field.cacheMaxEntries.title': '缓存条目上限',
    'field.cacheMaxEntries.help': '本地持久评分缓存保留的最大条目数。',
    // Section: Cost Estimation
    'section.cost': '费用估算',
    'field.estimatedInputUsdPerMillion.title': '输入价格',
    'field.estimatedInputUsdPerMillion.help': '每百万输入 Token 的美元价格，仅用于统计估算。',
    'field.estimatedOutputUsdPerMillion.title': '输出价格',
    'field.estimatedOutputUsdPerMillion.help': '每百万输出 Token 的美元价格，仅用于统计估算。',
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
    'metric.cacheHitRate': '缓存命中率',
    'metric.cacheHitNote': '{hits} 命中 / {total} 评分',
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
    // Model summary
    'models.title': '模型汇总',
    'models.calls': '{calls} 请求',
    'models.tokens': '{tokens} Token',
    'models.empty': '暂无模型调用',
    // Slot label
    'slot.statistics': '工具统计',
    'slot.globalDashboard': 'Verifier 看板',
    'global.panelTitle': 'LLM Verifier 全局监控中心',
    'global.panelIntro': '跨会话全局统计、裁判模型效能大盘与任务验收总览。',
    'guide.verifier.title': 'Verifier 统计',
    'guide.verifier.desc': '大模型复核工具调用、耗时与成本统计',
    'field.autoVerifyTeamTasks.title': '自动验收 Team 任务',
    'field.autoVerifyTeamTasks.help': '当 Agent Teams 中的任务状态变更或进入完成状态时，自动路由进度追踪与任务验收。',
    'field.autoVerifyPlanMode.title': '计划模式自动预审',
    'field.autoVerifyPlanMode.help': '在 Agent 调用 exit_plan_mode 提交计划交付人类评审前，自动对计划完整度与风险进行独立预审。',
    'field.autoVerifySubagents.title': '同时验收子 Agent',
    'field.autoVerifySubagents.help': '子 Agent（subagent / fork）的会话也执行自动路由与最终验收。默认关闭：子会话同样以真实用户消息播种，被门控会额外消耗裁判预算并可能反复 steering 子 Agent。',
};
export const en = {
    // Settings Page
    'settings.title': 'LLM Verifier',
    'settings.intro': 'Select a model configured in DSH "Models" as an independent judge. Click the Save button at the bottom of the page to apply changes.',
    'settings.loading': 'Loading DSH models and settings…',
    'settings.retry': 'Retry',
    'settings.nsUnregistered': 'Verifier settings namespace is not registered. Restart the DSH host.',
    // Section: Tools
    'section.tools': 'Tools',
    'field.enabled.title': 'Enable Verifier Tools',
    'field.enabled.helpOn': 'Allows the Agent to call verifier tools and make requests to the judge model.',
    'field.enabled.helpOff': 'When disabled, all verifier tools will return an error immediately.',
    'field.enabled.warnDisabled': 'verifier_compare, verifier_select, verifier_track, and verifier_current_session are currently unavailable.',
    // Section: Automatic Verification
    'section.autoVerify': 'Automatic Verification',
    'field.autoVerifyMode.title': 'Invocation Policy',
    'field.autoVerifyMode.help': 'Manual exposes tools only; Smart routes tools when structured/high-confidence evidence is present; Strict actively runs semantic routing and performs final acceptance on any consequential action.',
    'field.autoVerifyMode.manual': 'Manual',
    'field.autoVerifyMode.smart': 'Smart (Recommended)',
    'field.autoVerifyMode.strict': 'Strict',
    'field.autoRouteSemantic.title': 'Hybrid Semantic Routing',
    'field.autoRouteSemantic.help': 'When structured candidates or checkpoints are lacking, the judge model conservatively identifies real compare/select/track targets. Smart mode only runs when candidate clues exist; Strict mode checks at every task boundary.',
    'field.autoRouteMinConfidence.title': 'Semantic Route Confidence',
    'field.autoRouteMinConfidence.help': 'Minimum confidence required for semantic recognition before executing compare/select/track; range 0–1, 0.9 recommended.',
    'field.autoRouteMaxCandidates.title': 'Max Candidates',
    'field.autoRouteMaxCandidates.help': 'Maximum number of real candidates included in an automatic select, at least 3.',
    'field.autoRouteMaxPerTask.title': 'Max Routes per Task',
    'field.autoRouteMaxPerTask.help': 'Task attempt cap for automatic routing (compare/select/track and semantic classification); shares one counter with "Max Verifications per Task", so the effective limit is the sum of both.',
    'field.autoRouteMaxPerSession.title': 'Max Routes per Session',
    'field.autoRouteMaxPerSession.help': 'Session attempt cap for automatic routing; shares its counter with "Max Verifications per Session" (effective limit is the sum of both).',
    'field.autoTrackCompletionThreshold.title': 'Progress Completion Threshold',
    'field.autoTrackCompletionThreshold.help': 'When the newest track checkpoint falls below this score, steering instructs the Agent to continue; earlier checkpoints are shown only; range 0–1.',
    'field.autoRouteMaxItemChars.title': 'Max Chars per Route Item',
    'field.autoRouteMaxItemChars.help': 'Maximum sanitized character count allowed per candidate or checkpoint when sent to the judge.',
    'field.autoRouteMaxInputChars.title': 'Total Route Input Chars Cap',
    'field.autoRouteMaxInputChars.help': 'Total character budget across all candidates or steps in a single compare/select/track call.',
    'field.autoMaxModelCallsPerTask.title': 'Model Call Budget per Task',
    'field.autoMaxModelCallsPerTask.help': 'Estimated model call cap shared across semantic classification, intermediate routing, and final acceptance per task.',
    'field.autoMaxModelCallsPerSession.title': 'Model Call Budget per Session',
    'field.autoMaxModelCallsPerSession.help': 'Estimated model call cap shared across all automatic verification phases throughout the entire session.',
    'field.autoVerifyRepeats.title': 'Routing Repeats',
    'field.autoVerifyRepeats.help': 'Scoring repeats per criterion for automatic routing (compare / select / track); 1 is low-cost preliminary screening.',
    'field.autoVerifyFinalRepeats.title': 'Final Acceptance Repeats',
    'field.autoVerifyFinalRepeats.help': 'Scoring repeats per criterion for the final session acceptance; even rounds swap A/B positions to cancel position bias. Defaults to 2.',
    'field.autoVerifyThreshold.title': 'Pass Threshold',
    'field.autoVerifyThreshold.help': 'Evidence score must meet this threshold and beat the empty-work baseline to allow completion; range 0–1.',
    'field.autoVerifyMinToolCalls.title': 'Min Tool Calls (Smart Mode)',
    'field.autoVerifyMinToolCalls.help': 'Counts every non-Verifier tool call, read-only tools included; consequential write/exec work and at least one successful result are still required.',
    'field.autoVerifyMaxChars.title': 'Max Evidence Characters',
    'field.autoVerifyMaxChars.help': 'Maximum recent session evidence characters retained before sending to the judge.',
    'field.autoVerifyMaxPerTask.title': 'Max Verifications per Task',
    'field.autoVerifyMaxPerTask.help': 'Final-acceptance attempt cap per task; shares one counter with "Max Routes per Task", so the effective limit is the sum of both. Prevents endless low-score repair loops.',
    'field.autoVerifyMaxPerSession.title': 'Max Verifications per Session',
    'field.autoVerifyMaxPerSession.help': 'Final-acceptance attempt cap within one session; shares its counter with "Max Routes per Session" (effective limit is the sum of both).',
    'field.autoVerify.warnNotice': 'Automatic routing follows the phase order: select → compare → track → current_session. Sanitized tasks, Assistant trajectories, and real tool outputs are sent to the judge model. Candidate selection or insufficient progress steers the Agent to keep working; failed final acceptance requires remediation and re-verification.',
    'field.autoMaxModelCallsPerTask.warnBudget': 'Current task budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s) in a full tournament. Consider increasing it to avoid premature budget exhaustion.',
    'field.autoMaxModelCallsPerSession.warnBudget': 'Current session budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s). Consider increasing it to avoid premature budget exhaustion.',
    // Section: Judge Model
    'section.model': 'Judge Model',
    'field.provider.title': 'Provider',
    'field.provider.help': 'Routable model providers currently available in DSH.',
    'field.model.title': 'Model',
    'field.model.help': 'Specific model used as the independent judge.',
    'field.reasoningEffort.title': 'Reasoning Effort',
    'field.reasoningEffort.help': 'Leave empty to use the selected model default.',
    'field.reasoningEffort.default': 'Model Default',
    'field.maxTokens.title': 'Max Output Tokens',
    'field.maxTokens.help': 'Maximum tokens allowed in a single judge model completion.',
    'field.temperature.title': 'Judge Sampling Temperature',
    'field.temperature.help': 'Sampling temperature for judge model calls, range 0–2. Lower values make judge verdicts reproducible. Default is 0.2.',
    'field.label.title': 'Judge Label',
    'field.label.help': 'Display name for the judge in statistics and dashboards. Defaults to the model name when empty.',
    'field.label.placeholder': 'Defaults to model name',
    'field.extraJudges.title': 'Extra Judges',
    'field.extraJudges.help': 'Add up to 4 extra judge models for ensemble verification. Duplicate provider and model combinations are not allowed, including the primary judge.',
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
    'field.maxConcurrency.help': 'Maximum concurrent requests shared across all verifier tools.',
    'field.maxRetries.title': 'Max Retries',
    'field.maxRetries.help': 'Retry attempts for rate limits, timeouts, and transient network errors.',
    'field.retryBaseDelayMs.title': 'Retry Base Delay',
    'field.retryBaseDelayMs.help': 'Base wait time before retrying on rate limits or transient network errors, in milliseconds.',
    'field.timeoutMs.title': 'Request Timeout',
    'field.timeoutMs.help': 'Timeout for a single model request, in milliseconds.',
    'field.cacheDir.title': 'Cache Relative Directory',
    'field.cacheDir.help': 'Relative directory for persistent score cache (relative to topic directory). Cannot be empty.',
    'field.cacheMaxEntries.title': 'Max Cache Entries',
    'field.cacheMaxEntries.help': 'Maximum entries retained in the local persistent score cache.',
    // Section: Cost Estimation
    'section.cost': 'Cost Estimation',
    'field.estimatedInputUsdPerMillion.title': 'Input Price',
    'field.estimatedInputUsdPerMillion.help': 'USD price per million input tokens, for statistical estimation only.',
    'field.estimatedOutputUsdPerMillion.title': 'Output Price',
    'field.estimatedOutputUsdPerMillion.help': 'USD price per million output tokens, for statistical estimation only.',
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
    'metric.cacheHitRate': 'Cache Hit Rate',
    'metric.cacheHitNote': '{hits} hits / {total} scored',
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
    // Model summary
    'models.title': 'Model Summary',
    'models.calls': '{calls} Requests',
    'models.tokens': '{tokens} Tokens',
    'models.empty': 'No model calls',
    // Slot label
    'slot.statistics': 'Statistics',
    'slot.globalDashboard': 'Verifier Dashboard',
    'global.panelTitle': 'LLM Verifier Global Dashboard',
    'global.panelIntro': 'Cross-session statistics, judge model metrics, and task acceptance overview.',
    'guide.verifier.title': 'Verifier Stats',
    'guide.verifier.desc': 'LLM verifier tool calls, duration and cost statistics',
    'field.autoVerifyTeamTasks.title': 'Verify Team Tasks',
    'field.autoVerifyTeamTasks.help': 'Automatically route progress and verify tasks when Agent Teams task status changes or completes.',
    'field.autoVerifyPlanMode.title': 'Plan Mode Pre-verification',
    'field.autoVerifyPlanMode.help': 'Automatically pre-verify plan feasibility and risks before exit_plan_mode presents it for user review.',
    'field.autoVerifySubagents.title': 'Verify Subagent Sessions',
    'field.autoVerifySubagents.help': 'Also run automatic routing and final acceptance on delegated child sessions. Off by default: child sessions are seeded with a real user message, so gating them spends extra judge budget and can repeatedly steer the subagent.',
};
export const dictionaries = { zh, en };
export const toolLabels = {
    zh: {
        verifier_route_classify: '路由分类',
        verifier_compare: '两项对比',
        verifier_select: '多项优选',
        verifier_track: '进度跟踪',
        verifier_current_session: '会话验收',
    },
    en: {
        verifier_route_classify: 'Route Classification',
        verifier_compare: 'Pairwise Comparison',
        verifier_select: 'Candidate Selection',
        verifier_track: 'Progress Tracking',
        verifier_current_session: 'Session Acceptance',
    },
};
export function tFormat(template, params) {
    if (!params)
        return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}
export function detectLanguage() {
    if (typeof document === 'undefined')
        return 'en';
    const lang = (document.documentElement.lang || '').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
}
export function useLanguage() {
    const [lang, setLang] = useState(detectLanguage);
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        const update = () => { setLang(detectLanguage()); };
        update();
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'lang') {
                    update();
                }
            }
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        return () => observer.disconnect();
    }, []);
    return lang;
}
export function compact(value, lang = 'en') {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.NumberFormat(locale, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: value >= 1_000 ? 1 : 0 }).format(value);
}
export function money(value) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: value < 0.01 ? 4 : 2 });
}
export function duration(value) {
    if (value < 1000)
        return Math.round(value) + ' ms';
    if (value < 60_000)
        return (value / 1000).toFixed(1) + ' s';
    return (value / 60_000).toFixed(1) + ' min';
}
export function dateTime(value, lang = 'en') {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
}
export function resolveCacheDirOnSave(draft, previous) {
    if (typeof draft === 'string' && draft.trim())
        return draft.trim();
    if (typeof previous === 'string' && previous.trim())
        return previous.trim();
    return undefined;
}
/**
 * Deep equality for JSON-shaped settings values, insensitive to object key
 * order and treating a missing key as `undefined`. The settings page compares a
 * draft against a resolved view that was built from a different object shape,
 * so identity comparison is never enough.
 */
export function sameSettingValue(left, right) {
    if (left === right)
        return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length)
            return false;
        for (let index = 0; index < left.length; index += 1) {
            if (!sameSettingValue(left[index], right[index]))
                return false;
        }
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right))
        return false;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null)
        return false;
    const a = left;
    const b = right;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!sameSettingValue(a[key], b[key]))
            return false;
    }
    return true;
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
 */
export function sectionForSave(user, draft, base) {
    const section = { ...user };
    for (const [key, value] of Object.entries(draft)) {
        if (value === undefined || (base !== undefined && sameSettingValue(value, base[key]))) {
            delete section[key];
            continue;
        }
        section[key] = value;
    }
    return section;
}
/** An eight-candidate select: ring + pivot rounds (18 pairs) x three criteria, one round (the per-pair orientation removes the slot bias). */
export const WORST_CASE_ROUTE_CALLS_PER_JUDGE = 54;
/** Final acceptance: three criteria x the default two repeats (one per A/B position). */
export const WORST_CASE_FINAL_CALLS_PER_JUDGE = 6;
export const WORST_CASE_TASK_PER_JUDGE = WORST_CASE_ROUTE_CALLS_PER_JUDGE + WORST_CASE_FINAL_CALLS_PER_JUDGE;
export const WORST_CASE_SESSION_PER_JUDGE = 160;
export function computeJudgeCount(extraJudgesCount) {
    return 1 + Math.max(0, extraJudgesCount);
}
export function computeWorstCaseBudget(judgeCount) {
    const count = Math.max(1, judgeCount);
    return {
        worstCaseTask: count * WORST_CASE_TASK_PER_JUDGE,
        worstCaseSession: count * WORST_CASE_SESSION_PER_JUDGE,
    };
}
export function evaluateBudgetWarning(autoVerifyMode, extraJudgesCount, autoMaxModelCallsPerTask, autoMaxModelCallsPerSession) {
    if (autoVerifyMode === 'manual')
        return null;
    const judgeCount = computeJudgeCount(extraJudgesCount);
    const { worstCaseTask, worstCaseSession } = computeWorstCaseBudget(judgeCount);
    const warnTask = autoMaxModelCallsPerTask < worstCaseTask;
    const warnSession = autoMaxModelCallsPerSession < worstCaseSession;
    if (!warnTask && !warnSession)
        return null;
    return { judgeCount, worstCaseTask, worstCaseSession, warnTask, warnSession };
}
export function isVerdictFailed(verdict, success = true) {
    if (!success)
        return true;
    if (!verdict)
        return false;
    return verdict.outcome === 'below-threshold' || verdict.outcome === 'error';
}
export function formatPercentage(val) {
    if (!Number.isFinite(val))
        return '--';
    return `${(val * 100).toFixed(1)}%`;
}
export function formatVerdictDetails(verdict, t) {
    const isFailed = verdict.outcome === 'below-threshold' || verdict.outcome === 'error';
    const outcomeKey = verdict.outcome ? `stats.outcome.${verdict.outcome}` : undefined;
    const outcomeText = outcomeKey && t[outcomeKey] ? t[outcomeKey] : verdict.outcome;
    const phaseKey = verdict.phase ? `stats.phase.${verdict.phase}` : undefined;
    const phaseText = phaseKey && t[phaseKey] ? t[phaseKey] : verdict.phase;
    let scoreText;
    if (typeof verdict.score === 'number') {
        const scorePct = formatPercentage(verdict.score);
        if (typeof verdict.threshold === 'number') {
            const threshPct = formatPercentage(verdict.threshold);
            scoreText = tFormat(t['stats.verdict.scoreThreshold'], { score: scorePct, threshold: threshPct });
        }
        else {
            scoreText = tFormat(t['stats.verdict.scoreOnly'], { score: scorePct });
        }
    }
    // One track verdict carries a whole progression; showing only the newest score
    // hides why the route decided to continue.
    let checkpointsText;
    if (Array.isArray(verdict.scores) && verdict.scores.length > 1) {
        checkpointsText = tFormat(t['stats.verdict.checkpoints'], { scores: verdict.scores.map(formatPercentage).join(' → ') });
    }
    // The acceptance mean can hide a requirement that failed on its own, so the breakdown
    // is what tells the reader which one is holding the task back.
    let criteriaText;
    if (Array.isArray(verdict.criteria) && verdict.criteria.length > 0) {
        criteriaText = tFormat(t['stats.verdict.criteria'], { criteria: verdict.criteria.map(criterion => criterion.id + ' ' + formatPercentage(criterion.score)).join(' · ') });
    }
    let winnerText;
    if (verdict.winner) {
        const winnerValue = verdict.winner === 'tie' ? t['stats.winner.tie'] : verdict.winner;
        winnerText = tFormat(t['stats.verdict.winner'], { winner: winnerValue });
    }
    return { outcomeText, phaseText, scoreText, checkpointsText, criteriaText, winnerText, isFailed };
}
//# sourceMappingURL=client-i18n.js.map