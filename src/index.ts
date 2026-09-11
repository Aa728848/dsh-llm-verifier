import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { Config, installVerifierSettings, resolveConfig } from './config.ts'
import { RequestLimiter, callVerifierText, type VerifierClientConfig } from './caller.ts'
import { TopLogprobCapabilityCache, resolveCapabilityFile } from './top-logprobs.ts'
import { ScoreCache, SingleFlight, resolveCacheFile, stableHash, type CachedPairScore } from './cache.ts'
import { VerifierEngine, normalizeCriteria, type JudgeScore, type RunStats } from './engine.ts'
import { loadVerifierImages } from './images.ts'
import { extractSession, sanitizeVerifierText, sessionEvents } from './session.ts'
import { analyzeAutoTask, automaticFeedback, isSubagentSession } from './auto.ts'
import { AutoVerifierRouter, analyzeStructuredRoute, boundDecision, buildSemanticRoutePrompt, estimateRoutedCalls, parseSemanticRoute, semanticDecision, semanticRouteHint, type RouteDecision } from './router.ts'
import { DEFAULT_CRITERIA } from './core.ts'
import { buildPlanPreReviewPrompt, parseVerdictLetter, planFromArguments } from './plan-gate.ts'
import { inspectTeamTasks, buildTeamTaskVerificationPrompt } from './team-gate.ts'
import { StatisticsStore, emptyRunStats, errorDetails, mergeStatisticsOverviews, parseStatisticsQuery, resolveStatisticsFile, type StatisticsOverview, type VerifierToolName, type VerdictSummary } from './statistics.ts'
import { resolveTopicDataDir, type SessionArtifactLocator } from './topic-storage.ts'

export const name = 'llm-verifier'
export const inject = ['tools', 'agents', 'attachments', 'llm', 'connection', 'sessionPersistence']
export { Config }
export * from './core.ts'
export * from './engine.ts'
export * from './cache.ts'
export * from './statistics.ts'
export * from './topic-storage.ts'
export * from './auto.ts'
export * from './router.ts'
export * from './plan-gate.ts'
export * from './team-gate.ts'
export { callVerifier, RequestLimiter, type VerifierClientConfig, type VerifierImage, type UsageStats, type VerifierCompletion } from './caller.ts'

const criterionSchema = { type: 'object' as const, additionalProperties: false, properties: { id: { type: 'string' as const, required: true as const }, name: { type: 'string' as const, required: true as const }, description: { type: 'string' as const, required: true as const } } }
const statsSchema = { type: 'object' as const, additionalProperties: false, properties: { calls: { type: 'integer' as const, required: true as const }, attempts: { type: 'integer' as const, required: true as const }, retries: { type: 'integer' as const, required: true as const }, inputTokens: { type: 'integer' as const, required: true as const }, cachedInputTokens: { type: 'integer' as const, required: true as const }, outputTokens: { type: 'integer' as const, required: true as const }, reasoningTokens: { type: 'integer' as const, required: true as const }, cacheHits: { type: 'integer' as const, required: true as const }, cacheMisses: { type: 'integer' as const, required: true as const }, estimatedCostUsd: { type: 'number' as const, required: true as const }, topLogprobScores: { type: 'integer' as const, required: true as const }, explicitTagScores: { type: 'integer' as const, required: true as const } } }
const criterionResultSchema = { type: 'object' as const, additionalProperties: false, properties: { id: { type: 'string' as const, required: true as const }, name: { type: 'string' as const, required: true as const }, scoreA: { type: 'number' as const, required: true as const }, scoreB: { type: 'number' as const, required: true as const } } }
const commonParams = { criteria: { type: 'array' as const, items: criterionSchema }, repeats: { type: 'integer' as const }, images: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input.' } }
function renderJson(value: unknown) { return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
function positive(value: number | undefined, fallback: number, field: string): number { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result <= 0) throw new Error('llm-verifier: ' + field + ' must be a positive integer'); return result }
function capped(value: number | undefined, fallback: number, maximum: number, field: string): number { const result = positive(value, fallback, field); if (result > maximum) throw new Error('llm-verifier: ' + field + ' must be at most ' + maximum); return result }
/** Hard ceilings for explicitly supplied evidence: the tools are model-driven, so they need their own bounds. */
const MAX_EXPLICIT_REPEATS = 8
const MAX_TRACK_STEPS = 32
const MAX_SESSION_CHARS = 2_000_000
/**
 * Redact, bound and validate one batch of caller-supplied evidence strings.
 * @param values - raw tool arguments in order.
 * @param maxItemChars - per-item character cap after redaction.
 * @param maxTotalChars - combined character cap across all items.
 * @param field - argument name used in error messages.
 * @returns Sanitized evidence in the original order.
 */
function explicitEvidence(values: readonly string[], maxItemChars: number, maxTotalChars: number, field: string): string[] {
  const items = values.map((value, index) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('llm-verifier: ' + field + '[' + index + '] must be a non-empty string')
    return sanitizeVerifierText(value, maxItemChars)
  })
  const total = items.reduce((sum, item) => sum + item.length, 0)
  if (total > maxTotalChars) throw new Error('llm-verifier: ' + field + ' is ' + total + ' characters after redaction; keep the combined evidence under ' + maxTotalChars + ' characters')
  return items
}
/**
 * Bounds for explicitly supplied evidence. The auto-routing knobs are reused as
 * a floor, never as a ceiling: tightening automatic routing must not silently
 * truncate a caller's explicit evidence, but the tools still need a hard bound.
 */
