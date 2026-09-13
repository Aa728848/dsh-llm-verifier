import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RunStats } from './engine.ts'

export const VERIFIER_TOOL_NAMES = ['verifier_route_classify', 'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_best_of_n', 'verifier_current_session'] as const
export type VerifierToolName = typeof VERIFIER_TOOL_NAMES[number]

export interface VerdictSummary {
  phase?: string
  outcome?: string
  score?: number
  /** Per-checkpoint progression of a `verifier_track` verdict, oldest first. Optional: old records do not carry it. */
  scores?: number[]
  /** Candidate B's score of a two-way comparison; `score` is the winning side. */
  scoreB?: number
  /** Per-criterion A-side scores of a session acceptance; the mean alone can hide a failed requirement. */
  criteria?: Array<{ id: string; score: number }>
  baselineScore?: number
  winner?: 'A' | 'B' | 'tie'
  threshold?: number
  /**
   * Review stage the call declared (P02): `proposal` means unexecuted plans/drafts.
   *
   * Optional and additive: old records have no stage and are rendered as artifacts, which is
   * exactly the semantics they were produced under.
   */
  reviewStage?: string
  /** Which rubric produced the score: a preset id, `proposal`, `explicit`, `custom` or `fallback`. */
  criteriaSource?: string
}

/** Upper bound on the stored checkpoint progression; one explicit call can legitimately carry 32 steps. */
const MAX_VERDICT_SCORES = 64

/** Upper bound on the stored per-criterion breakdown; the default rubric has three criteria. */
const MAX_VERDICT_CRITERIA = 16

/** Thresholds the verdict summary needs; plain values keep the mapping a pure function. */
export interface VerdictThresholds {
  autoVerifyThreshold: number
  autoTrackCompletionThreshold: number
}

/**
 * Compact summary of what the judges decided, stored beside the call counters so
 * the dashboard can answer "why did this fail?" instead of only "how much did it cost".
 *
 * Pure on purpose: this mapping used to live inside the plugin closure, where the two
 * bugs it carried (a track verdict reported as the historical minimum, a comparison
 * reported as the loser's score under a threshold it never used) could not be tested.
 * @param toolName - the verifier tool that produced the value.
 * @param value - its rendered result.
 * @param phase - which stage produced it (explicit | compare | select | track | final | ...).
 * @param thresholds - resolved acceptance thresholds.
 * @returns A verdict summary; score fields are omitted when the tool has none.
 */
