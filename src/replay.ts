import { extractScore } from './core.ts'
import { sessionAccepted } from './auto.ts'

/** One persisted invocation, reduced to the fields an acceptance decision depends on. */
export interface ReplayInvocation {
  toolName: string
  startedAt: number
  success: boolean
  score?: number
  baselineScore?: number
  winner?: 'A' | 'B' | 'tie'
  criteria: Array<{ id: string; score: number }>
}

function numberAt(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
    out.push({
      toolName: typeof row.toolName === 'string' ? row.toolName : '',
      startedAt: numberAt(row, 'startedAt') ?? 0,
      success: row.success === true,
      criteria,
      ...(score !== undefined ? { score } : {}),
      ...(baselineScore !== undefined ? { baselineScore } : {}),
      ...(winner !== undefined ? { winner } : {}),
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
  mode: 'match' | 'drift' | 'unreadable'
}

/**
 * Re-parse captured judge answers with the current score parser.
 *
 * A snapshot stores the raw answer, so the parser can be replayed offline: an explicit-tag call
 * must parse back to exactly the score it produced, and a drift means the parser (or the prompt
 * format) changed under a stored answer. A top-logprobs call's stored score is an expectation
 * over a token distribution the snapshot does not keep, so a text-channel re-parse is expected to
 * differ and is reported as drift — read those rows as informational, not as regressions.
 * @param calls - captured calls with their raw answers.
 * @returns One row per call.
 */
export function replayDecisionScores(calls: ReadonlyArray<{ label: string; channel: string; output: string; score?: number }>): DecisionReplayRow[] {
  return calls.map(call => {
    let reparsed: number | undefined
    try { reparsed = extractScore({ text: call.output, tokens: [], positions: [] }, '<score_A>') } catch { reparsed = undefined }
    if (reparsed === undefined) return { label: call.label, channel: call.channel, ...(call.score !== undefined ? { stored: call.score } : {}), mode: 'unreadable' as const }
    const mode = call.score !== undefined && Math.abs(call.score - reparsed) < 1e-9 ? 'match' as const : 'drift' as const
    return { label: call.label, channel: call.channel, ...(call.score !== undefined ? { stored: call.score } : {}), reparsed, mode }
  })
}
