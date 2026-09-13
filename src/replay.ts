import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { extractScore } from './core.ts'
import { analyzeAutoTask, sessionAccepted, type AutoVerifyPolicy } from './auto.ts'
import { analyzeStructuredRoute, inspectDeliveryPhase, latestDirectUserSeq, semanticRouteHint } from './router.ts'

/** One persisted routing-cycle observation, reduced to what the offline report needs. */
export interface ReplayRouteObservation {
  cycleId: string
  trigger: string
  stage: string
  destination: string
  attempt?: number
  reservedCalls?: number
  skipReason?: string
  evidenceKept?: number
  evidenceOmitted?: number
  evidenceChars?: number
  usageIncomplete?: boolean
  canceled?: boolean
  /** P06: which stream the host actually received from the cycle. */
  replayed?: string
  /** P06: extra generation calls and judge calls the cycle bought. */
  generatedCalls?: number
  judgeCalls?: number
  /** P06: the alternative was byte-identical to the original, so no judge was called. */
  sameCandidate?: boolean
  /** P06: the alternative was generated with the failing-run evidence attached. */
  alternativeAugmented?: boolean
  /** P06: the `provider/model` the alternative was generated with. */
  alternativeModel?: string
}

/** One persisted invocation, reduced to the fields an acceptance decision depends on. */
export interface ReplayInvocation {
  toolName: string
  startedAt: number
  success: boolean
  /** Model calls the invocation actually completed (stats.calls). */
  calls: number
  score?: number
  baselineScore?: number
  winner?: 'A' | 'B' | 'tie'
  /** Terminal outcome of the invocation, when the verdict declares one (P06 cycle rows do). */
  outcome?: string
  criteria: Array<{ id: string; score: number }>
  /** Automatic routing-cycle observation, when the record carries one. */
  route?: ReplayRouteObservation
}

function numberAt(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Loose reader for one persisted route observation; an unknown shape is dropped, never fatal. */
export function parseRouteObservation(value: unknown): ReplayRouteObservation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.cycleId !== 'string' || !row.cycleId || typeof row.trigger !== 'string' || typeof row.stage !== 'string' || typeof row.destination !== 'string') return undefined
  const observation: ReplayRouteObservation = { cycleId: row.cycleId, trigger: row.trigger, stage: row.stage, destination: row.destination }
  for (const key of ['attempt', 'reservedCalls', 'evidenceKept', 'evidenceOmitted', 'evidenceChars'] as const) {
    const candidate = row[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) observation[key] = Math.trunc(candidate)
  }
  if (typeof row.skipReason === 'string' && row.skipReason) observation.skipReason = row.skipReason
  for (const key of ['generatedCalls', 'judgeCalls'] as const) {
    const candidate = row[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) observation[key] = Math.trunc(candidate)
  }
  if (row.usageIncomplete === true) observation.usageIncomplete = true
  if (row.canceled === true) observation.canceled = true
  if (typeof row.replayed === 'string' && row.replayed) observation.replayed = row.replayed
  if (row.sameCandidate === true) observation.sameCandidate = true
  if (row.alternativeAugmented === true) observation.alternativeAugmented = true
  if (typeof row.alternativeModel === 'string' && row.alternativeModel) observation.alternativeModel = row.alternativeModel
  return observation
}

/**
 * Read one topic's statistics file into the records a threshold sweep can replay.
 *
 * Loose on purpose, exactly like the store's own loader: a record written by an older or newer
 * plugin must not abort the replay. Records that carry no verdict (failed invocations) come back
 * with no score, and the sweep reports them as unscored rather than as acceptances.
 * @param text - raw `verifier/statistics-v1.json`.
 * @returns The parsed invocations; an unreadable document yields an empty list.
 */