export function summarizeVerdict(toolName: VerifierToolName, value: unknown, phase: string, thresholds: VerdictThresholds): VerdictSummary {
  const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const numberAt = (key: string): number | undefined => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined)
  const scores = Array.isArray(row.scores) ? row.scores.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : []
  const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'tie' ? row.winner : undefined
  if (toolName === 'verifier_route_classify') return { phase, outcome: 'classified' }
  // The stage and the rubric that actually scored are part of the verdict: "which object was
  // judged, and against what" cannot be recovered from a score alone.
  const framing = {
    ...(typeof row.reviewStage === 'string' ? { reviewStage: row.reviewStage } : {}),
    ...(typeof row.criteriaSource === 'string' ? { criteriaSource: row.criteriaSource } : {}),
  }
  if (toolName === 'verifier_select') {
    if (row.identical === true) return { phase, outcome: 'identical-candidates', ...framing }
    const index = numberAt('index')
    const best = index === undefined ? undefined : scores[index]
    return { phase, outcome: 'ranked', ...(best !== undefined ? { score: best } : {}), ...framing }
  }
  if (toolName === 'verifier_track') {
    // The verdict reports the newest checkpoint (the one the continuation decision
    // uses) plus the whole progression. Reporting only Math.min() made every routed
    // track look like a 0% failure on the dashboard, because the first checkpoint of
    // a task is always the untouched plan.
    const latest = scores.length > 0 ? scores[scores.length - 1] : undefined
    const threshold = thresholds.autoTrackCompletionThreshold
    return {
      phase,
      outcome: latest !== undefined && latest >= threshold ? 'passed' : 'below-threshold',
      ...(latest !== undefined ? { score: latest } : {}),
      ...(scores.length > 1 ? { scores: [...scores] } : {}),
      threshold,
    }
  }
  if (toolName === 'verifier_compare') {
    // A comparison has no threshold, so "below-threshold" used to describe the loser's
    // score as a failure of the call itself. Report the winning side and keep both.
    const scoreA = numberAt('score') ?? numberAt('scoreA')
    const scoreB = numberAt('scoreB')
    const score = winner === 'B' ? scoreB : scoreA
    return {
      phase,
      outcome: row.identical === true ? 'identical' : winner === 'tie' ? 'tie' : 'compared',
      ...(score !== undefined ? { score } : {}),
      ...(scoreB !== undefined ? { scoreB } : {}),
      ...(winner !== undefined ? { winner } : {}),
      ...framing,
    }
  }
  // The remaining tools are both measured against the fixed empty-work baseline. A best-of-N
  // verdict is rendered with the GATE's shape, not the select tool's: the tournament shares it
  // also returns are relative preferences (wins/counts) and mean nothing against
  // `autoVerifyThreshold`, while its `score`/`baselineScore`/`winner` come from the very same
  // empty-work comparison the final gate runs. The dashboard reads it exactly like an acceptance.
  return acceptanceVerdict(row, phase, thresholds)
}

/**
 * Verdict of a run that was measured against the fixed empty-work baseline.
 *
 * Shared by the automatic session acceptance and by `verifier_best_of_n`: both answer
 * "is this good enough to conclude", and both are decided by the same three conditions.
 * @param row - the rendered result.
 * @param phase - which stage produced it.
 * @param thresholds - resolved acceptance thresholds.
 * @returns A gate-shaped verdict summary.
 */
function acceptanceVerdict(row: Record<string, unknown>, phase: string, thresholds: VerdictThresholds): VerdictSummary {
  const numberAt = (key: string): number | undefined => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : undefined)
  const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'tie' ? row.winner : undefined
  // `score` is the run's own score and `baselineScore` the empty-work baseline it has to beat.
  const score = numberAt('score') ?? numberAt('scoreA')
  const baselineScore = numberAt('baselineScore')
  const threshold = thresholds.autoVerifyThreshold
  const criteria = Array.isArray(row.criteria)
    ? (row.criteria as unknown[])
        .map(entry => (typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}))
        // `score` is the shape a session acceptance emits (AcceptanceCriterion); `scoreA` is the
        // shape a compare result uses. Reading only `scoreA` silently dropped EVERY per-criterion
        // score a session acceptance ever produced: 11 of 11 stored records on the author's topic
        // carry no criteria array at all, so the dashboard could never show which requirement
        // failed. Keep both, because the compare-shaped value is still a valid input here.
        .map(entry => ({ id: entry.id, score: typeof entry.score === 'number' ? entry.score : entry.scoreA }))
        .filter((entry): entry is { id: string; score: number } => typeof entry.id === 'string' && typeof entry.score === 'number' && Number.isFinite(entry.score))
        .slice(0, MAX_VERDICT_CRITERIA)
    : []
  // A session does not pass on the mean alone: one criterion below the threshold fails
  // the record too, which is exactly what the live gate now enforces.
  const belowThreshold = criteria.filter(entry => !(entry.score >= threshold))
  const outcome = winner === 'tie'
    ? 'tie'
    : winner === 'A' && score !== undefined && score >= threshold && belowThreshold.length === 0 ? 'passed' : 'below-threshold'
  return {
    phase,
    outcome,
    ...(score !== undefined ? { score } : {}),
    ...(baselineScore !== undefined ? { baselineScore } : {}),
    ...(criteria.length > 0 ? { criteria } : {}),
    ...(winner !== undefined ? { winner } : {}),
    threshold,
    // best-of_n reports both phases; the gate-facing rubric is the baseline one, and the drafts
    // it ranked were proposals. A plain session acceptance carries neither field.
    ...(typeof row.rankingStage === 'string' ? { reviewStage: row.rankingStage } : {}),
    ...(typeof row.baselineCriteriaSource === 'string' ? { criteriaSource: row.baselineCriteriaSource } : {}),
  }
}

