import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Config, installVerifierSettings, resolveConfig } from './config.ts'
import { RequestLimiter } from './caller.ts'
import { TopLogprobCapabilityCache } from './top-logprobs.ts'
import { ScoreCache, resolveCacheFile } from './cache.ts'
import { VerifierEngine, normalizeCriteria, type RunStats } from './engine.ts'
import { loadVerifierImages } from './images.ts'
import { extractSession } from './session.ts'
import { AutoVerificationBudget, analyzeAutoTask, automaticFeedback } from './auto.ts'
import { StatisticsStore, emptyRunStats, errorDetails, resolveStatisticsFile, type StatisticsOverview, type VerifierToolName } from './statistics.ts'

export const name = 'llm-verifier'
export const inject = ['tools', 'agents', 'attachments', 'llm', 'connection']
export { Config }
export * from './core.ts'
export * from './engine.ts'
export * from './cache.ts'
export * from './statistics.ts'
export * from './auto.ts'
export { callVerifier, RequestLimiter, type VerifierClientConfig, type VerifierImage, type UsageStats, type VerifierCompletion } from './caller.ts'

const criterionSchema = { type: 'object' as const, additionalProperties: false, properties: { id: { type: 'string' as const, required: true as const }, name: { type: 'string' as const, required: true as const }, description: { type: 'string' as const, required: true as const } } }
const statsSchema = { type: 'object' as const, additionalProperties: false, properties: { calls: { type: 'integer' as const, required: true as const }, attempts: { type: 'integer' as const, required: true as const }, retries: { type: 'integer' as const, required: true as const }, inputTokens: { type: 'integer' as const, required: true as const }, cachedInputTokens: { type: 'integer' as const, required: true as const }, outputTokens: { type: 'integer' as const, required: true as const }, reasoningTokens: { type: 'integer' as const, required: true as const }, cacheHits: { type: 'integer' as const, required: true as const }, cacheMisses: { type: 'integer' as const, required: true as const }, estimatedCostUsd: { type: 'number' as const, required: true as const }, topLogprobScores: { type: 'integer' as const, required: true as const }, explicitTagScores: { type: 'integer' as const, required: true as const } } }
const criterionResultSchema = { type: 'object' as const, additionalProperties: false, properties: { id: { type: 'string' as const, required: true as const }, name: { type: 'string' as const, required: true as const }, scoreA: { type: 'number' as const, required: true as const }, scoreB: { type: 'number' as const, required: true as const } } }
const commonParams = { criteria: { type: 'array' as const, items: criterionSchema }, repeats: { type: 'integer' as const }, images: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input.' } }
function renderJson(value: unknown) { return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
function positive(value: number | undefined, fallback: number, field: string): number { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result <= 0) throw new Error('llm-verifier: ' + field + ' must be a positive integer'); return result }
function numberField(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function statsFrom(value: unknown): RunStats { if (typeof value !== 'object' || value === null || !('stats' in value)) return emptyRunStats(); const source = (value as { stats?: unknown }).stats; if (typeof source !== 'object' || source === null) return emptyRunStats(); const row = source as Record<string, unknown>; return { calls: numberField(row.calls, 0), attempts: numberField(row.attempts, 0), retries: numberField(row.retries, 0), inputTokens: numberField(row.inputTokens, 0), cachedInputTokens: numberField(row.cachedInputTokens, 0), outputTokens: numberField(row.outputTokens, 0), reasoningTokens: numberField(row.reasoningTokens, 0), cacheHits: numberField(row.cacheHits, 0), cacheMisses: numberField(row.cacheMisses, 0), estimatedCostUsd: numberField(row.estimatedCostUsd, 0), topLogprobScores: numberField(row.topLogprobScores, 0), explicitTagScores: numberField(row.explicitTagScores, 0) } }
function rpcSuccess<T>(value: T) { return { ok: true as const, value } }
function rpcFailure(message: string) { return { ok: false as const, error: { code: 'bad-request' as const, message, details: { issues: [] } } } }

interface SessionVerificationOptions { fromSeq?: number; toSeq?: number; includeAssistantText?: boolean; redactPatterns?: readonly string[]; maxChars?: number; repeats?: number }
interface SessionVerificationResult { sessionId: string; problem: string; score: number; baselineScore: number; winner: 'A' | 'B' | 'tie'; fromSeq: number; toSeq: number; omittedCharacters: number; calls: number; stats: RunStats }

export function apply(ctx: Context, config: Config = {}): void {
  const services = ctx as Context & { attachments: AttachmentStore; connection: HostConnectionHandle }
  const entry = resolveConfig(config)
  let limiter = new RequestLimiter(entry.maxConcurrency)
  const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency) })
  const cacheFile = resolveCacheFile(entry.cacheDir)
  const cache = new ScoreCache(cacheFile, entry.cacheMaxEntries)
  const statistics = new StatisticsStore(resolveStatisticsFile(cacheFile))
  const topLogprobCapabilities = new TopLogprobCapabilityCache()
  const autoBudget = new AutoVerificationBudget()
  const engine = async () => {
    const selected = current()
    await ctx.llm.resolveCallConfig({ provider: selected.provider, model: selected.model, ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort as never } : {}), maxTokens: selected.maxTokens })
    return { verifier: new VerifierEngine({ ...selected, ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities, limiter }, selected.maxConcurrency, cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }), selected }
  }
  const images = (values: readonly string[] | undefined, signal: AbortSignal) => loadVerifierImages(values, signal)
  const route = (selected: { provider: string; model: string }) => ({ provider: selected.provider, model: selected.model })
  const requireEnabled = () => { if (!current().enabled) throw new Error('llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier') }
  const record = async <T>(toolName: VerifierToolName, agent: { id: string } | undefined, operation: () => Promise<{ result: T; selected: { provider: string; model: string } }>): Promise<T & { provider: string; model: string }> => {
    const startedAt = Date.now()
    let selected: { provider: string; model: string } = current()
    try {
      const completed = await operation()
      selected = completed.selected
      const value = { ...completed.result as T & object, ...route(selected) } as T & { provider: string; model: string }
      await statistics.record({ toolName, ...(agent ? { sessionId: String(agent.id) } : {}), startedAt, success: true, provider: selected.provider, model: selected.model, stats: statsFrom(value) }).catch(() => {})
      return value
    } catch (error) {
      const details = errorDetails(error)
      await statistics.record({ toolName, ...(agent ? { sessionId: String(agent.id) } : {}), startedAt, success: false, ...details, provider: selected.provider, model: selected.model, stats: emptyRunStats() }).catch(() => {})
      throw error
    }
  }
  const verifySession = async (agent: Agent, options: SessionVerificationOptions, signal: AbortSignal): Promise<SessionVerificationResult & { provider: string; model: string }> => record('verifier_current_session', agent, async () => {
    const extracted = await extractSession(agent, async (ref: ImageAttachmentRef) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType } }, { fromSeq: options.fromSeq, toSeq: options.toSeq, includeAssistantText: options.includeAssistantText, redactPatterns: options.redactPatterns, maxChars: options.maxChars })
    const { verifier, selected } = await engine()
    const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: '(No useful work or verification was performed.)', repeats: positive(options.repeats, 2, 'repeats'), images: extracted.images }, signal)
    const result: SessionVerificationResult = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats }
    return { result, selected }
  })

  ctx.effect(() => services.connection.rpc.handle('/llm-verifier', async (endpoint: string, payload: unknown) => {
    if (endpoint !== 'statistics') return rpcFailure('unknown llm-verifier endpoint')
    if (typeof payload !== 'object' || payload === null) return rpcFailure('statistics payload must be an object')
    const row = payload as Record<string, unknown>
    const sessionId = typeof row.sessionId === 'string' && row.sessionId.length > 0 ? row.sessionId : undefined
    try {
      const value: StatisticsOverview = await statistics.overview({ fromMs: numberField(row.fromMs, Number.NaN), toMs: numberField(row.toMs, Number.NaN), timezoneOffsetMinutes: numberField(row.timezoneOffsetMinutes, 0), recentLimit: numberField(row.recentLimit, 40), ...(sessionId ? { sessionId } : {}) })
      return rpcSuccess(value)
    } catch (error) { return rpcFailure(error instanceof Error ? error.message : String(error)) }
  }, { authority: 'loopback' }), 'llm-verifier: statistics rpc')

  ctx.on('agent/disposed', ({ agent }) => { autoBudget.release(agent) })
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const selected = current()
    if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted) return
    const evidence = analyzeAutoTask(agent.session.events, { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession })
    if (!autoBudget.claim(agent, evidence, { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession })) return
    try {
      const result = await verifySession(agent, { fromSeq: evidence.taskStartSeq, includeAssistantText: true, maxChars: selected.autoVerifyMaxChars, repeats: selected.autoVerifyRepeats }, signal)
      const passed = result.winner === 'A' && result.score >= selected.autoVerifyThreshold
      if (!passed) agent.steer(createUserMessage({ content: [{ type: 'text', text: automaticFeedback(result.score, result.baselineScore, result.winner, selected.autoVerifyThreshold) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
    } catch (error) {
      ctx.logger.warn('llm-verifier automatic session verification failed: ' + (error instanceof Error ? error.message : String(error)))
      if (selected.autoVerifyMode === 'strict' && !signal.aborted) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nThe required strict verification could not run: ' + (error instanceof Error ? error.message : String(error)) + '\nInspect the task evidence and run a directly relevant verification command before concluding.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
    }
  })

  ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings, with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); return record('verifier_compare', exec.agent, async () => { const { verifier, selected } = await engine(); const result = await verifier.compare({ problem: args.problem, candidateA: args.candidate_a, candidateB: args.candidate_b, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); return record('verifier_select', exec.agent, async () => { const { verifier, selected } = await engine(); const result = await verifier.select({ problem: args.problem, candidates: args.candidates, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), pivots: positive(args.pivots, 2, 'pivots'), seed: args.seed ?? 0, images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); return record('verifier_track', exec.agent, async () => { const { verifier, selected } = await engine(); const result = await verifier.track(args.problem, args.steps, args.checkpoints, positive(args.repeats, 2, 'repeats'), exec.signal, await images(args.images, exec.signal)); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = exec.agent ?? ctx.agents.currentInitiator(); if (agent === undefined) throw new Error('llm-verifier: verifier_current_session requires an agent-owned tool call'); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars, repeats: args.repeats }, exec.signal) } }))
}