export function parseStatisticsRecords(text: string): ReplayInvocation[] {
  let document: unknown
  try { document = JSON.parse(text) } catch { return [] }
  const records = typeof document === 'object' && document !== null ? (document as { records?: unknown }).records : undefined
  if (!Array.isArray(records)) return []
  const out: ReplayInvocation[] = []
  for (const entry of records) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const verdict = typeof row.verdict === 'object' && row.verdict !== null ? row.verdict as Record<string, unknown> : {}
    const criteria: Array<{ id: string; score: number }> = []
    for (const item of Array.isArray(verdict.criteria) ? verdict.criteria : []) {
      if (typeof item !== 'object' || item === null) continue
      const criterion = item as Record<string, unknown>
      if (typeof criterion.id !== 'string') continue
      const score = numberAt(criterion, 'score')
      if (score !== undefined) criteria.push({ id: criterion.id, score })
    }
    const score = numberAt(verdict, 'score')
    const baselineScore = numberAt(verdict, 'baselineScore')
    const winner = verdict.winner === 'A' || verdict.winner === 'B' || verdict.winner === 'tie' ? verdict.winner : undefined
    const outcome = typeof verdict.outcome === 'string' && verdict.outcome ? verdict.outcome : undefined
    const stats = typeof row.stats === 'object' && row.stats !== null ? row.stats as Record<string, unknown> : {}
    const route = parseRouteObservation(row.route)
    out.push({
      toolName: typeof row.toolName === 'string' ? row.toolName : '',
      startedAt: numberAt(row, 'startedAt') ?? 0,
      success: row.success === true,
      calls: numberAt(stats, 'calls') ?? 0,
      criteria,
      ...(score !== undefined ? { score } : {}),
      ...(baselineScore !== undefined ? { baselineScore } : {}),
      ...(winner !== undefined ? { winner } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
      ...(route !== undefined ? { route } : {}),
    })
  }
  return out
}

/** Why a recorded acceptance failed at one threshold, so a sweep shows WHAT the threshold decides. */
export interface ThresholdRow {
  threshold: number
  total: number
  accepted: number
  /** Losing to the empty-work baseline (or an unreadable verdict) can never pass. */
  rejectedVerdict: number
  /** The mean itself was below the threshold. */
  rejectedMean: number
  /** The mean passed but at least one criterion was below the threshold. */
  rejectedCriterion: number
  /** The record has no usable score (a failed invocation). */
  unscored: number
}

/**
 * Re-score every recorded session acceptance at each threshold with the LIVE acceptance rule.
 *
 * This is the tuning tool the plan calls for: `autoVerifyThreshold` (and the per-criterion
 * floor that {@link sessionAccepted} applies) is currently a hand-picked number with no evidence
 * behind it. The stored verdict already carries the session score, the baseline score, the winner
 * and the per-criterion scores — everything the gate looked at — so a sweep costs no model calls.
 *
 * Only `verifier_current_session` records are gate decisions; routed compare/select/track
 * verdicts use different thresholds and are skipped.
 * @param invocations - records from {@link parseStatisticsRecords}.
 * @param thresholds - thresholds to test, typically 0.5..0.9.
 * @returns One row per threshold, in the given order.
 */
export function sweepThresholds(invocations: readonly ReplayInvocation[], thresholds: readonly number[]): ThresholdRow[] {
  const gateRecords = invocations.filter(record => record.toolName === 'verifier_current_session')
  return thresholds.map(threshold => {
    const row: ThresholdRow = { threshold, total: gateRecords.length, accepted: 0, rejectedVerdict: 0, rejectedMean: 0, rejectedCriterion: 0, unscored: 0 }
    for (const record of gateRecords) {
      if (record.score === undefined || record.winner === undefined) { row.unscored += 1; continue }
      if (sessionAccepted({ score: record.score, winner: record.winner, criteria: record.criteria }, threshold)) { row.accepted += 1; continue }
      if (record.winner !== 'A') row.rejectedVerdict += 1
      else if (record.score < threshold) row.rejectedMean += 1
      else row.rejectedCriterion += 1
    }
    return row
  })
}

/** One captured judge call re-parsed through the current scorer. */
export interface DecisionReplayRow {
  label: string
  channel: string
  stored?: number
  reparsed?: number
  /**
   * `not-scored` means the answer carries no score tag at all — a route classification, or any
   * other non-scoring call. Counting those as failures made the report cry wolf on every
   * `track` and `verifier_route_classify` snapshot.
   */
  mode: 'match' | 'drift' | 'unreadable' | 'not-scored'
}