/** Host boundary that started an automatic routing cycle. */
export type RouteTrigger = 'turn-stopping' | 'plan' | 'team' | 'pre-step' | 'llm-stream'
/** Stage of the cycle a statistics row describes. */
export type RouteStage = 'classification' | 'execution' | 'final' | 'skipped' | 'process'

/**
 * One automatic routing cycle, stored beside the invocation it produced.
 *
 * A cycle is NOT a model call and a diagnostic row is not a purchase, so these fields live
 * in their own object: adding them up as judge calls (or reading a cycle count as a call
 * count) is exactly the confusion the observation is meant to remove. The classification
 * row and the execution row it was promoted into (S01) share one {@link cycleId}, so the
 * dashboard can tell "classified but never executed" from "scored".
 */
export interface RouteObservation {
  /** Stable id of the cycle; a promoted classification and its execution share it. */
  cycleId: string
  /** Which host boundary started the cycle. */
  trigger: RouteTrigger
  /** Which stage of the cycle this row reports. */
  stage: RouteStage
  /** Decision kind the cycle reached, or 'none' when it deliberately did not route. */
  destination: string
  /** 1-based route attempt the cycle consumed, when it reached a reservation. */
  attempt?: number
  /** Conservative model calls the cycle had reserved at the time of this row. */
  reservedCalls?: number
  /** Why the cycle ended without executing a decision. */
  skipReason?: string
  /** Evidence items the bounded routing view actually rendered. */
  evidenceKept?: number
  /** Evidence items the same view omitted for budget reasons. */
  evidenceOmitted?: number
  /** Exact characters of the rendered evidence payload. */
  evidenceChars?: number
  /** True when at least one request this row paid for failed before returning usage. */
  usageIncomplete?: boolean
  /** True when the task, snapshot or signal stopped being current mid-cycle. */
  canceled?: boolean
  /**
   * P06 process selection: which stream was actually replayed to the host.
   *
   * `original` is the fallback for every decline (candidate failed, tie, identical, stale,
   * budget); `none` means not even a replay decision was reached (the intent never matched a
   * request, or the cycle was never purchased). Only `candidate` means the generated reply ran.
   */
  replayed?: 'original' | 'candidate' | 'none'
  /** Extra generation calls this cycle bought (0 or 1 on the shipped N=2 design). */
  generatedCalls?: number
  /** Judge calls this cycle bought. */
  judgeCalls?: number
  /** The normalized candidate was byte-identical to the original, so no judge was called. */
  sameCandidate?: boolean
  /**
   * P06: the alternative was generated WITH the failing-run evidence attached.
   *
   * The A/B discriminator for the controlled comparison of the two designs (resample the same
   * prompt vs. hand the extra candidate the failure): without it the two arms are indistinguishable
   * in the stored rows.
   */
  alternativeAugmented?: boolean
}

export interface InvocationRecord {
  id: string
  toolName: VerifierToolName
  sessionId?: string
  startedAt: number
  finishedAt: number
  durationMs: number
  success: boolean
  errorName?: string
  errorMessage?: string
  provider: string
  model: string
  stats: RunStats
  verdict?: VerdictSummary
  /** Automatic routing-cycle observation; absent on explicit calls and on old records. */
  route?: RouteObservation
}

interface StatisticsDocument {
  version: 1
  records: InvocationRecord[]
}