const EXPLICIT_MIN_ITEM_CHARS = 20_000
/**
 * Hard ceiling for the combined evidence of one explicit tool call. The previous
 * 600k ceiling could overflow the judge's context window before it compared
 * anything, so the cap is a fixed budget (~60k tokens) with an actionable error.
 */
const EXPLICIT_MAX_TOTAL_CHARS = 240_000
const EXPLICIT_MIN_TOTAL_CHARS = 120_000
const MAX_EXPLICIT_CANDIDATES = 16
const MAX_EXPLICIT_PLANNED_CALLS = 500
interface EvidenceBounds { autoRouteMaxItemChars: number; autoRouteMaxInputChars: number }
function explicitItemChars(selected: EvidenceBounds): number { return Math.max(selected.autoRouteMaxItemChars, EXPLICIT_MIN_ITEM_CHARS) }
function explicitBudget(selected: EvidenceBounds): number { return Math.min(Math.max(selected.autoRouteMaxInputChars * 2, EXPLICIT_MIN_TOTAL_CHARS), EXPLICIT_MAX_TOTAL_CHARS) }
function explicitCandidateLimit(selected: EvidenceBounds & { autoRouteMaxCandidates: number }): number { return Math.max(selected.autoRouteMaxCandidates, MAX_EXPLICIT_CANDIDATES) }
/** Ring + pivot-round comparisons for an explicitly requested selection. */
function plannedComparisons(count: number): number { return count <= 2 ? 1 : count + Math.max(0, (count - 2) * 2 + 1 - 3) }
function numberField(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function statsFrom(value: unknown): RunStats { if (typeof value !== 'object' || value === null || !('stats' in value)) return emptyRunStats(); const source = (value as { stats?: unknown }).stats; if (typeof source !== 'object' || source === null) return emptyRunStats(); const row = source as Record<string, unknown>; return { calls: numberField(row.calls, 0), attempts: numberField(row.attempts, 0), retries: numberField(row.retries, 0), inputTokens: numberField(row.inputTokens, 0), cachedInputTokens: numberField(row.cachedInputTokens, 0), outputTokens: numberField(row.outputTokens, 0), reasoningTokens: numberField(row.reasoningTokens, 0), cacheHits: numberField(row.cacheHits, 0), cacheMisses: numberField(row.cacheMisses, 0), estimatedCostUsd: numberField(row.estimatedCostUsd, 0), topLogprobScores: numberField(row.topLogprobScores, 0), explicitTagScores: numberField(row.explicitTagScores, 0) } }
/**
 * One judge's contribution to a verdict.
 *
 * Only `provider`/`model`/`label`/`ok`/`calls` are always present: a judge that
 * failed a job carries no score, so every score field is optional and the engine
 * omits it instead of assigning undefined.
 */
const judgeScoreSchema = { type: 'object' as const, additionalProperties: false, properties: { provider: { type: 'string' as const, required: true as const }, model: { type: 'string' as const, required: true as const }, label: { type: 'string' as const, required: true as const }, ok: { type: 'boolean' as const, required: true as const }, calls: { type: 'integer' as const, required: true as const }, error: { type: 'string' as const }, scoreA: { type: 'number' as const }, scoreB: { type: 'number' as const }, winner: { type: 'string' as const, enum: ['A', 'B', 'tie'] as const }, scores: { type: 'array' as const, items: { type: 'number' as const } }, ranking: { type: 'array' as const, items: { type: 'integer' as const } } } }
const judgesSchema = { type: 'array' as const, items: judgeScoreSchema, required: true as const }
function rpcSuccess<T>(value: T) { return { ok: true as const, value } }
function rpcFailure(message: string) { return { ok: false as const, error: { code: 'bad-request' as const, message, details: { issues: [] } } } }

interface SessionVerificationOptions { fromSeq?: number; toSeq?: number; includeAssistantText?: boolean; redactPatterns?: readonly string[]; maxChars?: number; repeats?: number }
interface SessionVerificationResult { sessionId: string; problem: string; score: number; baselineScore: number; winner: 'A' | 'B' | 'tie'; fromSeq: number; toSeq: number; omittedCharacters: number; calls: number; stats: RunStats; judges: JudgeScore[]; agreement: number }

export function apply(ctx: Context, config: Config = {}): void {
  const services = ctx as Context & { attachments: AttachmentStore; connection: HostConnectionHandle; sessionPersistence: SessionArtifactLocator & { list(signal?: AbortSignal): Promise<readonly unknown[]> } }
  const entry = resolveConfig(config)
  let limiter = new RequestLimiter(entry.maxConcurrency)
  const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency) })
  const autoRouter = new AutoVerifierRouter()
  const topics = new Map<string, { dataDir: string; cache: ScoreCache; capabilities: TopLogprobCapabilityCache; flights: SingleFlight<{ value: CachedPairScore; hit: boolean }>; statistics: StatisticsStore }>()
  const topic = (header: SessionHeader) => {
    const selected = current()
    const dataDir = resolveTopicDataDir(services.sessionPersistence, header, selected.cacheDir)
    const id = String(header.id)
    const existing = topics.get(id)
    if (existing?.dataDir === dataDir) return existing
    const cacheFile = resolveCacheFile(dataDir)
    const created = { dataDir, cache: new ScoreCache(cacheFile, selected.cacheMaxEntries), capabilities: new TopLogprobCapabilityCache(resolveCapabilityFile(dataDir)), flights: new SingleFlight<{ value: CachedPairScore; hit: boolean }>(), statistics: new StatisticsStore(resolveStatisticsFile(cacheFile)) }
    topics.set(id, created)
    return created
  }
  const requireAgent = (agent: Agent | undefined): Agent => {
    const selected = agent ?? ctx.agents.currentInitiator()
    if (selected === undefined) throw new Error('llm-verifier: verifier tools require an agent-owned topic so their data can follow topic deletion')
    return selected
  }
  const engine = async (agent: Agent) => {
    const selected = current()
    const topicEntry = topic(agent.session.header)
    // One client per configured judge: the judge identity is part of the scoring
    // cache key, so each judge caches and de-duplicates independently. `judges[0]`
    // is the primary, which keeps a single-judge configuration on exactly the old path.
    const clients: VerifierClientConfig[] = []
    for (const judge of selected.judges) {
      await ctx.llm.resolveCallConfig({ provider: judge.provider, model: judge.model, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort as never } : {}), maxTokens: judge.maxTokens })
      clients.push({ ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities: topicEntry.capabilities, provider: judge.provider, model: judge.model, temperature: selected.temperature, label: judge.label, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort } : {}), maxTokens: judge.maxTokens, timeoutMs: selected.timeoutMs, maxRetries: selected.maxRetries, retryBaseDelayMs: selected.retryBaseDelayMs, limiter })
    }
    return { verifier: new VerifierEngine(clients, selected.maxConcurrency, topicEntry.cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }, topicEntry.flights), selected }
  }
  const images = (values: readonly string[] | undefined, signal: AbortSignal) => loadVerifierImages(values, signal)
  const route = (selected: { provider: string; model: string }) => ({ provider: selected.provider, model: selected.model })
  const requireEnabled = () => { if (!current().enabled) throw new Error('llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier') }
  /**
   * Compact summary of what the judges decided, stored beside the call counters so
   * the dashboard can answer "why did this fail?" instead of only "how much did it cost".
   * @param toolName - the verifier tool that produced the value.
   * @param value - its rendered result.
   * @param phase - which stage produced it (explicit | compare | select | track | final | ...).
   * @returns A verdict summary; score fields are omitted when the tool has none.
   */
  const verdictFrom = (toolName: VerifierToolName, value: unknown, phase: string): VerdictSummary => {
    const selected = current()
    const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    const numberAt = (key: string): number | undefined => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined)
    const scores = Array.isArray(row.scores) ? row.scores.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : []
    const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'tie' ? row.winner : undefined
    if (toolName === 'verifier_route_classify') return { phase, outcome: 'classified' }
    if (toolName === 'verifier_select') {
      const index = numberAt('index')
      const best = index === undefined ? undefined : scores[index]
      return { phase, outcome: 'ranked', ...(best !== undefined ? { score: best } : {}) }
    }
    if (toolName === 'verifier_track') {
      const worst = scores.length > 0 ? Math.min(...scores) : undefined
      const threshold = selected.autoTrackCompletionThreshold
      return { phase, outcome: worst !== undefined && worst >= threshold ? 'passed' : 'below-threshold', ...(worst !== undefined ? { score: worst } : {}), threshold }
    }
    const score = numberAt('score') ?? numberAt('scoreA')
    const baselineScore = numberAt('baselineScore')
    const threshold = selected.autoVerifyThreshold
    const outcome = winner === 'tie' ? 'tie' : winner === 'A' && score !== undefined && score >= threshold ? 'passed' : 'below-threshold'
    return { phase, outcome, ...(score !== undefined ? { score } : {}), ...(baselineScore !== undefined ? { baselineScore } : {}), ...(winner !== undefined ? { winner } : {}), threshold }
  }
  const record = async <T>(toolName: VerifierToolName, agent: Agent, operation: () => Promise<{ result: T; selected: { provider: string; model: string } }>, phase = 'explicit'): Promise<T & { provider: string; model: string }> => {
    const startedAt = Date.now()
    let selected: { provider: string; model: string } = current()
    const statistics = topic(agent.session.header).statistics
    try {
      const completed = await operation()
      selected = completed.selected
      const value = { ...completed.result as T & object, ...route(selected) } as T & { provider: string; model: string }
      await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: true, provider: selected.provider, model: selected.model, stats: statsFrom(value), verdict: verdictFrom(toolName, value, phase) }).catch(() => {})
      return value
    } catch (error) {
      const details = errorDetails(error)
      await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: false, ...details, provider: selected.provider, model: selected.model, stats: emptyRunStats(), verdict: { phase, outcome: 'error' } }).catch(() => {})
      throw error
    }
  }
  const verifySession = async (agent: Agent, options: SessionVerificationOptions, signal: AbortSignal, phase = 'explicit'): Promise<SessionVerificationResult & { provider: string; model: string }> => record('verifier_current_session', agent, async () => {
    const extracted = await extractSession(agent, async (ref: ImageAttachmentRef) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType } }, { fromSeq: options.fromSeq, toSeq: options.toSeq, includeAssistantText: options.includeAssistantText, redactPatterns: options.redactPatterns, maxChars: options.maxChars })
    if (!extracted.problem.trim()) throw new Error('llm-verifier: no direct user task found in the selected session range — widen from_seq so the task statement is included')
    const { verifier, selected } = await engine(agent)
    const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: '(No useful work or verification was performed.)', repeats: positive(options.repeats, 2, 'repeats'), images: extracted.images }, signal)
    const result: SessionVerificationResult = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats, judges: compared.judges, agreement: compared.agreement }
    return { result, selected }
  }, phase)
  const compareCandidates = async (agent: Agent, problem: string, candidateA: string, candidateB: string, repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = [], phase = 'explicit') => record('verifier_compare', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.compare({ problem, candidateA, candidateB, repeats, images: routedImages }, signal), selected }
  }, phase)
  const selectCandidates = async (agent: Agent, problem: string, candidates: readonly string[], repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = [], phase = 'explicit') => record('verifier_select', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.select({ problem, candidates, repeats, pivots: Math.min(2, candidates.length), seed: 0, images: routedImages }, signal), selected }
  }, phase)
  const trackProgress = async (agent: Agent, problem: string, steps: readonly string[], checkpoints: readonly number[], repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = [], phase = 'explicit') => record('verifier_track', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.track(problem, steps, checkpoints, repeats, signal, routedImages), selected }
  }, phase)
  const classifyRoute = async (agent: Agent, prompt: string, signal: AbortSignal, phase: string) => record('verifier_route_classify', agent, async () => {
    const { verifier, selected } = await engine(agent)
    const completion = await callVerifierText(verifier.client, prompt, signal)
    const stats: RunStats = { ...completion.usage, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: ((completion.usage.inputTokens + completion.usage.cachedInputTokens) * selected.estimatedInputUsdPerMillion + completion.usage.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000, topLogprobScores: 0, explicitTagScores: 1 }
    return { result: { text: completion.text, stats }, selected }
  }, phase)
  const extractTask = async (agent: Agent, fromSeq: number, toSeq: number, maxChars: number, signal: AbortSignal) => extractSession(agent, async (ref: ImageAttachmentRef) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType } }, { fromSeq, toSeq, includeAssistantText: true, maxChars })
  const routePolicy = (selected: ReturnType<typeof current>) => ({ mode: selected.autoVerifyMode, minConfidence: selected.autoRouteMinConfidence, maxCandidates: selected.autoRouteMaxCandidates, maxPerTask: selected.autoRouteMaxPerTask + selected.autoVerifyMaxPerTask, maxPerSession: selected.autoRouteMaxPerSession + selected.autoVerifyMaxPerSession, maxModelCallsPerTask: selected.autoMaxModelCallsPerTask, maxModelCallsPerSession: selected.autoMaxModelCallsPerSession, maxInputChars: selected.autoRouteMaxInputChars, maxItemChars: selected.autoRouteMaxItemChars })
  const routeFeedback = (decision: RouteDecision, detail: string) => createUserMessage({ content: [{ type: 'text' as const, text: '[Automatic verifier routing: ' + decision.kind + ']\n' + detail + '\nUse this independent result to continue the actual task. Do not merely restate the ranking or progress score; implement, correct, and verify the required work.' }], source: { kind: 'plugin' as const, plugin: 'dsh-llm-verifier', form: 'notice' as const, summary: 'Automatic verifier routed ' + decision.kind } })

  const handleStatisticsQuery = async (payload: unknown): Promise<{ ok: true; value: StatisticsOverview } | { ok: false; error: { code: 'bad-request'; message: string; details: { issues: never[] } } }> => {
    // A malformed range used to be swallowed by the Promise.allSettled fan-out below and
    // answered as an empty "success" with a NaN range, so validate the payload up front.
    const parsed = parseStatisticsQuery(payload)
    if (!parsed.ok) return rpcFailure(parsed.message)
    const query = parsed.query
    try {
      const items = await services.sessionPersistence.list()
      const headers: SessionHeader[] = items
        .map(item => item && typeof item === 'object' && 'header' in item ? (item as { header: SessionHeader }).header : item as SessionHeader)
        .filter(header => header !== undefined && (query.sessionId === undefined || String(header.id) === query.sessionId))
      const settled = await Promise.allSettled(headers.map(async header => topic(header).statistics.overview(query)))
      const overviews: StatisticsOverview[] = []
      for (const result of settled) {
        if (result.status === 'fulfilled') overviews.push(result.value)
        else ctx.logger.warn('llm-verifier statistics: skipped one unreadable topic — ' + (result.reason instanceof Error ? result.reason.message : String(result.reason)))
      }
      const value: StatisticsOverview = mergeStatisticsOverviews(overviews, query)
      return rpcSuccess(value)
    } catch (error) { return rpcFailure(error instanceof Error ? error.message : String(error)) }
  }

  // 1. 优先注册到官方 /api 共享通道 (connection.fetch.register)
  const anyConn = services.connection as unknown as { fetch?: { register: (route: unknown) => () => Promise<void> } }
  if (anyConn && anyConn.fetch && typeof anyConn.fetch.register === 'function') {
    try {
      anyConn.fetch.register({
        path: '/api/llm-verifier/statistics',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: Request): Promise<Response> => {
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return new Response('body is not JSON', { status: 400 })
          }
          const isRpcEnvelope = typeof body === 'object' && body !== null && (body as { type?: unknown }).type === 'client-request' && typeof (body as { rpcId?: unknown }).rpcId === 'string'
          const rpcId = isRpcEnvelope ? (body as { rpcId: string }).rpcId : 'direct'
          const payload = isRpcEnvelope ? (body as { payload?: unknown }).payload : body
          const outcome = await handleStatisticsQuery(payload)
          if (isRpcEnvelope) {
            return Response.json({
              type: 'server-response',
              rpcId,
              result: outcome,
            })
          }
          return Response.json(outcome)
        },
      })
    } catch (e) {
      ctx.logger.warn('failed to register /api/llm-verifier/statistics fetch route: ' + String(e))
    }
  }

  // 2. Fallback for hosts predating the exact Fetch route API: the same query over
  // the plugin's own RPC channel, which Connection guards with the Host/Origin
  // fence and browser authentication. Modern hosts answer on /api first.
  const legacyRpc = services.connection as unknown as { rpc?: { handle?: (channel: string, handler: (endpoint: string, payload: unknown) => unknown) => unknown } }
  if (typeof legacyRpc.rpc?.handle === 'function') {
    try {
      legacyRpc.rpc.handle('/llm-verifier', async (endpoint: string, payload: unknown) => {
        if (endpoint !== 'statistics') return rpcFailure('unknown llm-verifier endpoint')
        return handleStatisticsQuery(payload)
      })
    } catch (e) {
      ctx.logger.warn('failed to register /llm-verifier rpc fallback: ' + String(e))
    }
  }

  ctx.on('agent/disposed', ({ agent }) => { autoRouter.release(agent); topics.delete(String(agent.id)) })

  // Plan pre-review: judge exit_plan_mode BEFORE the tool asks the human, so a
  // weak plan is sent back to the model instead of reaching the review dialog.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const selected = current()
    if (!selected.enabled || selected.autoVerifyMode === 'manual' || !selected.autoVerifyPlanMode) return next()
    if (exec.name !== 'exit_plan_mode' || exec.agent === undefined || exec.signal.aborted) return next()
    if (!selected.autoVerifySubagents && isSubagentSession(exec.agent)) return next()
    const plan = planFromArguments(exec.arguments)
    if (!plan) return next()
    const agent = exec.agent
    const policy = routePolicy(selected)
    const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold })
    const planFingerprint = stableHash({ phase: 'plan_review', plan })
    const reservation = autoRouter.reserve(agent, 'plan_review', planFingerprint, 1, policy)
    if (reservation === undefined) {
      // Already reviewed, another verification is in flight, or the auto-verification
      // budget is spent. The plan still reaches the human: denying here would let an
      // exhausted budget deadlock plan mode, whose only exit is this very tool call.
      if (!autoRouter.completedFingerprint(agent, planFingerprint)) {
        ctx.logger.warn('llm-verifier plan pre-review skipped (verification in flight or auto-verification budget exhausted)')
      }
      return next()
    }
    try {
      const toSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1
      const extracted = await extractTask(agent, evidence.taskStartSeq, toSeq, selected.autoVerifyMaxChars, exec.signal)
      const classified = await classifyRoute(agent, buildPlanPreReviewPrompt(extracted.problem, plan, selected.autoRouteMaxInputChars), exec.signal, 'plan_review')
      const verdict = parseVerdictLetter(classified.text)
      if (verdict === undefined) {
        autoRouter.fail(agent, reservation, false)
        ctx.logger.warn('llm-verifier plan pre-review produced no verdict line; the plan was allowed through')
        return next()
      }
      if (verdict.score >= selected.autoVerifyThreshold) {
        autoRouter.commit(agent, reservation)
        return next()
      }
      autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict')
      return {
        kind: 'deny',
        reason: '[Automatic Verifier Plan Pre-review] scored ' + (verdict.score * 100).toFixed(1) + '% against a ' + (selected.autoVerifyThreshold * 100).toFixed(0) + '% threshold.\n' + verdict.feedback.slice(0, 4000) + '\nRevise the plan to address these findings, then call exit_plan_mode again.',
      }
    } catch (error) {
      autoRouter.fail(agent, reservation, false)
      ctx.logger.warn('llm-verifier plan pre-review failed: ' + (error instanceof Error ? error.message : String(error)))
      return next()
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const selected = current()
    if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted) return
    // Delegated child sessions are seeded with a real user message, so they would
    // otherwise be gated (and steered) as if they were the operator's own task.
    if (!selected.autoVerifySubagents && isSubagentSession(agent)) return
    const policy = routePolicy(selected)
    const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold })
    const admittedLastSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1
    const snapshot = sessionEvents(agent.session).filter(event => event.seq <= admittedLastSeq)
    const stillCurrent = () => !signal.aborted && (sessionEvents(agent.session).at(-1)?.seq ?? -1) === admittedLastSeq

    if (selected.autoVerifyTeamTasks) {
      const teamInspection = inspectTeamTasks(snapshot, evidence.taskStartSeq)
      // Every completion still pending in this turn, oldest first. A pass does not
      // keep the turn alive, so a task deferred to "the next turn-stopping" could
      // wait forever: verify the whole batch, with the router budget as the cap.
      for (const completed of teamInspection.completedTasks) {
        const task = completed.task
        const taskReservation = autoRouter.reserve(agent, 'team_task', stableHash({ phase: 'team_task', taskId: task.id, status: task.status, seq: completed.seq }), 1, policy)
        if (taskReservation === undefined) continue
        try {
          const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal)
          const prompt = buildTeamTaskVerificationPrompt(task, extracted.trace, selected.autoRouteMaxInputChars)
          const classified = await classifyRoute(agent, prompt, signal, 'team_task')
          if (!stillCurrent()) { autoRouter.fail(agent, taskReservation, false); return }
          const verdict = parseVerdictLetter(classified.text)
          if (verdict === undefined) {
            autoRouter.fail(agent, taskReservation, false)
            ctx.logger.warn('llm-verifier team task verification produced no verdict line; task ' + task.id + ' was not gated')
            continue
          }
          if (verdict.score >= selected.autoVerifyThreshold) {
            autoRouter.commit(agent, taskReservation, admittedLastSeq)
            continue
          }
          autoRouter.fail(agent, taskReservation, selected.autoVerifyMode === 'strict')
          agent.steer(createUserMessage({
            content: [{
              type: 'text',
              text: '[Automatic Verifier Team Task Gate]\nTask "' + task.subject + '" (#' + task.id + ') verification scored ' + (verdict.score * 100).toFixed(1) + '% (Threshold: ' + (selected.autoVerifyThreshold * 100).toFixed(0) + '%).\n' + verdict.feedback + '\nProvide verified execution evidence or resolve remaining issues before completing the task.'
            }],
            source: { kind: 'plugin', plugin: 'dsh-llm-verifier', form: 'notice', summary: 'Team Task Gate Feedback' }
          }))
          return
        } catch (error) {
          autoRouter.fail(agent, taskReservation, selected.autoVerifyMode === 'strict')
          ctx.logger.warn('llm-verifier team task verification failed: ' + (error instanceof Error ? error.message : String(error)))
          if (selected.autoVerifyMode === 'strict' && !signal.aborted) {
            agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic Verifier Team Task Gate]\nTask verification failed: ' + (error instanceof Error ? error.message : String(error)) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
            return
          }
          continue
        }
      }
    }

    let decision = boundDecision(analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars) as RouteDecision, policy)

    if (decision === undefined && selected.autoRouteSemantic && (selected.autoVerifyMode === 'strict' || semanticRouteHint(snapshot))) {
      const fingerprint = stableHash({ phase: 'semantic', from: evidence.taskStartSeq, to: admittedLastSeq, model: selected.provider + '/' + selected.model })
      const reservation = autoRouter.reserve(agent, 'semantic', fingerprint, 1, policy)
      if (reservation) {
        try {
          const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal)
          const classified = await classifyRoute(agent, buildSemanticRoutePrompt(extracted.problem, snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars), signal, 'semantic')
          if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
          const parsed = parseSemanticRoute(classified.text, selected.autoRouteMaxCandidates)
          if (!parsed) throw new Error('semantic router returned invalid strict JSON')
          decision = parsed.confidence >= selected.autoRouteMinConfidence ? boundDecision(semanticDecision(parsed, snapshot, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars) as RouteDecision, policy) : undefined
          autoRouter.commit(agent, reservation)
        } catch (error) {
          autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict')
          ctx.logger.warn('llm-verifier automatic classification failed: ' + (error instanceof Error ? error.message : String(error)))
          if (selected.autoVerifyMode === 'strict' && !signal.aborted) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict route classification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until directly relevant verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
          return
        }
      }
    }

    if (!stillCurrent()) return
    if (decision) {
      // Every judge scores every match, so the reservation has to cover the ensemble.
      const expectedCalls = estimateRoutedCalls(decision, selected.autoVerifyRepeats, DEFAULT_CRITERIA.length) * selected.judges.length
      const reservation = autoRouter.reserve(agent, decision.kind, decision.fingerprint, expectedCalls, policy)
      if (reservation === undefined) {
        // A refused reservation used to drop the whole routed decision silently.
        const exhausted = autoRouter.budgetExhausted(agent, expectedCalls, policy)
        ctx.logger.warn('llm-verifier automatic ' + decision.kind + ' route skipped: ' + (exhausted ? 'the task/session budget cannot cover ' + expectedCalls + ' model calls' : 'another verifier is active or this decision already ran'))
        if (exhausted && selected.autoVerifyMode === 'strict' && autoRouter.claimExhaustedNotice(agent)) {
          agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nA routed ' + decision.kind + ' check was skipped because the task/session model-call budget is exhausted. Do not conclude until directly relevant verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
          return
        }
      }
      if (reservation) {
        try {
          const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal)
          if (decision.kind === 'compare') {
            const result = await compareCandidates(agent, extracted.problem, decision.candidates[0].content, decision.candidates[1].content, selected.autoVerifyRepeats, signal, extracted.images, 'compare')
            if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
            if (!autoRouter.commit(agent, reservation, admittedLastSeq)) return
            const winner = result.winner === 'A' ? decision.candidates[0].label : result.winner === 'B' ? decision.candidates[1].label : 'tie'
            agent.steer(routeFeedback(decision, 'Winner: ' + winner + '. Scores: ' + (result.scoreA * 100).toFixed(1) + '% / ' + (result.scoreB * 100).toFixed(1) + '%.'))
            return
          }
          if (decision.kind === 'select') {
            const result = await selectCandidates(agent, extracted.problem, decision.candidates.map(candidate => candidate.content), selected.autoVerifyRepeats, signal, extracted.images, 'select')
            if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
            if (!autoRouter.commit(agent, reservation, admittedLastSeq)) return
            const ranking = result.ranking.map((index, rank) => (rank + 1) + '. ' + decision.candidates[index]!.label).join('\n')
            agent.steer(routeFeedback(decision, 'Ranking:\n' + ranking + '\nProceed with ' + decision.candidates[result.index]!.label + '.'))
            return
          }
          const result = await trackProgress(agent, extracted.problem, decision.steps, decision.checkpoints, selected.autoVerifyRepeats, signal, extracted.images, 'track')
          if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
          if (!autoRouter.commit(agent, reservation, admittedLastSeq)) return
          const detail = result.scores.map((score, index) => 'Checkpoint step ' + decision.checkpoints[index] + ': ' + (score * 100).toFixed(1) + '%').join('\n')
          const continuation = result.scores.some(score => score < selected.autoTrackCompletionThreshold) ? '\nContinue the unfinished work.' : '\nPrepare final delivery evidence; final session verification is mandatory.'
          agent.steer(routeFeedback(decision, detail + continuation))
          return
        } catch (error) {
          autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict')
          ctx.logger.warn('llm-verifier automatic route failed: ' + (error instanceof Error ? error.message : String(error)))
          if (selected.autoVerifyMode === 'strict' && !signal.aborted) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict routed verification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until it succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
          return
        }
      }
    }

    const forcedFromSeq = autoRouter.finalRequired(agent)
    if (forcedFromSeq === undefined && !evidence.eligible) {
      if (selected.autoVerifyMode === 'strict' && autoRouter.strictBlocked(agent)) {
        // Budget-exhausted states can never be cleared, so steering every stop
        // boundary would keep the turn open indefinitely. Notify once, then let
        // the turn close with a warning instead of spinning.
        if (autoRouter.claimExhaustedNotice(agent)) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict verification remains blocked. Produce new evidence or run a directly relevant verifier.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
        else ctx.logger.warn('llm-verifier strict verification remains blocked but the notice was already delivered for this task; closing the turn')
      }
      return
    }
    const finalFromSeq = forcedFromSeq === undefined ? evidence.taskStartSeq : Math.min(evidence.taskStartSeq, forcedFromSeq)
    const finalFingerprint = stableHash({ phase: 'final', from: finalFromSeq, to: admittedLastSeq })
    const finalReservation = autoRouter.reserve(agent, 'final', finalFingerprint, Math.max(1, 4 * selected.autoVerifyRepeats) * selected.judges.length, policy)
    if (!finalReservation) {
      // Same one-shot rule: a spent budget never grants another reservation, so
      // an unconditional steer here would livelock the turn.
      if (selected.autoVerifyMode === 'strict' && (forcedFromSeq !== undefined || autoRouter.strictBlocked(agent))) {
        if (autoRouter.claimExhaustedNotice(agent)) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification is required but its safety budget is exhausted or another verifier is active. Do not conclude; request operator review.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
        else ctx.logger.warn('llm-verifier strict final verification remains unavailable (budget exhausted or another verifier active); closing the turn')
      }
      return
    }
    try {
      const result = await verifySession(agent, { fromSeq: finalFromSeq, toSeq: admittedLastSeq, includeAssistantText: true, maxChars: selected.autoVerifyMaxChars, repeats: selected.autoVerifyRepeats }, signal, 'final')
      if (!stillCurrent()) { autoRouter.fail(agent, finalReservation, false); return }
      const passed = result.winner === 'A' && result.score >= selected.autoVerifyThreshold
      if (passed) autoRouter.commit(agent, finalReservation)
      else {
        autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict')
        agent.steer(createUserMessage({ content: [{ type: 'text', text: automaticFeedback(result.score, result.baselineScore, result.winner, selected.autoVerifyThreshold) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
      }
    } catch (error) {
      autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict')
      ctx.logger.warn('llm-verifier automatic final verification failed: ' + (error instanceof Error ? error.message : String(error)))
      if (selected.autoVerifyMode === 'strict' && !signal.aborted) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
    }
  })

  ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings (or the configured judge ensemble) with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_compare', agent, async () => { const { verifier, selected } = await engine(agent); const [problem, candidateA, candidateB] = explicitEvidence([args.problem, args.candidate_a, args.candidate_b], explicitItemChars(selected), explicitBudget(selected), 'compare input'); const result = await verifier.compare({ problem, candidateA, candidateB, criteria: normalizeCriteria(args.criteria), repeats: capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'), images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_select', agent, async () => { const { verifier, selected } = await engine(agent); const limit = explicitCandidateLimit(selected); if (args.candidates.length > limit) throw new Error('llm-verifier: candidates must contain at most ' + limit + ' entries'); const candidates = explicitEvidence(args.candidates, explicitItemChars(selected), explicitBudget(selected), 'candidates'); const criteria = normalizeCriteria(args.criteria); const repeats = capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'); const planned = plannedComparisons(candidates.length) * (criteria?.length || 3) * repeats; if (planned > MAX_EXPLICIT_PLANNED_CALLS) throw new Error('llm-verifier: this selection would issue about ' + planned + ' judge calls; reduce candidates or repeats'); const result = await verifier.select({ problem: sanitizeVerifierText(args.problem, explicitItemChars(selected)), candidates, criteria, repeats, pivots: capped(args.pivots, 2, Math.max(1, candidates.length), 'pivots'), seed: args.seed ?? 0, images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_track', agent, async () => { const { verifier, selected } = await engine(agent); if (args.steps.length > MAX_TRACK_STEPS) throw new Error('llm-verifier: steps must contain at most ' + MAX_TRACK_STEPS + ' entries'); const steps = explicitEvidence(args.steps, explicitItemChars(selected), explicitBudget(selected), 'steps'); const result = await verifier.track(sanitizeVerifierText(args.problem, explicitItemChars(selected)), steps, args.checkpoints, capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'), exec.signal, await images(args.images, exec.signal)); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars === undefined ? undefined : capped(args.max_chars, 200000, MAX_SESSION_CHARS, 'max_chars'), repeats: capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats') }, exec.signal) } }))
}
