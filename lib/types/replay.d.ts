/** One persisted invocation, reduced to the fields an acceptance decision depends on. */
export interface ReplayInvocation {
    toolName: string;
    startedAt: number;
    success: boolean;
    score?: number;
    baselineScore?: number;
    winner?: 'A' | 'B' | 'tie';
    criteria: Array<{
        id: string;
        score: number;
    }>;
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
export declare function parseStatisticsRecords(text: string): ReplayInvocation[];
/** Why a recorded acceptance failed at one threshold, so a sweep shows WHAT the threshold decides. */
export interface ThresholdRow {
    threshold: number;
    total: number;
    accepted: number;
    /** Losing to the empty-work baseline (or an unreadable verdict) can never pass. */
    rejectedVerdict: number;
    /** The mean itself was below the threshold. */
    rejectedMean: number;
    /** The mean passed but at least one criterion was below the threshold. */
    rejectedCriterion: number;
    /** The record has no usable score (a failed invocation). */
    unscored: number;
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
export declare function sweepThresholds(invocations: readonly ReplayInvocation[], thresholds: readonly number[]): ThresholdRow[];
/** One captured judge call re-parsed through the current scorer. */
export interface DecisionReplayRow {
    label: string;
    channel: string;
    stored?: number;
    reparsed?: number;
    mode: 'match' | 'drift' | 'unreadable';
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
export declare function replayDecisionScores(calls: ReadonlyArray<{
    label: string;
    channel: string;
    output: string;
    score?: number;
}>): DecisionReplayRow[];
//# sourceMappingURL=replay.d.ts.map