export interface DailyStatistics {
  date: string
  invocations: number
  successes: number
  failures: number
  calls: number
  tokens: number
  estimatedCostUsd: number
  byTool: Record<string, number>
}

export interface ToolStatistics {
  toolName: VerifierToolName
  invocations: number
  successes: number
  failures: number
  successRate: number
  averageDurationMs: number
  calls: number
  tokens: number
  cacheHits: number
  cacheMisses: number
  estimatedCostUsd: number
}

export interface ModelStatistics {
  provider: string
  model: string
  invocations: number
  calls: number
  tokens: number
  estimatedCostUsd: number
}

export interface StatisticsTotals {
  invocations: number
  successes: number
  failures: number
  successRate: number
  averageDurationMs: number
  calls: number
  attempts: number
  retries: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokens: number
  cacheHits: number
  cacheMisses: number
  /** Share of score-cache lookups answered locally (no model call). */
  cacheHitRate: number
  /**
   * Share of verifier input tokens served by the PROVIDER's prefix cache.
   *
   * A different thing from {@link cacheHitRate}: that one counts local score-cache lookups,
   * this one counts tokens the backend billed as cache hits. It is the metric a warm-up or
   * prompt-ordering change moves, and leaving the two merged hid a 30%-hit-rate prefix cache.
   */
  prefixCacheHitRate: number
  estimatedCostUsd: number
  topLogprobScores: number
  explicitTagScores: number
}

export interface StatisticsOverview {
  generatedAt: number
  fromMs: number
  toMs: number
  sessionId?: string
  totals: StatisticsTotals
  daily: DailyStatistics[]
  tools: ToolStatistics[]
  models: ModelStatistics[]
  recent: InvocationRecord[]
}

export interface StatisticsQuery {
  fromMs: number
  toMs: number
  timezoneOffsetMinutes?: number
  sessionId?: string
  recentLimit?: number
}

export interface InvocationInput {
  toolName: VerifierToolName
  sessionId?: string
  startedAt: number
  finishedAt?: number
  success: boolean
  errorName?: string
  errorMessage?: string
  provider: string
  model: string
  stats: RunStats
  verdict?: VerdictSummary
  route?: RouteObservation
}

const ROUTE_TRIGGERS = new Set<RouteTrigger>(['turn-stopping', 'plan', 'team', 'pre-step', 'llm-stream'])
const ROUTE_STAGES = new Set<RouteStage>(['classification', 'execution', 'final', 'skipped', 'process'])

/**
 * Bound and validate an observation before it is persisted.
 *
 * Optional by design: a record without one is a first-class shape (every explicit call, and
 * every record written before this field existed). A malformed observation is DROPPED rather
 * than allowed to fail the invocation that produced it — the observation is diagnostics, and
 * losing it must never lose the call row it describes.
 * @param input - candidate observation.
 * @returns A bounded observation, or undefined when it is not usable.
 */
function cleanRoute(input: RouteObservation | undefined): RouteObservation | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  if (typeof input.cycleId !== 'string' || !input.cycleId || !ROUTE_TRIGGERS.has(input.trigger) || !ROUTE_STAGES.has(input.stage)) return undefined
  if (typeof input.destination !== 'string' || !input.destination) return undefined
  const route: RouteObservation = {
    cycleId: input.cycleId.slice(0, 120),
    trigger: input.trigger,
    stage: input.stage,
    destination: input.destination.slice(0, 60),
  }
  const counts = ['attempt', 'reservedCalls', 'evidenceKept', 'evidenceOmitted', 'evidenceChars', 'generatedCalls', 'judgeCalls'] as const
  for (const key of counts) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) route[key] = Math.trunc(value)
  }
  if (typeof input.skipReason === 'string' && input.skipReason) route.skipReason = input.skipReason.slice(0, 120)
  if (input.usageIncomplete === true) route.usageIncomplete = true
  if (input.canceled === true) route.canceled = true
  // P06: which stream was replayed is the whole point of the observation, so it must survive.
  if (input.replayed === 'original' || input.replayed === 'candidate' || input.replayed === 'none') route.replayed = input.replayed
  if (input.sameCandidate === true) route.sameCandidate = true
  if (input.alternativeAugmented === true) route.alternativeAugmented = true
  return route
}

