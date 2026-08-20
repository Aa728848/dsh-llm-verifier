import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { Config, installVerifierSettings, resolveConfig } from './config.ts'
import { RequestLimiter, callVerifierText } from './caller.ts'
import { TopLogprobCapabilityCache } from './top-logprobs.ts'
import { ScoreCache, resolveCacheFile, stableHash } from './cache.ts'
import { VerifierEngine, normalizeCriteria, type RunStats } from './engine.ts'
import { loadVerifierImages } from './images.ts'
import { extractSession } from './session.ts'
import { AutoVerificationBudget, analyzeAutoTask, automaticFeedback } from './auto.ts'
import { AutoVerifierRouter, analyzeStructuredRoute, boundDecision, buildSemanticRoutePrompt, parseSemanticRoute, semanticDecision, semanticRouteHint, type RouteDecision } from './router.ts'
import { StatisticsStore, emptyRunStats, errorDetails, mergeStatisticsOverviews, resolveStatisticsFile, type StatisticsOverview, type StatisticsQuery, type VerifierToolName } from './statistics.ts'
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
  const services = ctx as Context & { attachments: AttachmentStore; connection: HostConnectionHandle; sessionPersistence: SessionArtifactLocator & { list(signal?: AbortSignal): Promise<SessionHeader[]> } }
  const entry = resolveConfig(config)
  let limiter = new RequestLimiter(entry.maxConcurrency)
  const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency) })
  const topLogprobCapabilities = new TopLogprobCapabilityCache()
  const autoBudget = new AutoVerificationBudget()
  const autoRouter = new AutoVerifierRouter()
  const topics = new Map<string, { dataDir: string; cache: ScoreCache; statistics: StatisticsStore }>()
  const topic = (header: SessionHeader) => {
    const selected = current()
    const dataDir = resolveTopicDataDir(services.sessionPersistence, header, selected.cacheDir)
    const id = String(header.id)
    const existing = topics.get(id)
    if (existing?.dataDir === dataDir) return existing
    const cacheFile = resolveCacheFile(dataDir)
    const created = { dataDir, cache: new ScoreCache(cacheFile, selected.cacheMaxEntries), statistics: new StatisticsStore(resolveStatisticsFile(cacheFile)) }
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
    await ctx.llm.resolveCallConfig({ provider: selected.provider, model: selected.model, ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort as never } : {}), maxTokens: selected.maxTokens })
    return { verifier: new VerifierEngine({ ...selected, ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities, limiter }, selected.maxConcurrency, topic(agent.session.header).cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }), selected }
  }
  const images = (values: readonly string[] | undefined, signal: AbortSignal) => loadVerifierImages(values, signal)
  const route = (selected: { provider: string; model: string }) => ({ provider: selected.provider, model: selected.model })
  const requireEnabled = () => { if (!current().enabled) throw new Error('llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier') }
  const record = async <T>(toolName: VerifierToolName, agent: Agent, operation: () => Promise<{ result: T; selected: { provider: string; model: string } }>): Promise<T & { provider: string; model: string }> => {
    const startedAt = Date.now()
    let selected: { provider: string; model: string } = current()
    const statistics = topic(agent.session.header).statistics
    try {
      const completed = await operation()
      selected = completed.selected
      const value = { ...completed.result as T & object, ...route(selected) } as T & { provider: string; model: string }
      await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: true, provider: selected.provider, model: selected.model, stats: statsFrom(value) }).catch(() => {})
      return value
    } catch (error) {
      const details = errorDetails(error)
      await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: false, ...details, provider: selected.provider, model: selected.model, stats: emptyRunStats() }).catch(() => {})
      throw error
    }
  }
  const verifySession = async (agent: Agent, options: SessionVerificationOptions, signal: AbortSignal): Promise<SessionVerificationResult & { provider: string; model: string }> => record('verifier_current_session', agent, async () => {
    const extracted = await extractSession(agent, async (ref: ImageAttachmentRef) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType } }, { fromSeq: options.fromSeq, toSeq: options.toSeq, includeAssistantText: options.includeAssistantText, redactPatterns: options.redactPatterns, maxChars: options.maxChars })
    const { verifier, selected } = await engine(agent)
    const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: '(No useful work or verification was performed.)', repeats: positive(options.repeats, 2, 'repeats'), images: extracted.images }, signal)
    const result: SessionVerificationResult = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats }
    return { result, selected }
  })
  const compareCandidates = async (agent: Agent, problem: string, candidateA: string, candidateB: string, repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = []) => record('verifier_compare', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.compare({ problem, candidateA, candidateB, repeats, images: routedImages }, signal), selected }
  })
  const selectCandidates = async (agent: Agent, problem: string, candidates: readonly string[], repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = []) => record('verifier_select', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.select({ problem, candidates, repeats, pivots: Math.min(2, candidates.length), seed: 0, images: routedImages }, signal), selected }
  })
  const trackProgress = async (agent: Agent, problem: string, steps: readonly string[], checkpoints: readonly number[], repeats: number, signal: AbortSignal, routedImages: readonly import('./caller.ts').VerifierImage[] = []) => record('verifier_track', agent, async () => {
    const { verifier, selected } = await engine(agent)
    return { result: await verifier.track(problem, steps, checkpoints, repeats, signal, routedImages), selected }
  })
  const classifyRoute = async (agent: Agent, prompt: string, signal: AbortSignal) => record('verifier_route_classify', agent, async () => {
    const { verifier, selected } = await engine(agent)
    const completion = await callVerifierText(verifier.client, prompt, signal)
    const stats: RunStats = { ...completion.usage, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: ((completion.usage.inputTokens + completion.usage.cachedInputTokens) * selected.estimatedInputUsdPerMillion + completion.usage.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000, topLogprobScores: 0, explicitTagScores: 1 }
    return { result: { text: completion.text, stats }, selected }
  })
  const extractTask = async (agent: Agent, fromSeq: number, toSeq: number, maxChars: number, signal: AbortSignal) => extractSession(agent, async (ref: ImageAttachmentRef) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType } }, { fromSeq, toSeq, includeAssistantText: true, maxChars })
  const routePolicy = (selected: ReturnType<typeof current>) => ({ mode: selected.autoVerifyMode, minConfidence: selected.autoRouteMinConfidence, maxCandidates: selected.autoRouteMaxCandidates, maxPerTask: selected.autoRouteMaxPerTask + selected.autoVerifyMaxPerTask, maxPerSession: selected.autoRouteMaxPerSession + selected.autoVerifyMaxPerSession, maxModelCallsPerTask: selected.autoMaxModelCallsPerTask, maxModelCallsPerSession: selected.autoMaxModelCallsPerSession, maxInputChars: selected.autoRouteMaxInputChars, maxItemChars: selected.autoRouteMaxItemChars })
  const routeFeedback = (decision: RouteDecision, detail: string) => createUserMessage({ content: [{ type: 'text' as const, text: '[Automatic verifier routing: ' + decision.kind + ']\n' + detail + '\nUse this independent result to continue the actual task. Do not merely restate the ranking or progress score; implement, correct, and verify the required work.' }], source: { kind: 'plugin' as const, plugin: 'dsh-llm-verifier', form: 'notice' as const, summary: 'Automatic verifier routed ' + decision.kind } })

  ctx.effect(() => services.connection.rpc.handle('/llm-verifier', async (endpoint: string, payload: unknown) => {
    if (endpoint !== 'statistics') return rpcFailure('unknown llm-verifier endpoint')
    if (typeof payload !== 'object' || payload === null) return rpcFailure('statistics payload must be an object')
    const row = payload as Record<string, unknown>
    const sessionId = typeof row.sessionId === 'string' && row.sessionId.length > 0 ? row.sessionId : undefined
    const query: StatisticsQuery = { fromMs: numberField(row.fromMs, Number.NaN), toMs: numberField(row.toMs, Number.NaN), timezoneOffsetMinutes: numberField(row.timezoneOffsetMinutes, 0), recentLimit: numberField(row.recentLimit, 40), ...(sessionId ? { sessionId } : {}) }
    try {
      const headers = (await services.sessionPersistence.list()).filter(header => sessionId === undefined || String(header.id) === sessionId)
      const overviews = await Promise.all(headers.map(header => topic(header).statistics.overview(query)))
      const value: StatisticsOverview = mergeStatisticsOverviews(overviews, query)
      return rpcSuccess(value)
    } catch (error) { return rpcFailure(error instanceof Error ? error.message : String(error)) }
  }, { authority: 'loopback' }), 'llm-verifier: statistics rpc')

  ctx.on('agent/disposed', ({ agent }) => { autoBudget.release(agent); autoRouter.release(agent); topics.delete(String(agent.id)) })
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const selected = current()
    if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted) return
    const policy = routePolicy(selected)
    const evidence = analyzeAutoTask(agent.session.events, { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession })
    const admittedLastSeq = agent.session.events.at(-1)?.seq ?? -1
    const snapshot = agent.session.events.filter(event => event.seq <= admittedLastSeq)
    const stillCurrent = () => !signal.aborted && (agent.session.events.at(-1)?.seq ?? -1) === admittedLastSeq
    let decision = boundDecision(analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars) as RouteDecision, policy)

    if (decision === undefined && selected.autoRouteSemantic && (selected.autoVerifyMode === 'strict' || semanticRouteHint(snapshot))) {
      const fingerprint = stableHash({ phase: 'semantic', from: evidence.taskStartSeq, to: admittedLastSeq, model: selected.provider + '/' + selected.model })
      const reservation = autoRouter.reserve(agent, 'semantic', fingerprint, 1, policy)
      if (reservation) {
        try {
          const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal)
          const classified = await classifyRoute(agent, buildSemanticRoutePrompt(extracted.problem, snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars), signal)
          if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
          const parsed = parseSemanticRoute(classified.text, selected.autoRouteMaxCandidates)
          if (!parsed) throw new Error('semantic router returned invalid strict JSON')
          decision = parsed.confidence >= selected.autoRouteMinConfidence ? boundDecision(semanticDecision(parsed, snapshot, selected.autoRouteMaxItemChars) as RouteDecision, policy) : undefined
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
      const expectedCalls = decision.kind === 'select' ? Math.max(1, decision.candidates.length * 8 * selected.autoVerifyRepeats) : Math.max(1, 4 * selected.autoVerifyRepeats)
      const reservation = autoRouter.reserve(agent, decision.kind, decision.fingerprint, expectedCalls, policy)
      if (reservation) {
        try {
          const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal)
          if (decision.kind === 'compare') {
            const result = await compareCandidates(agent, extracted.problem, decision.candidates[0].content, decision.candidates[1].content, selected.autoVerifyRepeats, signal, extracted.images)
            if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
            if (!autoRouter.commit(agent, reservation, admittedLastSeq)) return
            const winner = result.winner === 'A' ? decision.candidates[0].label : result.winner === 'B' ? decision.candidates[1].label : 'tie'
            agent.steer(routeFeedback(decision, 'Winner: ' + winner + '. Scores: ' + (result.scoreA * 100).toFixed(1) + '% / ' + (result.scoreB * 100).toFixed(1) + '%.'))
            return
          }
          if (decision.kind === 'select') {
            const result = await selectCandidates(agent, extracted.problem, decision.candidates.map(candidate => candidate.content), selected.autoVerifyRepeats, signal, extracted.images)
            if (!stillCurrent()) { autoRouter.fail(agent, reservation, false); return }
            if (!autoRouter.commit(agent, reservation, admittedLastSeq)) return
            const ranking = result.ranking.map((index, rank) => (rank + 1) + '. ' + decision.candidates[index]!.label).join('\n')
            agent.steer(routeFeedback(decision, 'Ranking:\n' + ranking + '\nProceed with ' + decision.candidates[result.index]!.label + '.'))
            return
          }
          const result = await trackProgress(agent, extracted.problem, decision.steps, decision.checkpoints, selected.autoVerifyRepeats, signal, extracted.images)
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
      if (selected.autoVerifyMode === 'strict' && autoRouter.strictBlocked(agent)) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict verification remains blocked. Produce new evidence or run a directly relevant verifier.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
      return
    }
    const finalFromSeq = forcedFromSeq === undefined ? evidence.taskStartSeq : Math.min(evidence.taskStartSeq, forcedFromSeq)
    const finalFingerprint = stableHash({ phase: 'final', from: finalFromSeq, to: admittedLastSeq })
    const finalReservation = autoRouter.reserve(agent, 'final', finalFingerprint, Math.max(1, 4 * selected.autoVerifyRepeats), policy)
    if (!finalReservation) {
      if (selected.autoVerifyMode === 'strict' && (forcedFromSeq !== undefined || autoRouter.strictBlocked(agent))) agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification is required but its safety budget is exhausted or another verifier is active. Do not conclude; request operator review.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }))
      return
    }
    try {
      const result = await verifySession(agent, { fromSeq: finalFromSeq, toSeq: admittedLastSeq, includeAssistantText: true, maxChars: selected.autoVerifyMaxChars, repeats: selected.autoVerifyRepeats }, signal)
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

  ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings, with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_compare', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.compare({ problem: args.problem, candidateA: args.candidate_a, candidateB: args.candidate_b, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_select', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.select({ problem: args.problem, candidates: args.candidates, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), pivots: positive(args.pivots, 2, 'pivots'), seed: args.seed ?? 0, images: await images(args.images, exec.signal) }, exec.signal); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_track', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.track(args.problem, args.steps, args.checkpoints, positive(args.repeats, 2, 'repeats'), exec.signal, await images(args.images, exec.signal)); return { result, selected } }) } }))

  ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars, repeats: args.repeats }, exec.signal) } }))
}