/**
 * Re-parse captured judge answers with the current score parser.
 *
 * A snapshot stores the raw answer, so the parser can be replayed offline: a pairwise call must
 * parse back to exactly the score it produced, and a drift means the parser (or the prompt format)
 * changed under a stored answer. A top-logprobs call's stored score is an expectation over a token
 * distribution the snapshot does not keep, so a text-channel re-parse is expected to differ and is
 * reported as drift — read those rows as informational, not as regressions.
 *
 * The tag depends on the call: pairwise judging answers `<score_A>`, while progress judging answers
 * `<c1>..<cN>` and the trace stores the LAST checkpoint, inverted (progress runs A = nothing done
 * .. T = certainly done, the reverse of the pairwise scale). A call with neither tag is a route
 * classification, i.e. not a score at all.
 * @param calls - captured calls with their raw answers.
 * @returns One row per call.
 */
export function replayDecisionScores(calls: ReadonlyArray<{ label: string; channel: string; output: string; score?: number }>): DecisionReplayRow[] {
  return calls.map(call => {
    const completion = { text: call.output, tokens: [], positions: [] }
    const progressTags = [...call.output.matchAll(/<c(\d+)>/gu)].map(match => '<c' + match[1] + '>')
    const tagged = call.output.includes('<score_A>') || progressTags.length > 0
    let reparsed: number | undefined
    if (tagged) {
      try {
        reparsed = call.output.includes('<score_A>')
          ? extractScore(completion, '<score_A>')
          : 1 - extractScore(completion, progressTags[progressTags.length - 1]!)
      } catch { reparsed = undefined }
    }
    const head = { label: call.label, channel: call.channel, ...(call.score !== undefined ? { stored: call.score } : {}) }
    if (!tagged) return { ...head, mode: 'not-scored' as const }
    if (reparsed === undefined) return { ...head, mode: 'unreadable' as const }
    return { ...head, reparsed, mode: call.score !== undefined && Math.abs(call.score - reparsed) < 1e-9 ? 'match' as const : 'drift' as const }
  })
}

/** Aggregate of the routing-cycle observations in one replay corpus. */
export interface RouteCycleSummary {
  cycles: number
  classificationRows: number
  executionRows: number
  finalRows: number
  skippedRows: number
  /** Cycles that classified successfully but could not afford their execution. */
  classificationOnly: number
  canceled: number
  usageIncomplete: number
  /** Execution rows whose trigger was the early agent/pre-step entry. */
  preStepExecutions: number
  /** Conservative calls the cycles reserved. */
  reservedCalls: number
  /** Model calls the executed rows actually completed. */
  actualScoringCalls: number
  /** Share of judged objects that reached a decision before implementation (S02). */
  preStepShare: number
  /** Share of classifications that never executed their decision. */
  classificationOnlyShare: number
  byTrigger: Record<string, number>
  byDestination: Record<string, number>
  bySkipReason: Record<string, number>
}

/**
 * Summarize the automatic routing cycles recorded by S05-A.
 *
 * Every unit here is deliberately distinct: a CYCLE is not a model call, a diagnostic row is
 * not a purchase, and a reserved call is not an actual one. The report exists so those three
 * are never added together.
 * @param invocations - records from parseStatisticsRecords.
 * @returns Counts and shares across every observed cycle.
 */