function cleanVerdict(input: VerdictSummary | undefined): VerdictSummary | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const verdict: VerdictSummary = {}
  if (typeof input.phase === 'string') verdict.phase = input.phase
  if (typeof input.outcome === 'string') verdict.outcome = input.outcome
  if (typeof input.reviewStage === 'string' && input.reviewStage) verdict.reviewStage = input.reviewStage.slice(0, 40)
  if (typeof input.criteriaSource === 'string' && input.criteriaSource) verdict.criteriaSource = input.criteriaSource.slice(0, 60)
  if (typeof input.score === 'number' && Number.isFinite(input.score)) verdict.score = input.score
  if (Array.isArray(input.scores)) {
    const scores = input.scores.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)).slice(0, MAX_VERDICT_SCORES)
    if (scores.length > 0) verdict.scores = scores
  }
  if (typeof input.scoreB === 'number' && Number.isFinite(input.scoreB)) verdict.scoreB = input.scoreB
  if (Array.isArray(input.criteria)) {
    const criteria = input.criteria
      .filter((entry): entry is { id: string; score: number } => typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string' && typeof (entry as { score?: unknown }).score === 'number' && Number.isFinite((entry as { score: number }).score))
      .slice(0, MAX_VERDICT_CRITERIA)
      .map(entry => ({ id: entry.id, score: entry.score }))
    if (criteria.length > 0) verdict.criteria = criteria
  }
  if (typeof input.baselineScore === 'number' && Number.isFinite(input.baselineScore)) verdict.baselineScore = input.baselineScore
  if (input.winner === 'A' || input.winner === 'B' || input.winner === 'tie') verdict.winner = input.winner
  if (typeof input.threshold === 'number' && Number.isFinite(input.threshold)) verdict.threshold = input.threshold
  return verdict
}

function finite(value: number): number { return Number.isFinite(value) ? value : 0 }
function ratio(numerator: number, denominator: number): number { return denominator > 0 ? numerator / denominator : 0 }
function tokens(stats: RunStats): number { return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens }
function cleanError(value: string | undefined): string | undefined { return value === undefined ? undefined : value.slice(0, 500) }

