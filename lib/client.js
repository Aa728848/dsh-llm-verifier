window.__ModuleLoader__.load({
	id: "dsh-llm-verifier",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-i18n.ts
		const zh = {
			"settings.title": "LLM Verifier",
			"settings.intro": "选择已在 DSH「模型」中配置的模型作为独立裁判。修改后点击页面底部的保存按钮生效。",
			"settings.loading": "正在读取 DSH 模型和设置…",
			"settings.retry": "重试",
			"settings.nsUnregistered": "未注册 Verifier 设置命名空间，请重启 DSH 宿主。",
			"section.tools": "工具",
			"field.enabled.title": "启用 Verifier 工具",
			"field.enabled.helpOn": "允许 Agent 调用四个 verifier 工具并向裁判模型发起请求。",
			"field.enabled.helpOff": "停用后，所有 verifier 工具都会立即返回错误。",
			"field.enabled.warnDisabled": "verifier_compare、verifier_select、verifier_track 和 verifier_current_session 当前不可用。",
			"section.autoVerify": "自动验收",
			"field.autoVerifyMode.title": "调用策略",
			"field.autoVerifyMode.help": "手动仅暴露工具；智能在有结构化/高置信证据时路由四工具；严格还会主动执行语义路由并对任何关键操作做最终验收。",
			"field.autoVerifyMode.manual": "手动",
			"field.autoVerifyMode.smart": "智能（推荐）",
			"field.autoVerifyMode.strict": "严格",
			"field.autoRouteSemantic.title": "混合语义路由",
			"field.autoRouteSemantic.help": "结构化候选或检查点不足时，由裁判模型保守识别真实的 compare/select/track 对象。智能模式仅在有候选线索时运行；严格模式每次结束边界都会检查。",
			"field.autoRouteMinConfidence.title": "语义路由置信度",
			"field.autoRouteMinConfidence.help": "语义识别达到该置信度才执行 compare/select/track；范围 0–1，建议保持 0.9。",
			"field.autoRouteMaxCandidates.title": "最多候选数",
			"field.autoRouteMaxCandidates.help": "一次自动 select 最多纳入的真实候选数量，至少 3。",
			"field.autoRouteMaxPerTask.title": "每任务最多路由",
			"field.autoRouteMaxPerTask.help": "自动路由（compare/select/track 与语义分类）的任务尝试上限；与「每任务最多验收」共享同一个计数器，实际可用次数是两者之和。",
			"field.autoRouteMaxPerSession.title": "每会话最多路由",
			"field.autoRouteMaxPerSession.help": "同一会话中自动路由的尝试上限；与「每会话最多验收」共享计数器，实际可用次数同样是两者之和。",
			"field.autoTrackCompletionThreshold.title": "进度完成阈值",
			"field.autoTrackCompletionThreshold.help": "track 任一检查点低于该值时 steering 要求 Agent 继续执行；范围 0–1。",
			"field.autoRouteMaxItemChars.title": "单项证据字符上限",
			"field.autoRouteMaxItemChars.help": "每个候选或检查点在脱敏后允许发送给裁判的最大字符数。",
			"field.autoRouteMaxInputChars.title": "路由证据总字符上限",
			"field.autoRouteMaxInputChars.help": "一次 compare/select/track 所有候选或步骤的总字符预算。",
			"field.autoMaxModelCallsPerTask.title": "每任务模型调用预算",
			"field.autoMaxModelCallsPerTask.help": "语义分类、中间路由和最终验收共享的估算模型调用上限。",
			"field.autoMaxModelCallsPerSession.title": "每会话模型调用预算",
			"field.autoMaxModelCallsPerSession.help": "整个会话所有自动验证阶段共享的估算模型调用上限。",
			"field.autoVerifyThreshold.title": "通过阈值",
			"field.autoVerifyThreshold.help": "会话证据分数达到该值且胜过空工作基线才允许结束；范围 0–1。",
			"field.autoVerifyRepeats.title": "路由评估轮次",
			"field.autoVerifyRepeats.help": "自动路由（compare / select / track）每项标准的评分重复次数；1 为低成本初筛。",
			"field.autoVerifyFinalRepeats.title": "最终验收轮次",
			"field.autoVerifyFinalRepeats.help": "最终会话验收每项标准的评分重复次数；偶数轮会交换 A/B 位置以抵消位置偏好，默认 2。",
			"field.autoVerifyMinToolCalls.title": "智能模式最少工具调用",
			"field.autoVerifyMinToolCalls.help": "统计除 Verifier 之外的全部工具调用（含 read/grep 等只读工具）；此外还必须存在写入/执行类操作与至少一条成功结果。",
			"field.autoVerifyMaxChars.title": "最大证据字符",
			"field.autoVerifyMaxChars.help": "发送给裁判前保留的最近会话证据字符数。",
			"field.autoVerifyMaxPerTask.title": "每任务最多验收",
			"field.autoVerifyMaxPerTask.help": "最终验收的任务尝试上限；与「每任务最多路由」共享同一个计数器，实际可用次数是两者之和，用于防止低分反馈形成无限修复循环。",
			"field.autoVerifyMaxPerSession.title": "每会话最多验收",
			"field.autoVerifyMaxPerSession.help": "同一会话中最终验收的尝试上限；与「每会话最多路由」共享计数器，实际可用次数同样是两者之和。",
			"field.autoVerify.warnNotice": "自动路由按 select → compare → track → current_session 的阶段顺序处理；脱敏后的任务、Assistant 轨迹与真实工具输出会发送给所选裁判模型。候选选择或进度不足会 steering 继续工作，最终验收未通过会要求修复并重新验证。",
			"field.autoMaxModelCallsPerTask.warnBudget": "当前单任务预算为 {current} 次模型调用，低于 {judges} 位裁判完整锦标赛所需的最差情况（{required} 次）。建议调大该预算以避免自动路由过早耗尽。",
			"field.autoMaxModelCallsPerSession.warnBudget": "当前会话预算为 {current} 次模型调用，低于 {judges} 位裁判推荐的最差情况（{required} 次）。建议调大该预算以避免会话验证过早耗尽。",
			"section.model": "裁判模型",
			"field.provider.title": "供应商",
			"field.provider.help": "当前 DSH 中可路由的模型供应商。",
			"field.model.title": "模型",
			"field.model.help": "用作裁判的具体模型。",
			"field.reasoningEffort.title": "推理强度",
			"field.reasoningEffort.help": "留空时使用所选模型的默认值。",
			"field.reasoningEffort.default": "模型默认",
			"field.maxTokens.title": "最大输出 Token",
			"field.maxTokens.help": "单次裁判请求允许生成的最大 Token 数。",
			"field.temperature.title": "裁判采样温度",
			"field.temperature.help": "裁判模型调用的采样温度，范围 0–2；较低值可保证判决的一致与可复现性，默认值为 0.2。",
			"field.label.title": "裁判标签",
			"field.label.help": "在统计看板和明细中显示的裁判名称，留空时默认使用模型名称。",
			"field.label.placeholder": "默认使用模型名称",
			"field.extraJudges.title": "附加裁判",
			"field.extraJudges.help": "添加最多 4 个额外裁判模型组成评审团。同一供应商与模型不能重复，且不能与主裁判相同。",
			"field.extraJudges.add": "添加裁判",
			"field.extraJudges.remove": "删除",
			"field.extraJudges.labelTitle": "标签",
			"field.extraJudges.labelPlaceholder": "自定义标签（可选）",
			"field.extraJudges.providerAria": "附加裁判 #{index} 供应商",
			"field.extraJudges.modelAria": "附加裁判 #{index} 模型",
			"field.extraJudges.effortAria": "附加裁判 #{index} 推理强度",
			"field.extraJudges.labelAria": "附加裁判 #{index} 标签",
			"field.extraJudges.removeAria": "删除附加裁判 #{index}",
			"field.extraJudges.conflictPrimary": "附加裁判 #{index} 与主裁判模型重复（{id}），请选择不同模型。",
			"field.extraJudges.conflictDuplicate": "附加裁判 #{index} 与附加裁判 #{other} 重复（{id}），请选择不同模型。",
			"section.execution": "执行",
			"field.maxConcurrency.title": "最大并发",
			"field.maxConcurrency.help": "所有 verifier 工具共享的请求并发上限。",
			"field.maxRetries.title": "最多重试",
			"field.maxRetries.help": "限流、超时和短暂网络错误的重试次数。",
			"field.retryBaseDelayMs.title": "重试基础延迟",
			"field.retryBaseDelayMs.help": "遇到限流或暂时网络错误时重试的基础等待时间，单位为毫秒。",
			"field.timeoutMs.title": "请求超时",
			"field.timeoutMs.help": "单次模型请求的超时时间，单位为毫秒。",
			"field.cacheDir.title": "缓存相对目录",
			"field.cacheDir.help": "评分持久化缓存存放的相对目录路径（相对于话题目录），不能为空。",
			"field.cacheMaxEntries.title": "缓存条目上限",
			"field.cacheMaxEntries.help": "本地持久评分缓存保留的最大条目数。",
			"section.cost": "费用估算",
			"field.estimatedInputUsdPerMillion.title": "输入价格",
			"field.estimatedInputUsdPerMillion.help": "每百万输入 Token 的美元价格，仅用于统计估算。",
			"field.estimatedOutputUsdPerMillion.title": "输出价格",
			"field.estimatedOutputUsdPerMillion.help": "每百万输出 Token 的美元价格，仅用于统计估算。",
			"settings.catalogFailures": "部分模型目录读取失败",
			"settings.saved": "设置已保存。",
			"settings.reload": "重新载入",
			"settings.unsaved": "当前页面有未保存的修改：点击「保存」后才会写入设置；「重新载入」会丢弃这些修改。",
			"settings.save": "保存设置",
			"settings.saving": "保存中…",
			"stats.pageTitle": "Verifier 工具统计",
			"stats.updatedAt": "数据更新于 {time} · 自动记录四个验证工具的实际执行结果",
			"stats.daysUnit": "{days} 天",
			"stats.currentSession": "当前会话",
			"stats.allSessions": "全部会话",
			"stats.refresh": "刷新",
			"stats.requestFailed": "统计接口请求失败",
			"stats.hostRestartHint": "请确认宿主已重启并加载最新版本的 dsh-llm-verifier。",
			"stats.loading": "正在读取工具运行统计…",
			"stats.costSummary": "{days} 天估算费用",
			"stats.callsSummary": "{invocations} 次工具调用 · {calls} 次裁判模型请求",
			"stats.successCalls": "成功调用",
			"stats.failedCalls": "失败调用",
			"stats.avgDuration": "平均耗时",
			"stats.phase.explicit": "显式调用",
			"stats.phase.compare": "两项对比",
			"stats.phase.select": "多项优选",
			"stats.phase.track": "进度跟踪",
			"stats.phase.final": "最终验收",
			"stats.phase.plan_review": "计划预审",
			"stats.phase.team_task": "Team 任务",
			"stats.phase.semantic": "语义路由",
			"stats.outcome.passed": "通过",
			"stats.outcome.below-threshold": "未达标",
			"stats.outcome.tie": "平局",
			"stats.outcome.error": "异常",
			"stats.outcome.dropped-over-budget": "超预算丢弃",
			"stats.outcome.invalid-references": "引用无效",
			"stats.winner.tie": "平局",
			"stats.verdict.winner": "胜方 {winner}",
			"stats.verdict.scoreThreshold": "得分 {score}（阈值 {threshold}）",
			"stats.verdict.scoreOnly": "得分 {score}",
			"metric.cacheHitRate": "缓存命中率",
			"metric.cacheHitNote": "{hits} 命中 / {total} 评分",
			"metric.tokens": "Token",
			"metric.tokensNote": "输入 {input} · 输出 {output}",
			"metric.avgModelCalls": "平均模型请求",
			"metric.avgModelCallsNote": "{attempts} 次尝试 · {retries} 次重试",
			"metric.scoringMode": "评分模式",
			"metric.scoringModeNote": "Top-logprobs · 显式标签 {explicit}",
			"chart.title": "每日工具调用与模型请求趋势",
			"chart.ariaLabel": "每日工具调用与模型请求趋势",
			"chart.legendToolCalls": "工具调用",
			"chart.legendModelCalls": "模型请求",
			"table.title": "工具运行明细",
			"table.toolCount": "{count} 类工具",
			"table.colTool": "工具",
			"table.colInvocations": "调用",
			"table.colSuccessRate": "成功率",
			"table.colAvgDuration": "平均耗时",
			"table.colModelCalls": "模型请求",
			"table.colTokens": "Token",
			"table.colCacheHits": "缓存命中",
			"table.colEstimatedCost": "估算费用",
			"table.empty": "所选范围内还没有 Verifier 工具调用。后续执行会自动出现在这里。",
			"recent.title": "最近调用",
			"recent.maxCount": "最多 50 条",
			"recent.empty": "暂无记录",
			"models.title": "模型汇总",
			"models.calls": "{calls} 请求",
			"models.tokens": "{tokens} Token",
			"models.empty": "暂无模型调用",
			"slot.statistics": "工具统计",
			"slot.globalDashboard": "Verifier 看板",
			"global.panelTitle": "LLM Verifier 全局监控中心",
			"global.panelIntro": "跨会话全局统计、裁判模型效能大盘与任务验收总览。",
			"guide.verifier.title": "Verifier 统计",
			"guide.verifier.desc": "大模型复核工具调用、耗时与成本统计",
			"field.autoVerifyTeamTasks.title": "自动验收 Team 任务",
			"field.autoVerifyTeamTasks.help": "当 Agent Teams 中的任务状态变更或进入完成状态时，自动路由进度追踪与任务验收。",
			"field.autoVerifyPlanMode.title": "计划模式自动预审",
			"field.autoVerifyPlanMode.help": "在 Agent 调用 exit_plan_mode 提交计划交付人类评审前，自动对计划完整度与风险进行独立预审。",
			"field.autoVerifySubagents.title": "同时验收子 Agent",
			"field.autoVerifySubagents.help": "子 Agent（subagent / fork）的会话也执行自动路由与最终验收。默认关闭：子会话同样以真实用户消息播种，被门控会额外消耗裁判预算并可能反复 steering 子 Agent。"
		};
		const en = {
			"settings.title": "LLM Verifier",
			"settings.intro": "Select a model configured in DSH \"Models\" as an independent judge. Click the Save button at the bottom of the page to apply changes.",
			"settings.loading": "Loading DSH models and settings…",
			"settings.retry": "Retry",
			"settings.nsUnregistered": "Verifier settings namespace is not registered. Restart the DSH host.",
			"section.tools": "Tools",
			"field.enabled.title": "Enable Verifier Tools",
			"field.enabled.helpOn": "Allows the Agent to call verifier tools and make requests to the judge model.",
			"field.enabled.helpOff": "When disabled, all verifier tools will return an error immediately.",
			"field.enabled.warnDisabled": "verifier_compare, verifier_select, verifier_track, and verifier_current_session are currently unavailable.",
			"section.autoVerify": "Automatic Verification",
			"field.autoVerifyMode.title": "Invocation Policy",
			"field.autoVerifyMode.help": "Manual exposes tools only; Smart routes tools when structured/high-confidence evidence is present; Strict actively runs semantic routing and performs final acceptance on any consequential action.",
			"field.autoVerifyMode.manual": "Manual",
			"field.autoVerifyMode.smart": "Smart (Recommended)",
			"field.autoVerifyMode.strict": "Strict",
			"field.autoRouteSemantic.title": "Hybrid Semantic Routing",
			"field.autoRouteSemantic.help": "When structured candidates or checkpoints are lacking, the judge model conservatively identifies real compare/select/track targets. Smart mode only runs when candidate clues exist; Strict mode checks at every task boundary.",
			"field.autoRouteMinConfidence.title": "Semantic Route Confidence",
			"field.autoRouteMinConfidence.help": "Minimum confidence required for semantic recognition before executing compare/select/track; range 0–1, 0.9 recommended.",
			"field.autoRouteMaxCandidates.title": "Max Candidates",
			"field.autoRouteMaxCandidates.help": "Maximum number of real candidates included in an automatic select, at least 3.",
			"field.autoRouteMaxPerTask.title": "Max Routes per Task",
			"field.autoRouteMaxPerTask.help": "Task attempt cap for automatic routing (compare/select/track and semantic classification); shares one counter with \"Max Verifications per Task\", so the effective limit is the sum of both.",
			"field.autoRouteMaxPerSession.title": "Max Routes per Session",
			"field.autoRouteMaxPerSession.help": "Session attempt cap for automatic routing; shares its counter with \"Max Verifications per Session\" (effective limit is the sum of both).",
			"field.autoTrackCompletionThreshold.title": "Progress Completion Threshold",
			"field.autoTrackCompletionThreshold.help": "When any track checkpoint falls below this score, steering instructs the Agent to continue; range 0–1.",
			"field.autoRouteMaxItemChars.title": "Max Chars per Route Item",
			"field.autoRouteMaxItemChars.help": "Maximum sanitized character count allowed per candidate or checkpoint when sent to the judge.",
			"field.autoRouteMaxInputChars.title": "Total Route Input Chars Cap",
			"field.autoRouteMaxInputChars.help": "Total character budget across all candidates or steps in a single compare/select/track call.",
			"field.autoMaxModelCallsPerTask.title": "Model Call Budget per Task",
			"field.autoMaxModelCallsPerTask.help": "Estimated model call cap shared across semantic classification, intermediate routing, and final acceptance per task.",
			"field.autoMaxModelCallsPerSession.title": "Model Call Budget per Session",
			"field.autoMaxModelCallsPerSession.help": "Estimated model call cap shared across all automatic verification phases throughout the entire session.",
			"field.autoVerifyRepeats.title": "Routing Repeats",
			"field.autoVerifyRepeats.help": "Scoring repeats per criterion for automatic routing (compare / select / track); 1 is low-cost preliminary screening.",
			"field.autoVerifyFinalRepeats.title": "Final Acceptance Repeats",
			"field.autoVerifyFinalRepeats.help": "Scoring repeats per criterion for the final session acceptance; even rounds swap A/B positions to cancel position bias. Defaults to 2.",
			"field.autoVerifyThreshold.title": "Pass Threshold",
			"field.autoVerifyThreshold.help": "Evidence score must meet this threshold and beat the empty-work baseline to allow completion; range 0–1.",
			"field.autoVerifyMinToolCalls.title": "Min Tool Calls (Smart Mode)",
			"field.autoVerifyMinToolCalls.help": "Counts every non-Verifier tool call, read-only tools included; consequential write/exec work and at least one successful result are still required.",
			"field.autoVerifyMaxChars.title": "Max Evidence Characters",
			"field.autoVerifyMaxChars.help": "Maximum recent session evidence characters retained before sending to the judge.",
			"field.autoVerifyMaxPerTask.title": "Max Verifications per Task",
			"field.autoVerifyMaxPerTask.help": "Final-acceptance attempt cap per task; shares one counter with \"Max Routes per Task\", so the effective limit is the sum of both. Prevents endless low-score repair loops.",
			"field.autoVerifyMaxPerSession.title": "Max Verifications per Session",
			"field.autoVerifyMaxPerSession.help": "Final-acceptance attempt cap within one session; shares its counter with \"Max Routes per Session\" (effective limit is the sum of both).",
			"field.autoVerify.warnNotice": "Automatic routing follows the phase order: select → compare → track → current_session. Sanitized tasks, Assistant trajectories, and real tool outputs are sent to the judge model. Candidate selection or insufficient progress steers the Agent to keep working; failed final acceptance requires remediation and re-verification.",
			"field.autoMaxModelCallsPerTask.warnBudget": "Current task budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s) in a full tournament. Consider increasing it to avoid premature budget exhaustion.",
			"field.autoMaxModelCallsPerSession.warnBudget": "Current session budget ({current} calls) is below the worst-case requirement ({required} calls) for {judges} judge(s). Consider increasing it to avoid premature budget exhaustion.",
			"section.model": "Judge Model",
			"field.provider.title": "Provider",
			"field.provider.help": "Routable model providers currently available in DSH.",
			"field.model.title": "Model",
			"field.model.help": "Specific model used as the independent judge.",
			"field.reasoningEffort.title": "Reasoning Effort",
			"field.reasoningEffort.help": "Leave empty to use the selected model default.",
			"field.reasoningEffort.default": "Model Default",
			"field.maxTokens.title": "Max Output Tokens",
			"field.maxTokens.help": "Maximum tokens allowed in a single judge model completion.",
			"field.temperature.title": "Judge Sampling Temperature",
			"field.temperature.help": "Sampling temperature for judge model calls, range 0–2. Lower values make judge verdicts reproducible. Default is 0.2.",
			"field.label.title": "Judge Label",
			"field.label.help": "Display name for the judge in statistics and dashboards. Defaults to the model name when empty.",
			"field.label.placeholder": "Defaults to model name",
			"field.extraJudges.title": "Extra Judges",
			"field.extraJudges.help": "Add up to 4 extra judge models for ensemble verification. Duplicate provider and model combinations are not allowed, including the primary judge.",
			"field.extraJudges.add": "Add Judge",
			"field.extraJudges.remove": "Remove",
			"field.extraJudges.labelTitle": "Label",
			"field.extraJudges.labelPlaceholder": "Custom label (optional)",
			"field.extraJudges.providerAria": "Extra judge #{index} provider",
			"field.extraJudges.modelAria": "Extra judge #{index} model",
			"field.extraJudges.effortAria": "Extra judge #{index} reasoning effort",
			"field.extraJudges.labelAria": "Extra judge #{index} label",
			"field.extraJudges.removeAria": "Remove extra judge #{index}",
			"field.extraJudges.conflictPrimary": "Extra judge #{index} duplicates primary judge ({id}). Please select a different model.",
			"field.extraJudges.conflictDuplicate": "Extra judge #{index} duplicates extra judge #{other} ({id}). Please select a different model.",
			"section.execution": "Execution",
			"field.maxConcurrency.title": "Max Concurrency",
			"field.maxConcurrency.help": "Maximum concurrent requests shared across all verifier tools.",
			"field.maxRetries.title": "Max Retries",
			"field.maxRetries.help": "Retry attempts for rate limits, timeouts, and transient network errors.",
			"field.retryBaseDelayMs.title": "Retry Base Delay",
			"field.retryBaseDelayMs.help": "Base wait time before retrying on rate limits or transient network errors, in milliseconds.",
			"field.timeoutMs.title": "Request Timeout",
			"field.timeoutMs.help": "Timeout for a single model request, in milliseconds.",
			"field.cacheDir.title": "Cache Relative Directory",
			"field.cacheDir.help": "Relative directory for persistent score cache (relative to topic directory). Cannot be empty.",
			"field.cacheMaxEntries.title": "Max Cache Entries",
			"field.cacheMaxEntries.help": "Maximum entries retained in the local persistent score cache.",
			"section.cost": "Cost Estimation",
			"field.estimatedInputUsdPerMillion.title": "Input Price",
			"field.estimatedInputUsdPerMillion.help": "USD price per million input tokens, for statistical estimation only.",
			"field.estimatedOutputUsdPerMillion.title": "Output Price",
			"field.estimatedOutputUsdPerMillion.help": "USD price per million output tokens, for statistical estimation only.",
			"settings.catalogFailures": "Some model catalogs failed to load",
			"settings.saved": "Settings saved.",
			"settings.reload": "Reload",
			"settings.unsaved": "This page has unsaved changes: click Save to write them; Reload discards them.",
			"settings.save": "Save Settings",
			"settings.saving": "Saving…",
			"stats.pageTitle": "Verifier Tool Statistics",
			"stats.updatedAt": "Updated at {time} · Automatically records execution results of the 4 verifier tools",
			"stats.daysUnit": "{days} Days",
			"stats.currentSession": "Current Session",
			"stats.allSessions": "All Sessions",
			"stats.refresh": "Refresh",
			"stats.requestFailed": "Failed to query statistics API",
			"stats.hostRestartHint": "Please make sure the host has restarted and loaded the latest version of dsh-llm-verifier.",
			"stats.loading": "Loading tool execution statistics…",
			"stats.costSummary": "{days}-Day Estimated Cost",
			"stats.callsSummary": "{invocations} tool calls · {calls} judge requests",
			"stats.successCalls": "Successful",
			"stats.failedCalls": "Failed",
			"stats.avgDuration": "Avg Duration",
			"stats.phase.explicit": "Explicit",
			"stats.phase.compare": "Compare",
			"stats.phase.select": "Select",
			"stats.phase.track": "Track",
			"stats.phase.final": "Final Acceptance",
			"stats.phase.plan_review": "Plan Review",
			"stats.phase.team_task": "Team Task",
			"stats.phase.semantic": "Semantic Route",
			"stats.outcome.passed": "Passed",
			"stats.outcome.below-threshold": "Below Threshold",
			"stats.outcome.tie": "Tie",
			"stats.outcome.error": "Error",
			"stats.outcome.dropped-over-budget": "Dropped (over budget)",
			"stats.outcome.invalid-references": "Invalid references",
			"stats.winner.tie": "Tie",
			"stats.verdict.winner": "Winner {winner}",
			"stats.verdict.scoreThreshold": "Score {score} (threshold {threshold})",
			"stats.verdict.scoreOnly": "Score {score}",
			"metric.cacheHitRate": "Cache Hit Rate",
			"metric.cacheHitNote": "{hits} hits / {total} scored",
			"metric.tokens": "Tokens",
			"metric.tokensNote": "Input {input} · Output {output}",
			"metric.avgModelCalls": "Avg Model Calls",
			"metric.avgModelCallsNote": "{attempts} attempts · {retries} retries",
			"metric.scoringMode": "Scoring Mode",
			"metric.scoringModeNote": "Top-logprobs · Explicit tags {explicit}",
			"chart.title": "Daily Tool Calls & Model Requests Trend",
			"chart.ariaLabel": "Daily tool calls and model requests trend",
			"chart.legendToolCalls": "Tool Calls",
			"chart.legendModelCalls": "Model Requests",
			"table.title": "Tool Breakdown",
			"table.toolCount": "{count} Tool Types",
			"table.colTool": "Tool",
			"table.colInvocations": "Calls",
			"table.colSuccessRate": "Success Rate",
			"table.colAvgDuration": "Avg Duration",
			"table.colModelCalls": "Model Calls",
			"table.colTokens": "Tokens",
			"table.colCacheHits": "Cache Hits",
			"table.colEstimatedCost": "Estimated Cost",
			"table.empty": "No verifier tool calls found in the selected range. Subsequent executions will appear here automatically.",
			"recent.title": "Recent Invocations",
			"recent.maxCount": "Max 50",
			"recent.empty": "No records",
			"models.title": "Model Summary",
			"models.calls": "{calls} Requests",
			"models.tokens": "{tokens} Tokens",
			"models.empty": "No model calls",
			"slot.statistics": "Statistics",
			"slot.globalDashboard": "Verifier Dashboard",
			"global.panelTitle": "LLM Verifier Global Dashboard",
			"global.panelIntro": "Cross-session statistics, judge model metrics, and task acceptance overview.",
			"guide.verifier.title": "Verifier Stats",
			"guide.verifier.desc": "LLM verifier tool calls, duration and cost statistics",
			"field.autoVerifyTeamTasks.title": "Verify Team Tasks",
			"field.autoVerifyTeamTasks.help": "Automatically route progress and verify tasks when Agent Teams task status changes or completes.",
			"field.autoVerifyPlanMode.title": "Plan Mode Pre-verification",
			"field.autoVerifyPlanMode.help": "Automatically pre-verify plan feasibility and risks before exit_plan_mode presents it for user review.",
			"field.autoVerifySubagents.title": "Verify Subagent Sessions",
			"field.autoVerifySubagents.help": "Also run automatic routing and final acceptance on delegated child sessions. Off by default: child sessions are seeded with a real user message, so gating them spends extra judge budget and can repeatedly steer the subagent."
		};
		const dictionaries = {
			zh,
			en
		};
		const toolLabels = {
			zh: {
				verifier_route_classify: "路由分类",
				verifier_compare: "两项对比",
				verifier_select: "多项优选",
				verifier_track: "进度跟踪",
				verifier_current_session: "会话验收"
			},
			en: {
				verifier_route_classify: "Route Classification",
				verifier_compare: "Pairwise Comparison",
				verifier_select: "Candidate Selection",
				verifier_track: "Progress Tracking",
				verifier_current_session: "Session Acceptance"
			}
		};
		function tFormat(template, params) {
			if (!params) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => key in params ? String(params[key]) : match);
		}
		function detectLanguage() {
			if (typeof document === "undefined") return "en";
			return (document.documentElement.lang || "").toLowerCase().startsWith("zh") ? "zh" : "en";
		}
		function useLanguage() {
			const [lang, setLang] = (0, react.useState)(detectLanguage);
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const update = () => {
					setLang(detectLanguage());
				};
				update();
				const observer = new MutationObserver((mutations) => {
					for (const mutation of mutations) if (mutation.type === "attributes" && mutation.attributeName === "lang") update();
				});
				observer.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["lang"]
				});
				return () => observer.disconnect();
			}, []);
			return lang;
		}
		function compact(value, lang = "en") {
			const locale = lang === "zh" ? "zh-CN" : "en-US";
			return new Intl.NumberFormat(locale, {
				notation: value >= 1e4 ? "compact" : "standard",
				maximumFractionDigits: value >= 1e3 ? 1 : 0
			}).format(value);
		}
		function money(value) {
			return "$" + value.toLocaleString("en-US", {
				minimumFractionDigits: value < .01 ? 4 : 2,
				maximumFractionDigits: value < .01 ? 4 : 2
			});
		}
		function duration(value) {
			if (value < 1e3) return Math.round(value) + " ms";
			if (value < 6e4) return (value / 1e3).toFixed(1) + " s";
			return (value / 6e4).toFixed(1) + " min";
		}
		function dateTime(value, lang = "en") {
			const locale = lang === "zh" ? "zh-CN" : "en-US";
			return new Intl.DateTimeFormat(locale, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			}).format(value);
		}
		function resolveCacheDirOnSave(draft, previous) {
			if (typeof draft === "string" && draft.trim()) return draft.trim();
			if (typeof previous === "string" && previous.trim()) return previous.trim();
		}
		/**
		* Deep equality for JSON-shaped settings values, insensitive to object key
		* order and treating a missing key as `undefined`. The settings page compares a
		* draft against a resolved view that was built from a different object shape,
		* so identity comparison is never enough.
		*/
		function sameSettingValue(left, right) {
			if (left === right) return true;
			if (Array.isArray(left) && Array.isArray(right)) {
				if (left.length !== right.length) return false;
				for (let index = 0; index < left.length; index += 1) if (!sameSettingValue(left[index], right[index])) return false;
				return true;
			}
			if (Array.isArray(left) || Array.isArray(right)) return false;
			if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
			const a = left;
			const b = right;
			for (const key of /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])) if (!sameSettingValue(a[key], b[key])) return false;
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
		function sectionForSave(user, draft, base) {
			const section = { ...user };
			for (const [key, value] of Object.entries(draft)) {
				if (value === void 0 || base !== void 0 && sameSettingValue(value, base[key])) {
					delete section[key];
					continue;
				}
				section[key] = value;
			}
			return section;
		}
		/** An eight-candidate select: ring + pivot rounds (18 pairs) x three criteria, one repeat. */
		const WORST_CASE_ROUTE_CALLS_PER_JUDGE = 54;
		/** Final acceptance: three criteria x the default two repeats (one per A/B position). */
		const WORST_CASE_FINAL_CALLS_PER_JUDGE = 6;
		const WORST_CASE_TASK_PER_JUDGE = 60;
		const WORST_CASE_SESSION_PER_JUDGE = 160;
		function computeJudgeCount(extraJudgesCount) {
			return 1 + Math.max(0, extraJudgesCount);
		}
		function computeWorstCaseBudget(judgeCount) {
			const count = Math.max(1, judgeCount);
			return {
				worstCaseTask: count * 60,
				worstCaseSession: count * 160
			};
		}
		function evaluateBudgetWarning(autoVerifyMode, extraJudgesCount, autoMaxModelCallsPerTask, autoMaxModelCallsPerSession) {
			if (autoVerifyMode === "manual") return null;
			const judgeCount = computeJudgeCount(extraJudgesCount);
			const { worstCaseTask, worstCaseSession } = computeWorstCaseBudget(judgeCount);
			const warnTask = autoMaxModelCallsPerTask < worstCaseTask;
			const warnSession = autoMaxModelCallsPerSession < worstCaseSession;
			if (!warnTask && !warnSession) return null;
			return {
				judgeCount,
				worstCaseTask,
				worstCaseSession,
				warnTask,
				warnSession
			};
		}
		function isVerdictFailed(verdict, success = true) {
			if (!success) return true;
			if (!verdict) return false;
			return verdict.outcome === "below-threshold" || verdict.outcome === "error";
		}
		function formatPercentage(val) {
			if (!Number.isFinite(val)) return "--";
			return `${(val * 100).toFixed(1)}%`;
		}
		function formatVerdictDetails(verdict, t) {
			const isFailed = verdict.outcome === "below-threshold" || verdict.outcome === "error";
			const outcomeKey = verdict.outcome ? `stats.outcome.${verdict.outcome}` : void 0;
			const outcomeText = outcomeKey && t[outcomeKey] ? t[outcomeKey] : verdict.outcome;
			const phaseKey = verdict.phase ? `stats.phase.${verdict.phase}` : void 0;
			const phaseText = phaseKey && t[phaseKey] ? t[phaseKey] : verdict.phase;
			let scoreText;
			if (typeof verdict.score === "number") {
				const scorePct = formatPercentage(verdict.score);
				if (typeof verdict.threshold === "number") {
					const threshPct = formatPercentage(verdict.threshold);
					scoreText = tFormat(t["stats.verdict.scoreThreshold"], {
						score: scorePct,
						threshold: threshPct
					});
				} else scoreText = tFormat(t["stats.verdict.scoreOnly"], { score: scorePct });
			}
			let winnerText;
			if (verdict.winner) {
				const winnerValue = verdict.winner === "tie" ? t["stats.winner.tie"] : verdict.winner;
				winnerText = tFormat(t["stats.verdict.winner"], { winner: winnerValue });
			}
			return {
				outcomeText,
				phaseText,
				scoreText,
				winnerText,
				isFailed
			};
		}
		function normalizeExtraJudges(value) {
			if (!Array.isArray(value)) return [];
			const results = [];
			for (const item of value) {
				if (!item || typeof item !== "object" || Array.isArray(item)) continue;
				const raw = item;
				if (typeof raw.provider !== "string" || typeof raw.model !== "string") continue;
				const provider = raw.provider.trim();
				const model = raw.model.trim();
				if (!provider || !model) continue;
				const draft = {
					provider,
					model
				};
				if (typeof raw.reasoningEffort === "string") {
					const effort = raw.reasoningEffort.trim();
					if (effort) draft.reasoningEffort = effort;
				}
				if (typeof raw.label === "string") {
					const label = raw.label.trim();
					if (label) draft.label = label;
				}
				results.push(draft);
				if (results.length >= 4) break;
			}
			return results;
		}
		function judgeIdentity(provider, model) {
			return `${provider.trim()}/${model.trim()}`;
		}
		function judgeConflict(primary, judges) {
			const primaryId = primary.provider.trim() && primary.model.trim() ? judgeIdentity(primary.provider, primary.model) : void 0;
			const seen = /* @__PURE__ */ new Map();
			for (let i = 0; i < judges.length; i++) {
				const judge = judges[i];
				const p = judge.provider.trim();
				const m = judge.model.trim();
				if (!p || !m) continue;
				const id = judgeIdentity(p, m);
				if (primaryId !== void 0 && id === primaryId) return {
					index: i,
					duplicateOf: "primary"
				};
				const prev = seen.get(id);
				if (prev !== void 0) return {
					index: i,
					duplicateOf: prev
				};
				seen.set(id, i);
			}
		}
		function addExtraJudge(judges, draft) {
			if (judges.length >= 4) return [...judges];
			const item = {
				provider: draft.provider.trim(),
				model: draft.model.trim()
			};
			if (typeof draft.reasoningEffort === "string") {
				const effort = draft.reasoningEffort.trim();
				if (effort) item.reasoningEffort = effort;
			}
			if (typeof draft.label === "string") {
				const label = draft.label.trim();
				if (label) item.label = label;
			}
			return [...judges, item];
		}
		function removeExtraJudge(judges, index) {
			if (index < 0 || index >= judges.length) return [...judges];
			return judges.filter((_, i) => i !== index);
		}
		function serializeExtraJudges(judges) {
			const list = judges.slice(0, 4);
			const result = [];
			for (const judge of list) {
				const provider = judge.provider.trim();
				const model = judge.model.trim();
				if (!provider || !model) continue;
				const entry = {
					provider,
					model
				};
				if (typeof judge.reasoningEffort === "string") {
					const effort = judge.reasoningEffort.trim();
					if (effort) entry.reasoningEffort = effort;
				}
				if (typeof judge.label === "string") {
					const label = judge.label.trim();
					if (label) entry.label = label;
				}
				result.push(entry);
			}
			return result;
		}
		//#endregion
		//#region src/client.tsx
		const NS = "llm-verifier";
		const shell = {
			width: "100%",
			maxWidth: 720,
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: "0 0 32px",
			color: "var(--dsw-alias-label-primary)"
		};
		const settingsHeading = {
			margin: 0,
			fontSize: 16,
			fontWeight: 500,
			lineHeight: "24px",
			color: "var(--dsw-alias-label-primary)"
		};
		const settingsIntro = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const group = {
			width: "100%",
			display: "flex",
			flexDirection: "column",
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		const groupTitle = {
			margin: 0,
			padding: "18px 0 8px",
			fontSize: 14,
			fontWeight: 500,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)"
		};
		const row = {
			minHeight: 64,
			display: "grid",
			gridTemplateColumns: "minmax(180px, 1fr) minmax(230px, 288px)",
			gap: 24,
			alignItems: "center",
			padding: "12px 0",
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const selectStyle = {
			boxSizing: "border-box",
			width: "100%",
			height: 36,
			padding: "0 34px 0 12px",
			borderRadius: 8,
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-bg-input)",
			border: "1px solid var(--dsw-alias-border-l2)",
			font: "inherit",
			fontSize: 14,
			lineHeight: "22px",
			outline: "none"
		};
		const toggleStyle = (enabled) => ({
			position: "relative",
			justifySelf: "end",
			width: 40,
			height: 22,
			padding: 0,
			border: 0,
			borderRadius: 999,
			cursor: "pointer",
			transition: "background .15s ease",
			background: enabled ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-bg-input)"
		});
		const toggleThumbStyle = (enabled) => ({
			position: "absolute",
			top: 3,
			left: enabled ? 21 : 3,
			width: 16,
			height: 16,
			borderRadius: "50%",
			background: "var(--dsw-static-neutral-00, #fff)",
			boxShadow: "0 1px 3px rgba(0,0,0,.28)",
			transition: "left .15s ease"
		});
		const dashboardCard = {
			border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.13))",
			background: "color-mix(in srgb, var(--dsw-alias-bg-module, #171925) 88%, transparent)",
			borderRadius: 16,
			boxShadow: "0 12px 36px rgba(0,0,0,.12)"
		};
		const muted = {
			color: "var(--dsw-text-secondary)",
			fontSize: 12
		};
		const toolColors = {
			verifier_route_classify: "#d97706",
			verifier_compare: "#4f8cff",
			verifier_select: "#8b6df6",
			verifier_track: "#2fc5c9",
			verifier_current_session: "#f5a524"
		};
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function values(view) {
			const v = record(view.value);
			const mode = v.autoVerifyMode === "manual" || v.autoVerifyMode === "strict" ? v.autoVerifyMode : "smart";
			return {
				enabled: v.enabled !== false,
				autoVerifyMode: mode,
				autoVerifyThreshold: Number(v.autoVerifyThreshold ?? .65),
				autoVerifyRepeats: Number(v.autoVerifyRepeats ?? 1),
				autoVerifyFinalRepeats: Number(v.autoVerifyFinalRepeats ?? 2),
				autoVerifyMinToolCalls: Number(v.autoVerifyMinToolCalls ?? 3),
				autoVerifyMaxChars: Number(v.autoVerifyMaxChars ?? 8e4),
				autoVerifyMaxPerTask: Number(v.autoVerifyMaxPerTask ?? 2),
				autoVerifyMaxPerSession: Number(v.autoVerifyMaxPerSession ?? 8),
				autoRouteSemantic: v.autoRouteSemantic !== false,
				autoRouteMinConfidence: Number(v.autoRouteMinConfidence ?? .9),
				autoRouteMaxCandidates: Number(v.autoRouteMaxCandidates ?? 8),
				autoRouteMaxPerTask: Number(v.autoRouteMaxPerTask ?? 2),
				autoRouteMaxPerSession: Number(v.autoRouteMaxPerSession ?? 8),
				autoTrackCompletionThreshold: Number(v.autoTrackCompletionThreshold ?? .8),
				autoRouteMaxItemChars: Number(v.autoRouteMaxItemChars ?? 2e4),
				autoRouteMaxInputChars: Number(v.autoRouteMaxInputChars ?? 6e4),
				autoMaxModelCallsPerTask: Number(v.autoMaxModelCallsPerTask ?? 96),
				autoMaxModelCallsPerSession: Number(v.autoMaxModelCallsPerSession ?? 240),
				autoVerifyTeamTasks: v.autoVerifyTeamTasks !== false,
				autoVerifyPlanMode: v.autoVerifyPlanMode !== false,
				provider: String(v.provider ?? ""),
				model: String(v.model ?? ""),
				...typeof v.reasoningEffort === "string" ? { reasoningEffort: v.reasoningEffort } : {},
				maxTokens: Number(v.maxTokens ?? 32768),
				temperature: Number(v.temperature ?? .2),
				...typeof v.label === "string" && v.label.trim() ? { label: v.label.trim() } : {},
				maxConcurrency: Number(v.maxConcurrency ?? 8),
				maxRetries: Number(v.maxRetries ?? 3),
				retryBaseDelayMs: Number(v.retryBaseDelayMs ?? 500),
				timeoutMs: Number(v.timeoutMs ?? 3e5),
				cacheDir: typeof v.cacheDir === "string" && v.cacheDir.trim() ? v.cacheDir.trim() : "verifier",
				cacheMaxEntries: Number(v.cacheMaxEntries ?? 1e4),
				estimatedInputUsdPerMillion: Number(v.estimatedInputUsdPerMillion ?? 0),
				estimatedOutputUsdPerMillion: Number(v.estimatedOutputUsdPerMillion ?? 0),
				autoVerifySubagents: v.autoVerifySubagents === true,
				extraJudges: normalizeExtraJudges(v.extraJudges)
			};
		}
		function message(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** The endpoint answered but rejected the request: a transport fallback would only repeat it. */
		var EndpointError = class extends Error {};
		function Label({ title, help }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { minWidth: 0 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 14,
						fontWeight: 400,
						lineHeight: "22px",
						color: "var(--dsw-alias-label-primary)"
					},
					children: title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						lineHeight: "18px",
						color: "var(--dsw-alias-label-tertiary)",
						marginTop: 2
					},
					children: help
				})]
			});
		}
		function GroupTitle({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
				style: groupTitle,
				children
			});
		}
		function startOfRange(days) {
			const date = /* @__PURE__ */ new Date();
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() - days + 1);
			return date.getTime();
		}
		function endOfToday() {
			const date = /* @__PURE__ */ new Date();
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() + 1);
			return date.getTime();
		}
		function VerifierSettings({ remote }) {
			const t = dictionaries[useLanguage()];
			const [loaded, setLoaded] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [saved, setSaved] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)({});
			const load = async () => {
				setError(null);
				try {
					const [m, s] = await Promise.all([remote.session.modelCatalog(), remote.settings.describe()]);
					if (!m.ok) throw new Error(m.error.message);
					if (!s.ok) throw new Error(s.error.message);
					const view = s.value.namespaces.find((x) => x.ns === NS);
					if (!view) throw new Error(t["settings.nsUnregistered"]);
					const next = {
						groups: m.value.groups,
						settings: view,
						writable: s.value.writable,
						failures: m.value.failures.map((f) => (f.id ?? f.provider ?? f.name ?? "unknown") + ": " + f.message)
					};
					setLoaded(next);
					setDraft(values(view));
					setEditing({});
				} catch (e) {
					setError(message(e));
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, []);
			const dirty = (0, react.useMemo)(() => loaded !== null && draft !== null && !sameSettingValue(draft, values(loaded.settings)), [loaded, draft]);
			const latest = (0, react.useRef)({
				loaded,
				draft
			});
			latest.current = {
				loaded,
				draft
			};
			(0, react.useEffect)(() => {
				const sync = () => {
					if (document.visibilityState === "hidden") return;
					const { loaded: at, draft: local } = latest.current;
					if (!at || !local) return;
					if (!sameSettingValue(local, values(at.settings))) return;
					(async () => {
						try {
							const s = await remote.settings.describe();
							if (!s.ok) return;
							const view = s.value.namespaces.find((x) => x.ns === NS);
							if (!view || view.revision === at.settings.revision) return;
							const next = {
								...at,
								settings: view,
								writable: s.value.writable
							};
							latest.current = {
								loaded: next,
								draft: values(view)
							};
							setLoaded(next);
							setDraft(values(view));
							setEditing({});
							setSaved(false);
						} catch {}
					})();
				};
				window.addEventListener("focus", sync);
				document.addEventListener("visibilitychange", sync);
				return () => {
					window.removeEventListener("focus", sync);
					document.removeEventListener("visibilitychange", sync);
				};
			}, [remote]);
			const models = (0, react.useMemo)(() => loaded?.groups.find((g) => g.id === draft?.provider)?.models ?? [], [loaded, draft?.provider]);
			const efforts = models.find((m) => m.id === draft?.model)?.reasoning?.efforts ?? [];
			const patch = (key, value) => {
				setSaved(false);
				setDraft((v) => v ? {
					...v,
					[key]: value
				} : v);
			};
			const conflict = (0, react.useMemo)(() => draft ? judgeConflict({
				provider: draft.provider,
				model: draft.model
			}, draft.extraJudges) : void 0, [
				draft?.provider,
				draft?.model,
				draft?.extraJudges
			]);
			const addJudge = () => {
				if (!loaded || !draft || draft.extraJudges.length >= 4) return;
				const firstGroup = loaded.groups[0];
				const firstProvider = firstGroup?.id ?? "";
				const firstModelObj = firstGroup?.models[0];
				const firstModel = firstModelObj?.id ?? "";
				const defaultEffort = firstModelObj?.reasoning?.defaultEffort;
				const newJudge = {
					provider: firstProvider,
					model: firstModel,
					...defaultEffort ? { reasoningEffort: defaultEffort } : {}
				};
				patch("extraJudges", addExtraJudge(draft.extraJudges, newJudge));
			};
			const removeJudge = (idx) => {
				if (!draft) return;
				patch("extraJudges", removeExtraJudge(draft.extraJudges, idx));
			};
			const updateJudge = (idx, updates) => {
				if (!draft) return;
				const next = draft.extraJudges.map((j, i) => i === idx ? {
					...j,
					...updates
				} : j);
				patch("extraJudges", next);
			};
			const budgetWarning = (0, react.useMemo)(() => {
				if (!draft) return null;
				return evaluateBudgetWarning(draft.autoVerifyMode, draft.extraJudges.length, draft.autoMaxModelCallsPerTask, draft.autoMaxModelCallsPerSession);
			}, [
				draft?.autoVerifyMode,
				draft?.extraJudges.length,
				draft?.autoMaxModelCallsPerTask,
				draft?.autoMaxModelCallsPerSession
			]);
			const save = async () => {
				if (!loaded || !draft || conflict) return;
				setBusy(true);
				setSaved(false);
				setError(null);
				try {
					const editable = {
						...draft,
						extraJudges: serializeExtraJudges(draft.extraJudges),
						reasoningEffort: draft.reasoningEffort || void 0,
						label: draft.label?.trim() || void 0,
						cacheDir: resolveCacheDirOnSave(draft.cacheDir, values(loaded.settings).cacheDir)
					};
					const base = loaded.settings.base === void 0 ? void 0 : record(loaded.settings.base);
					const section = sectionForSave(record(loaded.settings.user), editable, base);
					const res = await remote.settings.update(NS, section, loaded.settings.revision);
					if (!res.ok) throw new Error(res.error.message);
					setLoaded((v) => v ? {
						...v,
						settings: res.value
					} : v);
					setDraft(values(res.value));
					setEditing({});
					setSaved(true);
				} catch (e) {
					setError(message(e));
				} finally {
					setBusy(false);
				}
			};
			if (!loaded || !draft) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: settingsHeading,
						children: t["settings.title"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: settingsIntro,
						children: error ?? t["settings.loading"]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: () => void load(),
						children: t["settings.retry"]
					}) })
				]
			});
			const numeric = (key, min = 0) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				style: {
					width: "100%",
					height: 36,
					borderRadius: 8
				},
				type: "text",
				inputMode: "decimal",
				disabled: busy,
				"aria-label": t["field." + key + ".title"] ?? String(key),
				value: editing[key] ?? String(draft[key] ?? ""),
				onChange: (e) => {
					const raw = e.target.value;
					setEditing((current) => current[key] === raw ? current : {
						...current,
						[key]: raw
					});
					const parsed = Number(raw);
					if (raw.trim() !== "" && Number.isFinite(parsed) && parsed >= min) patch(key, parsed);
				},
				onBlur: () => setEditing((current) => {
					if (!(key in current)) return current;
					const next = { ...current };
					delete next[key];
					return next;
				})
			});
			const textField = (key, placeholder) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				style: {
					width: "100%",
					height: 36,
					borderRadius: 8
				},
				type: "text",
				disabled: busy,
				placeholder,
				"aria-label": t["field." + key + ".title"] ?? String(key),
				value: String(draft[key] ?? ""),
				onChange: (e) => patch(key, e.target.value)
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: settingsHeading,
						children: t["settings.title"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: settingsIntro,
						children: t["settings.intro"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: t["section.tools"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.enabled.title"],
									help: draft.enabled ? t["field.enabled.helpOn"] : t["field.enabled.helpOff"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.enabled,
									"aria-label": t["field.enabled.title"],
									onClick: () => patch("enabled", !draft.enabled),
									style: toggleStyle(draft.enabled),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.enabled) })
								})]
							}),
							!draft.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "8px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: t["field.enabled.warnDisabled"]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: t["section.autoVerify"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyMode.title"],
									help: t["field.autoVerifyMode.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									style: selectStyle,
									disabled: busy,
									"aria-label": t["field.autoVerifyMode.title"],
									value: draft.autoVerifyMode,
									onChange: (e) => patch("autoVerifyMode", e.target.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "manual",
											children: t["field.autoVerifyMode.manual"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "smart",
											children: t["field.autoVerifyMode.smart"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "strict",
											children: t["field.autoVerifyMode.strict"]
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteSemantic.title"],
									help: t["field.autoRouteSemantic.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.autoRouteSemantic,
									"aria-label": t["field.autoRouteSemantic.title"],
									onClick: () => patch("autoRouteSemantic", !draft.autoRouteSemantic),
									style: toggleStyle(draft.autoRouteSemantic),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.autoRouteSemantic) })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyTeamTasks.title"],
									help: t["field.autoVerifyTeamTasks.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.autoVerifyTeamTasks,
									"aria-label": t["field.autoVerifyTeamTasks.title"],
									onClick: () => patch("autoVerifyTeamTasks", !draft.autoVerifyTeamTasks),
									style: toggleStyle(draft.autoVerifyTeamTasks),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.autoVerifyTeamTasks) })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifySubagents.title"],
									help: t["field.autoVerifySubagents.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.autoVerifySubagents,
									"aria-label": t["field.autoVerifySubagents.title"],
									onClick: () => patch("autoVerifySubagents", !draft.autoVerifySubagents),
									style: toggleStyle(draft.autoVerifySubagents),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.autoVerifySubagents) })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyPlanMode.title"],
									help: t["field.autoVerifyPlanMode.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.autoVerifyPlanMode,
									"aria-label": t["field.autoVerifyPlanMode.title"],
									onClick: () => patch("autoVerifyPlanMode", !draft.autoVerifyPlanMode),
									style: toggleStyle(draft.autoVerifyPlanMode),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.autoVerifyPlanMode) })
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMinConfidence.title"],
									help: t["field.autoRouteMinConfidence.help"]
								}), numeric("autoRouteMinConfidence", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMaxCandidates.title"],
									help: t["field.autoRouteMaxCandidates.help"]
								}), numeric("autoRouteMaxCandidates", 3)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMaxPerTask.title"],
									help: t["field.autoRouteMaxPerTask.help"]
								}), numeric("autoRouteMaxPerTask", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMaxPerSession.title"],
									help: t["field.autoRouteMaxPerSession.help"]
								}), numeric("autoRouteMaxPerSession", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoTrackCompletionThreshold.title"],
									help: t["field.autoTrackCompletionThreshold.help"]
								}), numeric("autoTrackCompletionThreshold", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMaxItemChars.title"],
									help: t["field.autoRouteMaxItemChars.help"]
								}), numeric("autoRouteMaxItemChars", 100)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoRouteMaxInputChars.title"],
									help: t["field.autoRouteMaxInputChars.help"]
								}), numeric("autoRouteMaxInputChars", 1e3)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoMaxModelCallsPerTask.title"],
									help: t["field.autoMaxModelCallsPerTask.help"]
								}), numeric("autoMaxModelCallsPerTask", 1)]
							}),
							budgetWarning?.warnTask && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "-4px 0 10px",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: tFormat(t["field.autoMaxModelCallsPerTask.warnBudget"], {
									current: draft.autoMaxModelCallsPerTask,
									required: budgetWarning.worstCaseTask,
									judges: budgetWarning.judgeCount
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoMaxModelCallsPerSession.title"],
									help: t["field.autoMaxModelCallsPerSession.help"]
								}), numeric("autoMaxModelCallsPerSession", 1)]
							}),
							budgetWarning?.warnSession && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "-4px 0 10px",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: tFormat(t["field.autoMaxModelCallsPerSession.warnBudget"], {
									current: draft.autoMaxModelCallsPerSession,
									required: budgetWarning.worstCaseSession,
									judges: budgetWarning.judgeCount
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyThreshold.title"],
									help: t["field.autoVerifyThreshold.help"]
								}), numeric("autoVerifyThreshold", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyRepeats.title"],
									help: t["field.autoVerifyRepeats.help"]
								}), numeric("autoVerifyRepeats", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyFinalRepeats.title"],
									help: t["field.autoVerifyFinalRepeats.help"]
								}), numeric("autoVerifyFinalRepeats", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyMinToolCalls.title"],
									help: t["field.autoVerifyMinToolCalls.help"]
								}), numeric("autoVerifyMinToolCalls", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyMaxChars.title"],
									help: t["field.autoVerifyMaxChars.help"]
								}), numeric("autoVerifyMaxChars", 1e3)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyMaxPerTask.title"],
									help: t["field.autoVerifyMaxPerTask.help"]
								}), numeric("autoVerifyMaxPerTask", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.autoVerifyMaxPerSession.title"],
									help: t["field.autoVerifyMaxPerSession.help"]
								}), numeric("autoVerifyMaxPerSession", 1)]
							}),
							draft.autoVerifyMode !== "manual" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "8px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: t["field.autoVerify.warnNotice"]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: t["section.model"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.provider.title"],
									help: t["field.provider.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									style: selectStyle,
									disabled: busy,
									"aria-label": t["field.provider.title"],
									value: draft.provider,
									onChange: (e) => {
										const provider = e.target.value;
										const first = loaded.groups.find((g) => g.id === provider)?.models[0];
										setDraft({
											...draft,
											provider,
											...first ? {
												model: first.id,
												reasoningEffort: first.reasoning?.defaultEffort
											} : {}
										});
									},
									children: loaded.groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: g.id,
										children: [
											g.name,
											" · ",
											g.id
										]
									}, g.id))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.model.title"],
									help: t["field.model.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									style: selectStyle,
									disabled: busy,
									"aria-label": t["field.model.title"],
									value: draft.model,
									onChange: (e) => {
										const model = e.target.value;
										const found = models.find((m) => m.id === model);
										setDraft({
											...draft,
											model,
											...found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: void 0 }
										});
									},
									children: models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: m.id,
										children: [
											m.name,
											" · ",
											m.id
										]
									}, m.id))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.reasoningEffort.title"],
									help: t["field.reasoningEffort.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									style: selectStyle,
									disabled: busy,
									"aria-label": t["field.reasoningEffort.title"],
									value: draft.reasoningEffort ?? "",
									onChange: (e) => patch("reasoningEffort", e.target.value || void 0),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t["field.reasoningEffort.default"]
									}), efforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: e.id,
										children: e.name
									}, e.id))]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.maxTokens.title"],
									help: t["field.maxTokens.help"]
								}), numeric("maxTokens", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.temperature.title"],
									help: t["field.temperature.help"]
								}), numeric("temperature", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.label.title"],
									help: t["field.label.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									style: {
										width: "100%",
										height: 36,
										borderRadius: 8
									},
									type: "text",
									disabled: busy,
									placeholder: draft.model || t["field.label.placeholder"],
									"aria-label": t["field.label.title"],
									value: draft.label ?? "",
									onChange: (e) => patch("label", e.target.value || void 0)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...row,
									gridTemplateColumns: "minmax(180px, 1fr) auto",
									minHeight: 48
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.extraJudges.title"],
									help: t["field.extraJudges.help"]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: busy || draft.extraJudges.length >= 4,
									onClick: addJudge,
									children: t["field.extraJudges.add"]
								})]
							}),
							draft.extraJudges.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8,
									padding: "10px 0",
									borderBottom: "1px solid var(--dsw-alias-border-l2)"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto",
										gap: 8,
										fontSize: 12,
										color: "var(--dsw-alias-label-tertiary)",
										paddingBottom: 2
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t["field.provider.title"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t["field.model.title"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t["field.reasoningEffort.title"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t["field.extraJudges.labelTitle"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {})
									]
								}), draft.extraJudges.map((judge, idx) => {
									const judgeModels = loaded.groups.find((g) => g.id === judge.provider)?.models ?? [];
									const judgeEfforts = judgeModels.find((m) => m.id === judge.model)?.reasoning?.efforts ?? [];
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "grid",
											gridTemplateColumns: "minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto",
											gap: 8,
											alignItems: "center"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												style: selectStyle,
												disabled: busy,
												"aria-label": tFormat(t["field.extraJudges.providerAria"], { index: idx + 1 }),
												value: judge.provider,
												onChange: (e) => {
													const newProvider = e.target.value;
													const firstM = loaded.groups.find((g) => g.id === newProvider)?.models[0];
													updateJudge(idx, {
														provider: newProvider,
														model: firstM?.id ?? "",
														...firstM?.reasoning?.defaultEffort ? { reasoningEffort: firstM.reasoning.defaultEffort } : { reasoningEffort: void 0 }
													});
												},
												children: [!loaded.groups.some((g) => g.id === judge.provider) && judge.provider && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: judge.provider,
													children: judge.provider
												}), loaded.groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
													value: g.id,
													children: [
														g.name,
														" · ",
														g.id
													]
												}, g.id))]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												style: selectStyle,
												disabled: busy,
												"aria-label": tFormat(t["field.extraJudges.modelAria"], { index: idx + 1 }),
												value: judge.model,
												onChange: (e) => {
													const newModel = e.target.value;
													const found = judgeModels.find((m) => m.id === newModel);
													updateJudge(idx, {
														model: newModel,
														...found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: void 0 }
													});
												},
												children: [!judgeModels.some((m) => m.id === judge.model) && judge.model && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: judge.model,
													children: judge.model
												}), judgeModels.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
													value: m.id,
													children: [
														m.name,
														" · ",
														m.id
													]
												}, m.id))]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												style: selectStyle,
												disabled: busy,
												"aria-label": tFormat(t["field.extraJudges.effortAria"], { index: idx + 1 }),
												value: judge.reasoningEffort ?? "",
												onChange: (e) => updateJudge(idx, { reasoningEffort: e.target.value || void 0 }),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t["field.reasoningEffort.default"]
												}), judgeEfforts.map((ef) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: ef.id,
													children: ef.name
												}, ef.id))]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												style: {
													width: "100%",
													height: 36,
													borderRadius: 8
												},
												type: "text",
												disabled: busy,
												placeholder: t["field.extraJudges.labelPlaceholder"],
												"aria-label": tFormat(t["field.extraJudges.labelAria"], { index: idx + 1 }),
												value: judge.label ?? "",
												onChange: (e) => updateJudge(idx, { label: e.target.value })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "outline",
												disabled: busy,
												"aria-label": tFormat(t["field.extraJudges.removeAria"], { index: idx + 1 }),
												onClick: () => removeJudge(idx),
												children: t["field.extraJudges.remove"]
											})
										]
									}, idx);
								})]
							}),
							conflict && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "8px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: conflict.duplicateOf === "primary" ? tFormat(t["field.extraJudges.conflictPrimary"], {
									index: conflict.index + 1,
									id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? "", draft.extraJudges[conflict.index]?.model ?? "")
								}) : tFormat(t["field.extraJudges.conflictDuplicate"], {
									index: conflict.index + 1,
									other: conflict.duplicateOf + 1,
									id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? "", draft.extraJudges[conflict.index]?.model ?? "")
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: t["section.execution"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.maxConcurrency.title"],
									help: t["field.maxConcurrency.help"]
								}), numeric("maxConcurrency", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.maxRetries.title"],
									help: t["field.maxRetries.help"]
								}), numeric("maxRetries", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.retryBaseDelayMs.title"],
									help: t["field.retryBaseDelayMs.help"]
								}), numeric("retryBaseDelayMs", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.timeoutMs.title"],
									help: t["field.timeoutMs.help"]
								}), numeric("timeoutMs", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.cacheDir.title"],
									help: t["field.cacheDir.help"]
								}), textField("cacheDir", "verifier")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.cacheMaxEntries.title"],
									help: t["field.cacheMaxEntries.help"]
								}), numeric("cacheMaxEntries", 1)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: t["section.cost"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.estimatedInputUsdPerMillion.title"],
									help: t["field.estimatedInputUsdPerMillion.help"]
								}), numeric("estimatedInputUsdPerMillion", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: t["field.estimatedOutputUsdPerMillion.title"],
									help: t["field.estimatedOutputUsdPerMillion.help"]
								}), numeric("estimatedOutputUsdPerMillion", 0)]
							})
						]
					}),
					loaded.failures.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 12px",
							borderRadius: 8,
							background: "var(--dsw-alias-state-warn-bg)",
							color: "var(--dsw-alias-state-warn-label)",
							fontSize: 12,
							lineHeight: "18px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontWeight: 500,
								marginBottom: 3
							},
							children: t["settings.catalogFailures"]
						}), loaded.failures.map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: x }, x))]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-error-primary)"
						},
						children: error
					}),
					saved && !dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-success-primary)"
						},
						children: t["settings.saved"]
					}),
					dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-warn-label)"
						},
						children: t["settings.unsaved"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "flex-end",
							gap: 8,
							paddingTop: 4
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: busy,
							onClick: () => void load(),
							children: t["settings.reload"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: busy || !loaded.writable || Boolean(conflict),
							onClick: () => void save(),
							children: busy ? t["settings.saving"] : t["settings.save"]
						})]
					})
				]
			});
		}
		function Metric({ label, value, note, accent }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...dashboardCard,
					padding: "16px 18px",
					minWidth: 0
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: muted,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 25,
							fontWeight: 750,
							lineHeight: 1.2,
							margin: "7px 0 5px",
							color: accent
						},
						children: value
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...muted,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						},
						children: note
					})
				]
			});
		}
		function TrendChart({ daily, days, lang }) {
			const t = dictionaries[lang];
			const rows = (0, react.useMemo)(() => {
				const map = new Map(daily.map((row) => [row.date, row]));
				const values = [];
				const start = new Date(startOfRange(days));
				for (let i = 0; i < days; i += 1) {
					const date = new Date(start);
					date.setDate(start.getDate() + i);
					const key = [
						date.getFullYear(),
						String(date.getMonth() + 1).padStart(2, "0"),
						String(date.getDate()).padStart(2, "0")
					].join("-");
					values.push(map.get(key) ?? {
						date: key,
						invocations: 0,
						successes: 0,
						failures: 0,
						calls: 0,
						tokens: 0,
						estimatedCostUsd: 0,
						byTool: {}
					});
				}
				return values;
			}, [daily, days]);
			const width = 760, height = 230, pad = {
				l: 44,
				r: 24,
				t: 20,
				b: 38
			};
			const innerW = width - pad.l - pad.r, innerH = height - pad.t - pad.b;
			const max = Math.max(1, ...rows.flatMap((row) => [row.invocations, row.calls]));
			const x = (index) => pad.l + (rows.length <= 1 ? innerW / 2 : index * innerW / (rows.length - 1));
			const y = (value) => pad.t + innerH - value / max * innerH;
			const points = rows.map((row, index) => `${x(index)},${y(row.calls)}`).join(" ");
			const step = rows.length > 16 ? Math.ceil(rows.length / 7) : Math.max(1, Math.ceil(rows.length / 7));
			const barWidth = Math.max(3, Math.min(18, innerW / Math.max(rows.length, 1) * .55));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					width: "100%",
					overflowX: "auto"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: `0 0 ${width} ${height}`,
					style: {
						display: "block",
						width: "100%",
						minWidth: 620,
						height: "auto"
					},
					"aria-label": t["chart.ariaLabel"],
					children: [
						[
							0,
							.25,
							.5,
							.75,
							1
						].map((ratio) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: pad.l,
							x2: width - pad.r,
							y1: pad.t + innerH * ratio,
							y2: pad.t + innerH * ratio,
							stroke: "rgba(148,163,184,.16)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
							x: pad.l - 8,
							y: pad.t + innerH * ratio + 4,
							textAnchor: "end",
							fontSize: "10",
							fill: "var(--dsw-text-secondary)",
							children: Math.round(max * (1 - ratio))
						})] }, ratio)),
						rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: x(index) - barWidth / 2,
							y: y(row.invocations),
							width: barWidth,
							height: pad.t + innerH - y(row.invocations),
							rx: "2",
							fill: "#4f8cff",
							opacity: ".82"
						}, row.date)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
							points,
							fill: "none",
							stroke: "#5ed7e8",
							strokeWidth: "2.4",
							strokeLinejoin: "round",
							strokeLinecap: "round"
						}),
						rows.map((row, index) => index % step === 0 || index === rows.length - 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("text", {
							x: x(index),
							y: height - 14,
							textAnchor: "middle",
							fontSize: "10",
							fill: "var(--dsw-text-secondary)",
							children: [
								Number(row.date.slice(5, 7)),
								"/",
								Number(row.date.slice(8, 10))
							]
						}, row.date) : null)
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						justifyContent: "center",
						gap: 18,
						...muted
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: 2,
						background: "#4f8cff",
						marginRight: 6
					} }), t["chart.legendToolCalls"]] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
						display: "inline-block",
						width: 14,
						height: 2,
						background: "#5ed7e8",
						marginRight: 6,
						verticalAlign: "middle"
					} }), t["chart.legendModelCalls"]] })]
				})]
			});
		}
		function StatisticsPage({ sessionId, rpc, isGlobal }) {
			const lang = useLanguage();
			const t = dictionaries[lang];
			const labels = toolLabels[lang];
			const [days, setDays] = (0, react.useState)(30);
			const [sessionOnly, setSessionOnly] = (0, react.useState)(!isGlobal && Boolean(sessionId));
			const [data, setData] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [refresh, setRefresh] = (0, react.useState)(0);
			const queryKey = days + "|" + sessionOnly + "|" + String(sessionId ?? "");
			const lastQueryKey = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setLoading(true);
				setError(null);
				if (lastQueryKey.current !== void 0 && lastQueryKey.current !== queryKey) setData(null);
				lastQueryKey.current = queryKey;
				const effectiveSessionId = sessionOnly && sessionId ? String(sessionId) : void 0;
				const queryPayload = {
					fromMs: startOfRange(days),
					toMs: endOfToday(),
					timezoneOffsetMinutes: (/* @__PURE__ */ new Date()).getTimezoneOffset(),
					recentLimit: 50,
					...effectiveSessionId ? { sessionId: effectiveSessionId } : {}
				};
				const fetchOverview = async () => {
					if (rpc && typeof rpc.call === "function") try {
						const result = await rpc.call("/api", "llm-verifier/statistics", queryPayload, controller.signal);
						if (result && result.ok) return result.value;
						if (result && result.ok === false) throw new EndpointError(result.error?.message ?? t["stats.requestFailed"]);
					} catch (rpcError) {
						if (controller.signal.aborted) throw rpcError;
						if (rpcError instanceof EndpointError) throw rpcError;
						console.warn("[llm-verifier] rpc.call failed, trying fetch fallback:", rpcError);
					}
					try {
						const response = await fetch("/api/llm-verifier/statistics", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(queryPayload),
							signal: controller.signal
						});
						if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText || t["stats.requestFailed"]}`);
						const data = await response.json();
						if (data && data.ok === true) return data.value;
						if (data && data.type === "server-response" && data.result?.ok === true) return data.result.value;
						throw new EndpointError(data?.error?.message ?? data?.result?.error?.message ?? t["stats.requestFailed"]);
					} catch (fetchError) {
						if (controller.signal.aborted) throw fetchError;
						if (fetchError instanceof EndpointError) throw fetchError;
						if (rpc && typeof rpc.call === "function") {
							const legacy = await rpc.call("/llm-verifier", "statistics", queryPayload, controller.signal);
							if (legacy && legacy.ok) return legacy.value;
						}
						throw fetchError;
					}
				};
				fetchOverview().then((overview) => {
					if (!controller.signal.aborted) setData(overview);
				}).catch((cause) => {
					if (!controller.signal.aborted) setError(message(cause));
				}).finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
				return () => controller.abort();
			}, [
				days,
				sessionOnly,
				sessionId,
				refresh,
				rpc,
				t,
				queryKey
			]);
			const totals = data?.totals;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
				style: {
					height: "100%",
					overflow: "auto",
					boxSizing: "border-box",
					padding: "22px clamp(16px, 3vw, 38px) 48px",
					color: "var(--dsw-text-primary)",
					background: "radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						maxWidth: 1180,
						margin: "0 auto",
						display: "flex",
						flexDirection: "column",
						gap: 16
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							style: {
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-start",
								gap: 16,
								flexWrap: "wrap"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 10
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										display: "grid",
										placeItems: "center",
										width: 34,
										height: 34,
										borderRadius: 10,
										background: "rgba(79,140,255,.14)",
										color: "#6da0ff"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, { size: 18 })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									style: {
										margin: 0,
										fontSize: 23
									},
									children: isGlobal ? t["global.panelTitle"] : t["stats.pageTitle"]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "7px 0 0 44px",
									...muted
								},
								children: isGlobal ? t["global.panelIntro"] : tFormat(t["stats.updatedAt"], { time: data ? dateTime(data.generatedAt, lang) : "--" })
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									alignItems: "center",
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											display: "flex",
											padding: 3,
											borderRadius: 10,
											background: "var(--dsw-surface-sunken)",
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))"
										},
										children: [
											7,
											30,
											90
										].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											"aria-pressed": days === value,
											onClick: () => setDays(value),
											style: {
												border: 0,
												borderRadius: 7,
												padding: "6px 10px",
												cursor: "pointer",
												color: days === value ? "#fff" : "var(--dsw-text-secondary)",
												background: days === value ? "#3f68d8" : "transparent"
											},
											children: tFormat(t["stats.daysUnit"], { days: value })
										}, value))
									}),
									Boolean(sessionId) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										"aria-pressed": sessionOnly,
										onClick: () => setSessionOnly((value) => !value),
										style: {
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))",
											borderRadius: 9,
											padding: "7px 11px",
											cursor: "pointer",
											color: "var(--dsw-text-primary)",
											background: sessionOnly ? "rgba(79,140,255,.18)" : "var(--dsw-surface-sunken)"
										},
										children: sessionOnly ? t["stats.currentSession"] : t["stats.allSessions"]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										title: t["stats.refresh"],
										onClick: () => setRefresh((value) => value + 1),
										style: {
											display: "grid",
											placeItems: "center",
											width: 34,
											height: 34,
											borderRadius: 9,
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))",
											color: "var(--dsw-text-primary)",
											background: "var(--dsw-surface-sunken)",
											cursor: "pointer"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 16 })
									})
								]
							})]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...dashboardCard,
								padding: 18,
								borderColor: "var(--dsw-danger, #e85858)",
								color: "var(--dsw-danger, #e85858)"
							},
							children: [error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									...muted,
									marginTop: 6
								},
								children: t["stats.hostRestartHint"]
							})]
						}),
						loading && !data ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...dashboardCard,
								padding: 32,
								textAlign: "center",
								...muted
							},
							children: t["stats.loading"]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "22px 24px",
									display: "grid",
									gridTemplateColumns: "minmax(220px,1.4fr) minmax(240px,1fr)",
									gap: 24,
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: muted,
										children: tFormat(t["stats.costSummary"], { days })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											fontSize: 38,
											fontWeight: 780,
											letterSpacing: "-.03em",
											margin: "5px 0"
										},
										children: money(totals?.estimatedCostUsd ?? 0)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: muted,
										children: tFormat(t["stats.callsSummary"], {
											invocations: compact(totals?.invocations ?? 0, lang),
											calls: compact(totals?.calls ?? 0, lang)
										})
									})
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "1fr auto",
										gap: "9px 16px",
										fontSize: 13
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: t["stats.successCalls"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
											compact(totals?.successes ?? 0, lang),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", {
												style: { color: "#77d49b" },
												children: [
													"▲ ",
													((totals?.successRate ?? 0) * 100).toFixed(1),
													"%"
												]
											})
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: t["stats.failedCalls"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: compact(totals?.failures ?? 0, lang) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: t["stats.avgDuration"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: duration(totals?.averageDurationMs ?? 0) })
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									display: "grid",
									gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
									gap: 12
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: t["metric.cacheHitRate"],
										value: ((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + "%",
										note: tFormat(t["metric.cacheHitNote"], {
											hits: compact(totals?.cacheHits ?? 0, lang),
											total: compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0), lang)
										}),
										accent: "#b7dd64"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: t["metric.tokens"],
										value: compact(totals?.tokens ?? 0, lang),
										note: tFormat(t["metric.tokensNote"], {
											input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang),
											output: compact(totals?.outputTokens ?? 0, lang)
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: t["metric.avgModelCalls"],
										value: (totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : "0",
										note: tFormat(t["metric.avgModelCallsNote"], {
											attempts: compact(totals?.attempts ?? 0, lang),
											retries: compact(totals?.retries ?? 0, lang)
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: t["metric.scoringMode"],
										value: compact(totals?.topLogprobScores ?? 0, lang),
										note: tFormat(t["metric.scoringModeNote"], { explicit: compact(totals?.explicitTagScores ?? 0, lang) })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "18px 20px 16px"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: 4
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t["chart.title"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: muted,
										children: sessionOnly ? t["stats.currentSession"] : t["stats.allSessions"]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrendChart, {
									daily: data?.daily ?? [],
									days,
									lang
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "18px 18px 8px",
									overflow: "hidden"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "space-between",
										margin: "0 2px 12px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t["table.title"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: muted,
										children: tFormat(t["table.toolCount"], { count: (data?.tools ?? []).length })
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: { overflowX: "auto" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
										style: {
											width: "100%",
											borderCollapse: "collapse",
											fontSize: 13,
											minWidth: 760
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
											style: {
												textAlign: "left",
												color: "var(--dsw-text-secondary)",
												background: "var(--dsw-surface-sunken)"
											},
											children: [
												t["table.colTool"],
												t["table.colInvocations"],
												t["table.colSuccessRate"],
												t["table.colAvgDuration"],
												t["table.colModelCalls"],
												t["table.colTokens"],
												t["table.colCacheHits"],
												t["table.colEstimatedCost"]
											].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
												style: {
													padding: "10px 12px",
													fontWeight: 500
												},
												children: value
											}, value))
										}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [(data?.tools ?? []).map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
											style: { borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))" },
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: { padding: "13px 12px" },
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
															display: "inline-block",
															width: 8,
															height: 8,
															borderRadius: "50%",
															background: toolColors[tool.toolName] ?? "#8691a8",
															marginRight: 8
														} }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: labels[tool.toolName] ?? tool.toolName }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															style: {
																...muted,
																margin: "3px 0 0 16px"
															},
															children: tool.toolName
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.invocations, lang)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: {
														padding: "13px 12px",
														color: tool.successRate >= .9 ? "#77d49b" : tool.successRate >= .7 ? "#e3bd63" : "#ed7777"
													},
													children: [(tool.successRate * 100).toFixed(1), "%"]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: duration(tool.averageDurationMs)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.calls, lang)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.tokens, lang)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: { padding: "13px 12px" },
													children: [
														tool.cacheHits,
														"/",
														tool.cacheHits + tool.cacheMisses
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: money(tool.estimatedCostUsd)
												})
											]
										}, tool.toolName)), (data?.tools.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											colSpan: 8,
											style: {
												padding: 28,
												textAlign: "center",
												...muted
											},
											children: t["table.empty"]
										}) })] })]
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									display: "grid",
									gridTemplateColumns: "minmax(0,1fr) minmax(290px,.45fr)",
									gap: 16,
									alignItems: "start"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...dashboardCard,
										padding: "18px 18px 8px",
										overflow: "hidden"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											justifyContent: "space-between",
											margin: "0 2px 12px"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t["recent.title"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: t["recent.maxCount"]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											maxHeight: 360,
											overflow: "auto"
										},
										children: [(data?.recent ?? []).map((item) => {
											const verdictInfo = item.verdict ? formatVerdictDetails(item.verdict, t) : void 0;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "grid",
													gridTemplateColumns: "minmax(170px,1fr) auto",
													gap: 12,
													padding: "11px 8px",
													borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))"
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: {
															display: "flex",
															alignItems: "center",
															gap: 8
														},
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
																width: 7,
																height: 7,
																borderRadius: "50%",
																background: !item.success || (verdictInfo ? verdictInfo.isFailed : false) ? "#e76565" : "#59c985"
															} }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
																style: { fontSize: 13 },
																children: labels[item.toolName] ?? item.toolName
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																style: muted,
																children: [
																	item.provider,
																	"/",
																	item.model
																]
															})
														]
													}),
													!item.success && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														title: item.errorMessage,
														style: {
															margin: "5px 0 0 15px",
															fontSize: 11,
															color: "#e76565",
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap"
														},
														children: item.errorMessage ?? item.errorName
													}),
													item.verdict && verdictInfo && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: {
															display: "flex",
															alignItems: "center",
															flexWrap: "wrap",
															gap: 6,
															margin: "6px 0 0 15px",
															fontSize: 11
														},
														children: [
															verdictInfo.outcomeText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	padding: "1px 5px",
																	borderRadius: 4,
																	fontWeight: 500,
																	fontSize: 11,
																	background: verdictInfo.isFailed ? "rgba(231,101,101,.16)" : item.verdict.outcome === "tie" ? "rgba(227,189,99,.16)" : "rgba(89,201,133,.16)",
																	color: verdictInfo.isFailed ? "#e76565" : item.verdict.outcome === "tie" ? "#e3bd63" : "#77d49b",
																	border: `1px solid ${verdictInfo.isFailed ? "rgba(231,101,101,.3)" : item.verdict.outcome === "tie" ? "rgba(227,189,99,.3)" : "rgba(89,201,133,.3)"}`
																},
																children: verdictInfo.outcomeText
															}),
															verdictInfo.phaseText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	padding: "1px 5px",
																	borderRadius: 4,
																	background: "var(--dsw-surface-sunken)",
																	color: "var(--dsw-text-secondary)",
																	border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))"
																},
																children: verdictInfo.phaseText
															}),
															verdictInfo.scoreText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: { color: typeof item.verdict.threshold === "number" && typeof item.verdict.score === "number" && item.verdict.score < item.verdict.threshold ? "#e76565" : "var(--dsw-text-primary)" },
																children: verdictInfo.scoreText
															}),
															verdictInfo.winnerText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: { color: "var(--dsw-text-secondary)" },
																children: verdictInfo.winnerText
															})
														]
													})
												] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: { textAlign: "right" },
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: { fontSize: 12 },
														children: duration(item.durationMs)
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														style: {
															...muted,
															marginTop: 3
														},
														children: dateTime(item.startedAt, lang)
													})]
												})]
											}, item.id);
										}), (data?.recent.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												padding: 24,
												textAlign: "center",
												...muted
											},
											children: t["recent.empty"]
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...dashboardCard,
										padding: "18px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t["models.title"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 10,
											display: "flex",
											flexDirection: "column",
											gap: 10
										},
										children: [(data?.models ?? []).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "11px 12px",
												borderRadius: 10,
												background: "var(--dsw-surface-sunken)"
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														fontWeight: 650,
														fontSize: 13,
														overflow: "hidden",
														textOverflow: "ellipsis"
													},
													children: model.model
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														...muted,
														marginTop: 3
													},
													children: model.provider
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														justifyContent: "space-between",
														marginTop: 9,
														fontSize: 12
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tFormat(t["models.calls"], { calls: compact(model.calls, lang) }) }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tFormat(t["models.tokens"], { tokens: compact(model.tokens, lang) }) }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: money(model.estimatedCostUsd) })
													]
												})
											]
										}, model.provider + "\0" + model.model)), (data?.models.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: muted,
											children: t["models.empty"]
										})]
									})]
								})]
							})
						] })
					]
				})
			});
		}
		function VerifierSidebarIcon({ size, active }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: size,
					height: size,
					color: active ? "var(--dsw-alias-brand-primary, #4f8cff)" : "currentColor"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, { size: Math.min(18, size) })
			});
		}
		function GlobalVerifierDashboard({ rpc }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatisticsPage, {
				rpc,
				isGlobal: true
			});
		}
		function RightSidebarVerifierPanel({ rpc, sessionId }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					height: "100%",
					overflow: "hidden",
					display: "flex",
					flexDirection: "column"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatisticsPage, {
					rpc,
					sessionId
				})
			});
		}
		function RightSidebarVerifierTitle() {
			const t = dictionaries[useLanguage()];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					fontSize: 13,
					fontWeight: 500
				},
				children: t["slot.statistics"]
			});
		}
		const inject = [
			"slots",
			"connection",
			"remote",
			"remote.session",
			"remote.settings"
		];
		function apply(ctx) {
			const connection = ctx.get("connection");
			const remote = ctx.remote;
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "llm-verifier",
				order: 35,
				label: "LLM Verifier",
				inject: () => ({ remote })
			}, VerifierSettings));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "llm-verifier-statistics",
				order: 30,
				label: () => detectLanguage() === "zh" ? zh["slot.statistics"] : en["slot.statistics"],
				inject: () => ({ rpc: connection.rpc })
			}, StatisticsPage));
			const VERIFIER_TAB_KIND = "llm-verifier";
			const VERIFIER_TAB_ID = "dsh-llm-verifier";
			const registerRightSidebar = (tabs) => {
				if (!tabs || typeof tabs.register !== "function") return void 0;
				try {
					const disposer = tabs.register({
						id: VERIFIER_TAB_ID,
						kind: VERIFIER_TAB_KIND,
						priority: "extension",
						title: () => detectLanguage() === "zh" ? zh["slot.statistics"] : en["slot.statistics"],
						guide: [{
							order: 45,
							title: () => detectLanguage() === "zh" ? zh["guide.verifier.title"] : en["guide.verifier.title"],
							description: () => detectLanguage() === "zh" ? zh["guide.verifier.desc"] : en["guide.verifier.desc"],
							icon: VerifierSidebarIcon
						}]
					});
					return typeof disposer === "function" ? disposer : void 0;
				} catch (error) {
					console.warn("[llm-verifier] sidebar tab registration failed:", error);
					return;
				}
			};
			if (typeof ctx.inject === "function") try {
				ctx.inject(["sidebarRightTabs"], (subCtx) => {
					const subTabs = typeof subCtx?.get === "function" ? subCtx.get("sidebarRightTabs") : subCtx?.sidebarRightTabs;
					const disposer = registerRightSidebar(subTabs);
					if (disposer) subCtx.effect(() => disposer);
				});
			} catch (error) {
				console.warn("[llm-verifier] sidebar tab injection failed:", error);
			}
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: VERIFIER_TAB_ID,
				inject: () => ({ rpc: connection.rpc })
			}, RightSidebarVerifierPanel));
			ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: VERIFIER_TAB_ID
			}, RightSidebarVerifierTitle));
		}
		//#endregion
		exports.GlobalVerifierDashboard = GlobalVerifierDashboard;
		exports.RightSidebarVerifierPanel = RightSidebarVerifierPanel;
		exports.RightSidebarVerifierTitle = RightSidebarVerifierTitle;
		exports.StatisticsPage = StatisticsPage;
		exports.VerifierSettings = VerifierSettings;
		exports.VerifierSidebarIcon = VerifierSidebarIcon;
		exports.WORST_CASE_FINAL_CALLS_PER_JUDGE = WORST_CASE_FINAL_CALLS_PER_JUDGE;
		exports.WORST_CASE_ROUTE_CALLS_PER_JUDGE = WORST_CASE_ROUTE_CALLS_PER_JUDGE;
		exports.WORST_CASE_SESSION_PER_JUDGE = WORST_CASE_SESSION_PER_JUDGE;
		exports.WORST_CASE_TASK_PER_JUDGE = WORST_CASE_TASK_PER_JUDGE;
		exports.apply = apply;
		exports.compact = compact;
		exports.computeJudgeCount = computeJudgeCount;
		exports.computeWorstCaseBudget = computeWorstCaseBudget;
		exports.dateTime = dateTime;
		exports.detectLanguage = detectLanguage;
		exports.dictionaries = dictionaries;
		exports.duration = duration;
		exports.en = en;
		exports.evaluateBudgetWarning = evaluateBudgetWarning;
		exports.formatPercentage = formatPercentage;
		exports.formatVerdictDetails = formatVerdictDetails;
		exports.inject = inject;
		exports.isVerdictFailed = isVerdictFailed;
		exports.money = money;
		exports.resolveCacheDirOnSave = resolveCacheDirOnSave;
		exports.sameSettingValue = sameSettingValue;
		exports.sectionForSave = sectionForSave;
		exports.tFormat = tFormat;
		exports.toolLabels = toolLabels;
		exports.useLanguage = useLanguage;
		exports.zh = zh;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map