export function summarizeRouteCycles(invocations: readonly ReplayInvocation[]): RouteCycleSummary {
  const routed = invocations.filter(record => record.route !== undefined)
  const summary: RouteCycleSummary = { cycles: 0, classificationRows: 0, executionRows: 0, finalRows: 0, skippedRows: 0, classificationOnly: 0, canceled: 0, usageIncomplete: 0, preStepExecutions: 0, reservedCalls: 0, actualScoringCalls: 0, preStepShare: 0, classificationOnlyShare: 0, byTrigger: {}, byDestination: {}, bySkipReason: {} }
  const cycles = new Set<string>()
  // A promoted cycle reports a CUMULATIVE reservation on each of its rows (classification sees
  // the classification estimate, execution the promoted one), so the rows of one cycle are
  // never summed: the cycle's reservation is the largest it ever held.
  const reservedByCycle = new Map<string, number>()
  for (const record of routed) {
    const route = record.route!
    cycles.add(route.cycleId)
    summary.byTrigger[route.trigger] = (summary.byTrigger[route.trigger] ?? 0) + 1
    summary.byDestination[route.destination] = (summary.byDestination[route.destination] ?? 0) + 1
    if (route.skipReason !== undefined) summary.bySkipReason[route.skipReason] = (summary.bySkipReason[route.skipReason] ?? 0) + 1
    reservedByCycle.set(route.cycleId, Math.max(reservedByCycle.get(route.cycleId) ?? 0, route.reservedCalls ?? 0))
    if (route.canceled === true) summary.canceled += 1
    if (route.usageIncomplete === true) summary.usageIncomplete += 1
    if (route.skipReason === 'classification-only-budget') summary.classificationOnly += 1
    if (route.stage === 'classification') summary.classificationRows += 1
    else if (route.stage === 'execution') {
      summary.executionRows += 1
      summary.actualScoringCalls += record.calls
      if (route.trigger === 'pre-step') summary.preStepExecutions += 1
    } else if (route.stage === 'final') { summary.finalRows += 1; summary.actualScoringCalls += record.calls }
    else if (route.stage === 'skipped') summary.skippedRows += 1
  }
  summary.cycles = cycles.size
  summary.reservedCalls = [...reservedByCycle.values()].reduce((total, value) => total + value, 0)
  summary.preStepShare = summary.executionRows > 0 ? summary.preStepExecutions / summary.executionRows : 0
  summary.classificationOnlyShare = summary.classificationRows > 0 ? summary.classificationOnly / summary.classificationRows : 0
  return summary
}

/**
 * P06 process-selection cycle aggregate.
 *
 * A separate section on purpose: a process row is neither a routing decision nor a model call,
 * and its outcome is not a verdict about the task. The design note for the controlled comparison
 * (`.agents/notes/proposed/testing/2026-09-13-real-evaluation-samples-and-four-arm-controls.md`)
 * asks for exactly these numbers per arm, so they are computed here instead of by hand.
 */
export interface ProcessCycleSummary {
  /** Purchased cycles (a statistics row exists only after the reservation was taken). */
  purchased: number
  /** Declines that never reached a reservation (settings off, budget, unreadable intent...). */
  skipped: number
  /** Terminal outcome of every purchased cycle, from the verdict. */
  byOutcome: Record<string, number>
  /** Why a skipped cycle was skipped. */
  bySkipReason: Record<string, number>
  /** What the HOST actually received. */
  replayedOriginal: number
  replayedCandidate: number
  replayedNone: number
  /** `candidate` over purchased: the only replacement rate that counts. */
  effectiveReplacementRate: number
  sameCandidate: number
  sameCandidateRate: number
  /** Cycles whose alternative was generated with the failing-run evidence attached. */
  augmented: number
  augmentedReplacementRate: number
  plainReplacementRate: number
  /** Added model calls and the extra generation/judge split. */
  addedCalls: number
  generatedCalls: number
  judgeCalls: number
}

/**
 * Summarize the recorded P06 cycles.
 *
 * Reads only what the rows state: `replayed` is the delivery, not the decision, and a cycle whose
 * winner was withheld is therefore counted as an original replay (the plugin corrects that row for
 * exactly this reason). Rates are 0 when their denominator is 0, never NaN.
 * @param invocations - records from parseStatisticsRecords.
 * @returns Counts, arm split and rates across every observed process cycle.
 */