function blankTotals(): StatisticsTotals {
  return { invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, cacheHitRate: 0, prefixCacheHitRate: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
}

function addRecord(target: StatisticsTotals, record: InvocationRecord): void {
  const stats = record.stats
  target.invocations += 1
  record.success ? target.successes += 1 : target.failures += 1
  target.averageDurationMs += record.durationMs
  target.calls += stats.calls
  target.attempts += stats.attempts
  target.retries += stats.retries
  target.inputTokens += stats.inputTokens
  target.cachedInputTokens += stats.cachedInputTokens
  target.outputTokens += stats.outputTokens
  target.reasoningTokens += stats.reasoningTokens
  target.tokens += tokens(stats)
  target.cacheHits += stats.cacheHits
  target.cacheMisses += stats.cacheMisses
  target.estimatedCostUsd += stats.estimatedCostUsd
  target.topLogprobScores += stats.topLogprobScores
  target.explicitTagScores += stats.explicitTagScores
}

function finishTotals(target: StatisticsTotals): StatisticsTotals {
  target.averageDurationMs = target.invocations > 0 ? target.averageDurationMs / target.invocations : 0
  target.successRate = ratio(target.successes, target.invocations)
  target.cacheHitRate = ratio(target.cacheHits, target.cacheHits + target.cacheMisses)
  target.prefixCacheHitRate = ratio(target.cachedInputTokens, target.inputTokens + target.cachedInputTokens)
  return target
}

function localDate(time: number, timezoneOffsetMinutes: number): string {
  return new Date(time - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is InvocationRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<InvocationRecord>
  if (
    typeof row.id !== 'string' ||
    !VERIFIER_TOOL_NAMES.includes(row.toolName as VerifierToolName) ||
    typeof row.startedAt !== 'number' ||
    typeof row.finishedAt !== 'number' ||
    typeof row.durationMs !== 'number' ||
    typeof row.success !== 'boolean' ||
    typeof row.provider !== 'string' ||
    typeof row.model !== 'string' ||
    typeof row.stats !== 'object' ||
    row.stats === null
  ) {
    return false
  }
  if (row.verdict !== undefined) {
    if (typeof row.verdict !== 'object' || row.verdict === null || Array.isArray(row.verdict)) {
      return false
    }
  }
  // Optional and NOT validated field-by-field on load: records written before this field
  // existed (and every explicit invocation) have none, and a partially-shaped observation
  // must not make an otherwise readable cost row disappear.
  if (row.route !== undefined) {
    if (typeof row.route !== 'object' || row.route === null || Array.isArray(row.route)) {
      return false
    }
  }
  return true
}

export function parseStatisticsQuery(payload: unknown): { ok: true; query: StatisticsQuery } | { ok: false; message: string } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, message: 'statistics payload must be an object' }
  }
  const row = payload as Record<string, unknown>
  const fromMs = row.fromMs
  const toMs = row.toMs
  if (typeof fromMs !== 'number' || !Number.isFinite(fromMs) || typeof toMs !== 'number' || !Number.isFinite(toMs) || fromMs >= toMs) {
    return { ok: false, message: 'statistics range must be finite and increasing' }
  }
  const timezoneOffsetMinutes = typeof row.timezoneOffsetMinutes === 'number' && Number.isFinite(row.timezoneOffsetMinutes)
    ? row.timezoneOffsetMinutes
    : 0
  const recentLimit = typeof row.recentLimit === 'number' && Number.isFinite(row.recentLimit)
    ? row.recentLimit
    : 40
  const query: StatisticsQuery = {
    fromMs,
    toMs,
    timezoneOffsetMinutes,
    recentLimit,
  }
  if (typeof row.sessionId === 'string' && row.sessionId.length > 0) {
    query.sessionId = row.sessionId
  }
  return { ok: true, query }
}

export function resolveStatisticsFile(cacheFile: string): string {
  return join(dirname(cacheFile), 'statistics-v1.json')
}

/** Combine independently persisted topic summaries for the all-topics dashboard. */
export function mergeStatisticsOverviews(overviews: readonly StatisticsOverview[], query: StatisticsQuery): StatisticsOverview {
  const totals = blankTotals()
  const daily = new Map<string, DailyStatistics>()
  const tools = new Map<VerifierToolName, ToolStatistics>()
  const models = new Map<string, ModelStatistics>()
  let weightedDuration = 0
  for (const overview of overviews) {
    const source = overview.totals
    weightedDuration += source.averageDurationMs * source.invocations
    for (const key of ['invocations', 'successes', 'failures', 'calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd', 'topLogprobScores', 'explicitTagScores'] as const) totals[key] += source[key]
    for (const row of overview.daily) {
      const target = daily.get(row.date) ?? { date: row.date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} }
      for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'estimatedCostUsd'] as const) target[key] += row[key]
      for (const [tool, count] of Object.entries(row.byTool)) target.byTool[tool] = (target.byTool[tool] ?? 0) + count
      daily.set(row.date, target)
    }
    for (const row of overview.tools) {
      const target = tools.get(row.toolName) ?? { toolName: row.toolName, invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0 }
      target.averageDurationMs = (target.averageDurationMs * target.invocations + row.averageDurationMs * row.invocations) / (target.invocations + row.invocations || 1)
      for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd'] as const) target[key] += row[key]
      target.successRate = ratio(target.successes, target.invocations)
      tools.set(row.toolName, target)
    }
    for (const row of overview.models) {
      const key = row.provider + '\u0000' + row.model
      const target = models.get(key) ?? { provider: row.provider, model: row.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 }
      for (const field of ['invocations', 'calls', 'tokens', 'estimatedCostUsd'] as const) target[field] += row[field]
      models.set(key, target)
    }
  }
  totals.averageDurationMs = ratio(weightedDuration, totals.invocations)
  totals.successRate = ratio(totals.successes, totals.invocations)
  totals.cacheHitRate = ratio(totals.cacheHits, totals.cacheHits + totals.cacheMisses)
  totals.prefixCacheHitRate = ratio(totals.cachedInputTokens, totals.inputTokens + totals.cachedInputTokens)
  const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)))
  return {
    generatedAt: Date.now(), fromMs: query.fromMs, toMs: query.toMs,
    ...(query.sessionId ? { sessionId: query.sessionId } : {}), totals,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tools: [...tools.values()].sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName)),
    models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    recent: overviews.flatMap(value => value.recent).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
  }
}

