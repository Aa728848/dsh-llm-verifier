import { useEffect, useState } from 'react'

export const zh = {
  // Settings Page
  'settings.title': 'LLM Verifier',
  'settings.intro': '选择已在 DSH「模型」中配置的模型作为独立裁判。修改后点击页面底部的保存按钮生效。',
  'settings.loading': '正在读取 DSH 模型和设置…',
  'settings.retry': '重试',
  'settings.nsUnregistered': 'Verifier settings namespace is not registered. Restart the DSH host.',

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
  'field.autoRouteMaxPerTask.help': 'compare/select/track 自动路由的任务预算；指纹去重后仍受此上限约束。',
  'field.autoRouteMaxPerSession.title': '每会话最多路由',
  'field.autoRouteMaxPerSession.help': '同一会话中 compare/select/track 自动路由总预算。',
  'field.autoTrackCompletionThreshold.title': '进度完成阈值',
  'field.autoTrackCompletionThreshold.help': 'track 任一检查点低于该值时 steering 要求 Agent 继续执行；范围 0–1。',
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
  'field.autoVerifyRepeats.title': '自动评估轮次',
  'field.autoVerifyRepeats.help': '每项标准的自动评分重复次数；1 为低成本初筛。',
  'field.autoVerifyMinToolCalls.title': '智能模式最少工具调用',
  'field.autoVerifyMinToolCalls.help': '达到此工具证据数量且包含写入/执行类操作时才自动验收。',
  'field.autoVerifyMaxChars.title': '最大证据字符',
  'field.autoVerifyMaxChars.help': '发送给裁判前保留的最近会话证据字符数。',
  'field.autoVerifyMaxPerTask.title': '每任务最多验收',
  'field.autoVerifyMaxPerTask.help': '低分反馈后允许再次验收的次数上限，防止循环。',
  'field.autoVerifyMaxPerSession.title': '每会话最多验收',
  'field.autoVerifyMaxPerSession.help': '同一会话中的自动验收总预算。',
  'field.autoVerify.warnNotice': '自动路由按 select → compare → track → current_session 的阶段顺序处理；脱敏后的任务、Assistant 轨迹与真实工具输出会发送给所选裁判模型。候选选择或进度不足会 steering 继续工作，最终验收未通过会要求修复并重新验证。',

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

  // Section: Execution
  'section.execution': '执行',
  'field.maxConcurrency.title': '最大并发',
  'field.maxConcurrency.help': '所有 verifier 工具共享的请求并发上限。',
  'field.maxRetries.title': '最多重试',
  'field.maxRetries.help': '限流、超时和短暂网络错误的重试次数。',
  'field.timeoutMs.title': '请求超时',
  'field.timeoutMs.help': '单次模型请求的超时时间，单位为毫秒。',
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
  'field.autoRouteMaxPerTask.help': 'Task budget for automatic compare/select/track routing; still constrained by this cap after fingerprint deduplication.',
  'field.autoRouteMaxPerSession.title': 'Max Routes per Session',
  'field.autoRouteMaxPerSession.help': 'Total budget for automatic compare/select/track routing within the same session.',
  'field.autoTrackCompletionThreshold.title': 'Progress Completion Threshold',
  'field.autoTrackCompletionThreshold.help': 'When any track checkpoint falls below this score, steering instructs the Agent to continue; range 0–1.',
  'field.autoRouteMaxItemChars.title': 'Max Chars per Route Item',
  'field.autoRouteMaxItemChars.help': 'Maximum sanitized character count allowed per candidate or checkpoint when sent to the judge.',
  'field.autoRouteMaxInputChars.title': 'Total Route Input Chars Cap',
  'field.autoRouteMaxInputChars.help': 'Total character budget across all candidates or steps in a single compare/select/track call.',
  'field.autoMaxModelCallsPerTask.title': 'Model Call Budget per Task',
  'field.autoMaxModelCallsPerTask.help': 'Estimated model call cap shared across semantic classification, intermediate routing, and final acceptance per task.',
  'field.autoMaxModelCallsPerSession.title': 'Model Call Budget per Session',
  'field.autoMaxModelCallsPerSession.help': 'Estimated model call cap shared across all automatic verification phases throughout the entire session.',
  'field.autoVerifyThreshold.title': 'Pass Threshold',
  'field.autoVerifyThreshold.help': 'Evidence score must meet this threshold and beat the empty-work baseline to allow completion; range 0–1.',
  'field.autoVerifyRepeats.title': 'Auto Evaluation Repeats',
  'field.autoVerifyRepeats.help': 'Number of scoring repeats per criterion for auto evaluation; 1 is low-cost preliminary screening.',
  'field.autoVerifyMinToolCalls.title': 'Min Tool Calls (Smart Mode)',
  'field.autoVerifyMinToolCalls.help': 'Auto-verification triggers only when reaching this tool evidence count and containing write/exec operations.',
  'field.autoVerifyMaxChars.title': 'Max Evidence Characters',
  'field.autoVerifyMaxChars.help': 'Maximum recent session evidence characters retained before sending to the judge.',
  'field.autoVerifyMaxPerTask.title': 'Max Verifications per Task',
  'field.autoVerifyMaxPerTask.help': 'Maximum verification attempts allowed after low-score feedback to prevent infinite loops.',
  'field.autoVerifyMaxPerSession.title': 'Max Verifications per Session',
  'field.autoVerifyMaxPerSession.help': 'Total auto-verification budget within the same session.',
  'field.autoVerify.warnNotice': 'Automatic routing follows the phase order: select → compare → track → current_session. Sanitized tasks, Assistant trajectories, and real tool outputs are sent to the judge model. Candidate selection or insufficient progress steers the Agent to keep working; failed final acceptance requires remediation and re-verification.',

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

  // Section: Execution
  'section.execution': 'Execution',
  'field.maxConcurrency.title': 'Max Concurrency',
  'field.maxConcurrency.help': 'Maximum concurrent requests shared across all verifier tools.',
  'field.maxRetries.title': 'Max Retries',
  'field.maxRetries.help': 'Retry attempts for rate limits, timeouts, and transient network errors.',
  'field.timeoutMs.title': 'Request Timeout',
  'field.timeoutMs.help': 'Timeout for a single model request, in milliseconds.',
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
}

export const dictionaries = { zh, en }

export const toolLabels: Record<'zh' | 'en', Record<string, string>> = {
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
}

export function tFormat(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
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