export function summarizeProcessCycles(invocations: readonly ReplayInvocation[]): ProcessCycleSummary {
  const rows = invocations.filter(record => record.route !== undefined && record.route.destination === 'process')
  const summary: ProcessCycleSummary = { purchased: 0, skipped: 0, byOutcome: {}, bySkipReason: {}, replayedOriginal: 0, replayedCandidate: 0, replayedNone: 0, effectiveReplacementRate: 0, sameCandidate: 0, sameCandidateRate: 0, augmented: 0, augmentedReplacementRate: 0, plainReplacementRate: 0, addedCalls: 0, generatedCalls: 0, judgeCalls: 0 }
  let augmentedReplays = 0
  let plainPurchased = 0
  let plainReplays = 0
  for (const record of rows) {
    const route = record.route!
    if (route.stage === 'skipped') {
      summary.skipped += 1
      const reason = route.skipReason ?? 'unknown'
      summary.bySkipReason[reason] = (summary.bySkipReason[reason] ?? 0) + 1
      continue
    }
    summary.purchased += 1
    summary.addedCalls += record.calls
    summary.generatedCalls += route.generatedCalls ?? 0
    summary.judgeCalls += route.judgeCalls ?? 0
    const outcome = record.outcome ?? 'unknown'
    summary.byOutcome[outcome] = (summary.byOutcome[outcome] ?? 0) + 1
    if (route.replayed === 'candidate') summary.replayedCandidate += 1
    else if (route.replayed === 'none') summary.replayedNone += 1
    else summary.replayedOriginal += 1
    if (route.sameCandidate === true) summary.sameCandidate += 1
    if (route.alternativeAugmented === true) {
      summary.augmented += 1
      if (route.replayed === 'candidate') augmentedReplays += 1
    } else {
      plainPurchased += 1
      if (route.replayed === 'candidate') plainReplays += 1
    }
  }
  summary.effectiveReplacementRate = summary.purchased > 0 ? summary.replayedCandidate / summary.purchased : 0
  summary.sameCandidateRate = summary.purchased > 0 ? summary.sameCandidate / summary.purchased : 0
  summary.augmentedReplacementRate = summary.augmented > 0 ? augmentedReplays / summary.augmented : 0
  summary.plainReplacementRate = plainPurchased > 0 ? plainReplays / plainPurchased : 0
  return summary
}
/** Sample strata the labeled evaluation must cover (the plan six groups). */
export const EVALUATION_CATEGORIES = ["code", "research", "writing", "candidates", "long-task", "conversational"] as const
export type EvaluationCategory = typeof EVALUATION_CATEGORIES[number]

/** One desensitised, labeled sample for the offline trigger/phase replay. */
export interface EvaluationSample {
  id: string
  category: EvaluationCategory
  /** Session event log, already desensitised. */
  events: readonly SessionEvent[]
  /** Whether this task SHOULD have been reviewed at all. */
  shouldReview: boolean
  /** Phases the strategy should have used, when shouldReview is true. */
  expectedPhases?: ReadonlyArray<"compare" | "select" | "track" | "final">
}

/** What the deterministic routing layers would do with one sample, with no model call. */
export interface SampleOutcome {
  id: string
  category: string
  expectedReview: boolean
  observedTrigger: boolean
  observedPhases: string[]
  deliveryReady: boolean
  eligible: boolean
  outcome: "hit" | "miss" | "false-trigger" | "correct-skip"
}

/** Trigger precision/recall and phase coverage over a labeled sample set. */
export interface EvaluationReport {
  samples: number
  hits: number
  misses: number
  falseTriggers: number
  correctSkips: number
  precision: number
  recall: number
  byCategory: Array<{ category: string; samples: number; hits: number; misses: number; falseTriggers: number; correctSkips: number }>
  phaseMatches: Array<{ phase: string; expected: number; observed: number }>
  outcomes: SampleOutcome[]
}

const DEFAULT_EVALUATION_POLICY: AutoVerifyPolicy = { mode: "smart", minToolCalls: 3, maxPerTask: 2, maxPerSession: 8, threshold: 0.65 }

/**
 * Run the deterministic routing layers over one labeled sample.
 *
 * Uses the PRODUCTION detectors (structured route, semantic hint, delivery phase, eligibility)
 * instead of a reimplementation, so the offline numbers cannot drift from the shipped
 * scheduling. It never calls a model: a semantic hint is only a hint, and whether the
 * classifier would really route is a question for the real-model comparison.
 * @param sample - labeled sample.
 * @param policy - eligibility policy; defaults to the shipped smart defaults.
 * @returns What the strategy would do.
 */