export class StatisticsStore {
  private loaded = false
  private hydrating: Promise<void> | undefined
  private records: InvocationRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly maxEntries = 50_000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('llm-verifier: statistics maxEntries must be a positive integer')
  }

  async record(input: InvocationInput): Promise<InvocationRecord> {
    const finishedAt = input.finishedAt ?? Date.now()
    const verdict = cleanVerdict(input.verdict)
    const route = cleanRoute(input.route)
    const record: InvocationRecord = {
      id: randomUUID(),
      toolName: input.toolName,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      startedAt: input.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - input.startedAt),
      success: input.success,
      ...(input.errorName ? { errorName: cleanError(input.errorName) } : {}),
      ...(input.errorMessage ? { errorMessage: cleanError(input.errorMessage) } : {}),
      provider: input.provider,
      model: input.model,
      stats: { ...input.stats },
      ...(verdict !== undefined ? { verdict } : {}),
      ...(route !== undefined ? { route } : {}),
    }
    const operation = async () => {
      await this.load()
      this.records.push(record)
      if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries)
      await this.persist()
    }
    this.writing = this.writing.then(operation, operation)
    await this.writing
    return record
  }

  /**
   * Correct the observation and outcome of one ALREADY RECORDED invocation.
   *
   * A record can be written before the last thing that changes its meaning is known: a P06
   * process-selection cycle records its decision so the spend is never lost, and only then hands the
   * winner to the host — a switch turned off in that window changes what the host actually received.
   * `route.replayed` means which stream the host was given, so leaving the intention in place would
   * report a replacement that never happened. The merged values go back through the same whitelist,
   * so a correction can never introduce an undeclared field.
   * @param cycleId - `RouteObservation.cycleId` of the invocation to correct.
   * @param patch - outcome and/or replayed value to overwrite.
   * @returns True when a matching record was found and persisted.
   */
  async amend(cycleId: string, patch: { outcome?: string; replayed?: 'original' | 'candidate' | 'none' }): Promise<boolean> {
    if (typeof cycleId !== 'string' || cycleId === '') return false
    // An illegal value is REFUSED, not merged away: re-cleaning the merged observation would drop the
    // key entirely and silently ERASE the delivery a previous record already stated.
    if (patch.replayed !== undefined && patch.replayed !== 'original' && patch.replayed !== 'candidate' && patch.replayed !== 'none') return false
    let found = false
    const operation = async () => {
      await this.load()
      const record = this.records.find(row => row.route?.cycleId === cycleId)
      if (record === undefined) return
      const mergedRoute = cleanRoute({ ...record.route, ...(patch.replayed === undefined ? {} : { replayed: patch.replayed }) } as RouteObservation)
      if (mergedRoute !== undefined) record.route = mergedRoute
      if (patch.outcome !== undefined) {
        const mergedVerdict = cleanVerdict({ ...(record.verdict ?? {}), outcome: patch.outcome })
        if (mergedVerdict !== undefined) record.verdict = mergedVerdict
      }
      found = true
      await this.persist()
    }
    this.writing = this.writing.then(operation, operation)
    await this.writing
    return found
  }

  async overview(query: StatisticsQuery): Promise<StatisticsOverview> {
    if (!Number.isFinite(query.fromMs) || !Number.isFinite(query.toMs) || query.fromMs >= query.toMs) throw new Error('llm-verifier: statistics range must be finite and increasing')
    await this.writing.catch(() => {})
    await this.load()
    const offset = Number.isFinite(query.timezoneOffsetMinutes) ? Math.trunc(query.timezoneOffsetMinutes ?? 0) : 0
    const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)))
    const selected = this.records.filter(record => record.startedAt >= query.fromMs && record.startedAt < query.toMs && (query.sessionId === undefined || record.sessionId === query.sessionId))
    const totals = blankTotals()
    const daily = new Map<string, DailyStatistics>()
    const tools = new Map<VerifierToolName, { totals: StatisticsTotals; duration: number }>()
    const models = new Map<string, ModelStatistics>()
    for (const record of selected) {
      addRecord(totals, record)
      const date = localDate(record.startedAt, offset)
      const day = daily.get(date) ?? { date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} }
      day.invocations += 1
      record.success ? day.successes += 1 : day.failures += 1
      day.calls += record.stats.calls
      day.tokens += tokens(record.stats)
      day.estimatedCostUsd += record.stats.estimatedCostUsd
      day.byTool[record.toolName] = (day.byTool[record.toolName] ?? 0) + 1
      daily.set(date, day)
      const tool = tools.get(record.toolName) ?? { totals: blankTotals(), duration: 0 }
      addRecord(tool.totals, record)
      tool.duration += record.durationMs
      tools.set(record.toolName, tool)
      const modelKey = record.provider + '\u0000' + record.model
      const model = models.get(modelKey) ?? { provider: record.provider, model: record.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 }
      model.invocations += 1
      model.calls += record.stats.calls
      model.tokens += tokens(record.stats)
      model.estimatedCostUsd += record.stats.estimatedCostUsd
      models.set(modelKey, model)
    }
    finishTotals(totals)
    const toolRows = [...tools.entries()].map(([toolName, value]) => {
      const summary = finishTotals(value.totals)
      return { toolName, invocations: summary.invocations, successes: summary.successes, failures: summary.failures, successRate: summary.successRate, averageDurationMs: summary.averageDurationMs, calls: summary.calls, tokens: summary.tokens, cacheHits: summary.cacheHits, cacheMisses: summary.cacheMisses, estimatedCostUsd: summary.estimatedCostUsd }
    }).sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName))
    return {
      generatedAt: Date.now(),
      fromMs: query.fromMs,
      toMs: query.toMs,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      totals,
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      tools: toolRows,
      models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
      recent: [...selected].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.hydrating ??= (async () => {
      try {
        const document = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StatisticsDocument>
        if (document.version === 1 && Array.isArray(document.records)) {
          this.records = document.records.filter(isRecord).slice(-this.maxEntries)
        }
        this.loaded = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.loaded = true
          return
        }
        throw error
      } finally {
        this.hydrating = undefined
      }
    })()
    await this.hydrating
  }

  private async persist(): Promise<void> {
    const snapshot: StatisticsDocument = { version: 1, records: this.records }
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = this.file + '.tmp-' + process.pid + '-' + randomUUID()
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
    try { await rename(temporary, this.file) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }
}

export function emptyRunStats(): RunStats {
  return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
}

export function errorDetails(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) return { errorName: error.name || 'Error', errorMessage: error.message || String(error) }
  return { errorName: 'Error', errorMessage: String(error) }
}