export function evaluateSample(sample: EvaluationSample, policy: AutoVerifyPolicy = DEFAULT_EVALUATION_POLICY): SampleOutcome {
  const events = sample.events
  const observedPhases: string[] = []
  let observedTrigger = false
  if (latestDirectUserSeq(events) !== undefined) {
    const decision = analyzeStructuredRoute(events, 8, 20_000, 60_000)
    if (decision !== undefined) { observedTrigger = true; observedPhases.push(decision.kind) }
    else if (semanticRouteHint(events)) { observedTrigger = true; observedPhases.push("semantic") }
  }
  const delivery = inspectDeliveryPhase(events)
  const deliveryReady = delivery !== undefined && delivery.todosComplete && delivery.verification !== undefined
  const eligible = analyzeAutoTask(events, policy).eligible
  // The mandatory final acceptance IS a review: an eligible task is graded even when neither the
  // structured nor the semantic route fired. Omitting it here made every eligible-but-unrouted
  // task (for example one with six final-acceptance requests) look like a MISS.
  if (eligible) { observedPhases.push("final"); observedTrigger = true }
  const outcome: SampleOutcome["outcome"] = sample.shouldReview
    ? (observedTrigger ? "hit" : "miss")
    : (observedTrigger ? "false-trigger" : "correct-skip")
  return { id: sample.id, category: sample.category, expectedReview: sample.shouldReview, observedTrigger, observedPhases, deliveryReady, eligible, outcome }
}

function ratio(numerator: number, denominator: number): number { return denominator > 0 ? numerator / denominator : 0 }

/**
 * Aggregate the labeled evaluation.
 *
 * Precision/recall are reported together with the sample counts and the per-category breakdown,
 * because a 30-sample set cannot establish a low false-accept rate on its own.
 * @param samples - labeled samples.
 * @param policy - eligibility policy.
 * @returns Trigger precision/recall, per-category counts and per-phase coverage.
 */
export function summarizeEvaluation(samples: readonly EvaluationSample[], policy: AutoVerifyPolicy = DEFAULT_EVALUATION_POLICY): EvaluationReport {
  const outcomes = samples.map(sample => evaluateSample(sample, policy))
  const hits = outcomes.filter(entry => entry.outcome === "hit").length
  const misses = outcomes.filter(entry => entry.outcome === "miss").length
  const falseTriggers = outcomes.filter(entry => entry.outcome === "false-trigger").length
  const correctSkips = outcomes.filter(entry => entry.outcome === "correct-skip").length
  const byCategory = EVALUATION_CATEGORIES.map(category => {
    const rows = outcomes.filter(entry => entry.category === category)
    return { category, samples: rows.length, hits: rows.filter(entry => entry.outcome === "hit").length, misses: rows.filter(entry => entry.outcome === "miss").length, falseTriggers: rows.filter(entry => entry.outcome === "false-trigger").length, correctSkips: rows.filter(entry => entry.outcome === "correct-skip").length }
  })
  const phaseMatches = ["compare", "select", "track", "final"].map(phase => ({
    phase,
    expected: samples.filter(sample => sample.expectedPhases?.includes(phase as never) === true).length,
    observed: outcomes.filter(entry => entry.observedPhases.includes(phase)).length,
  }))
  return { samples: samples.length, hits, misses, falseTriggers, correctSkips, precision: ratio(hits, hits + falseTriggers), recall: ratio(hits, hits + misses), byCategory, phaseMatches, outcomes }
}

/** Loose reader for one labeled sample file entry. */
export function parseEvaluationSample(value: unknown): EvaluationSample | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.id !== "string" || !row.id || !EVALUATION_CATEGORIES.includes(row.category as EvaluationCategory) || typeof row.shouldReview !== "boolean" || !Array.isArray(row.events)) return undefined
  const expected = Array.isArray(row.expectedPhases)
    ? row.expectedPhases.filter((phase): phase is "compare" | "select" | "track" | "final" => phase === "compare" || phase === "select" || phase === "track" || phase === "final")
    : undefined
  return { id: row.id, category: row.category as EvaluationCategory, events: row.events as SessionEvent[], shouldReview: row.shouldReview, ...(expected === undefined ? {} : { expectedPhases: expected }) }
}
