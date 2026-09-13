import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type AutoVerifyPolicy } from './auto.ts';
/** One persisted routing-cycle observation, reduced to what the offline report needs. */
export interface ReplayRouteObservation {
    cycleId: string;
    trigger: string;
    stage: string;
    destination: string;
    attempt?: number;
    reservedCalls?: number;
    skipReason?: string;
    evidenceKept?: number;
    evidenceOmitted?: number;
    evidenceChars?: number;
    usageIncomplete?: boolean;
    canceled?: boolean;
    /** P06: which stream the host actually received from the cycle. */
    replayed?: string;
    /** P06: extra generation calls and judge calls the cycle bought. */
    generatedCalls?: number;
    judgeCalls?: number;
    /** P06: the alternative was byte-identical to the original, so no judge was called. */
    sameCandidate?: boolean;
    /** P06: the alternative was generated with the failing-run evidence attached. */
    alternativeAugmented?: boolean;
}
/** One persisted invocation, reduced to the fields an acceptance decision depends on. */
export interface ReplayInvocation {
    toolName: string;
    startedAt: number;
    success: boolean;
    /** Model calls the invocation actually completed (stats.calls). */
    calls: number;
    score?: number;
    baselineScore?: number;
    winner?: 'A' | 'B' | 'tie';
    /** Terminal outcome of the invocation, when the verdict declares one (P06 cycle rows do). */
    outcome?: string;
    criteria: Array<{
        id: string;
        score: number;
    }>;
    /** Automatic routing-cycle observation, when the record carries one. */
    route?: ReplayRouteObservation;
}
/** Loose reader for one persisted route observation; an unknown shape is dropped, never fatal. */
export declare function parseRouteObservation(value: unknown): ReplayRouteObservation | undefined;
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
    /**
     * `not-scored` means the answer carries no score tag at all — a route classification, or any
     * other non-scoring call. Counting those as failures made the report cry wolf on every
     * `track` and `verifier_route_classify` snapshot.
     */
    mode: 'match' | 'drift' | 'unreadable' | 'not-scored';
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
export declare function replayDecisionScores(calls: ReadonlyArray<{
    label: string;
    channel: string;
    output: string;
    score?: number;
}>): DecisionReplayRow[];
/** Aggregate of the routing-cycle observations in one replay corpus. */
export interface RouteCycleSummary {
    cycles: number;
    classificationRows: number;
    executionRows: number;
    finalRows: number;
    skippedRows: number;
    /** Cycles that classified successfully but could not afford their execution. */
    classificationOnly: number;
    canceled: number;
    usageIncomplete: number;
    /** Execution rows whose trigger was the early agent/pre-step entry. */
    preStepExecutions: number;
    /** Conservative calls the cycles reserved. */
    reservedCalls: number;
    /** Model calls the executed rows actually completed. */
    actualScoringCalls: number;
    /** Share of judged objects that reached a decision before implementation (S02). */
    preStepShare: number;
    /** Share of classifications that never executed their decision. */
    classificationOnlyShare: number;
    byTrigger: Record<string, number>;
    byDestination: Record<string, number>;
    bySkipReason: Record<string, number>;
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
export declare function summarizeRouteCycles(invocations: readonly ReplayInvocation[]): RouteCycleSummary;
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
    purchased: number;
    /** Declines that never reached a reservation (settings off, budget, unreadable intent...). */
    skipped: number;
    /** Terminal outcome of every purchased cycle, from the verdict. */
    byOutcome: Record<string, number>;
    /** Why a skipped cycle was skipped. */
    bySkipReason: Record<string, number>;
    /** What the HOST actually received. */
    replayedOriginal: number;
    replayedCandidate: number;
    replayedNone: number;
    /** `candidate` over purchased: the only replacement rate that counts. */
    effectiveReplacementRate: number;
    sameCandidate: number;
    sameCandidateRate: number;
    /** Cycles whose alternative was generated with the failing-run evidence attached. */
    augmented: number;
    augmentedReplacementRate: number;
    plainReplacementRate: number;
    /** Added model calls and the extra generation/judge split. */
    addedCalls: number;
    generatedCalls: number;
    judgeCalls: number;
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
export declare function summarizeProcessCycles(invocations: readonly ReplayInvocation[]): ProcessCycleSummary;
/** Sample strata the labeled evaluation must cover (the plan six groups). */
export declare const EVALUATION_CATEGORIES: readonly ["code", "research", "writing", "candidates", "long-task", "conversational"];
export type EvaluationCategory = typeof EVALUATION_CATEGORIES[number];
/** One desensitised, labeled sample for the offline trigger/phase replay. */
export interface EvaluationSample {
    id: string;
    category: EvaluationCategory;
    /** Session event log, already desensitised. */
    events: readonly SessionEvent[];
    /** Whether this task SHOULD have been reviewed at all. */
    shouldReview: boolean;
    /** Phases the strategy should have used, when shouldReview is true. */
    expectedPhases?: ReadonlyArray<"compare" | "select" | "track" | "final">;
}
/** What the deterministic routing layers would do with one sample, with no model call. */
export interface SampleOutcome {
    id: string;
    category: string;
    expectedReview: boolean;
    observedTrigger: boolean;
    observedPhases: string[];
    deliveryReady: boolean;
    eligible: boolean;
    outcome: "hit" | "miss" | "false-trigger" | "correct-skip";
}
/** Trigger precision/recall and phase coverage over a labeled sample set. */
export interface EvaluationReport {
    samples: number;
    hits: number;
    misses: number;
    falseTriggers: number;
    correctSkips: number;
    precision: number;
    recall: number;
    byCategory: Array<{
        category: string;
        samples: number;
        hits: number;
        misses: number;
        falseTriggers: number;
        correctSkips: number;
    }>;
    phaseMatches: Array<{
        phase: string;
        expected: number;
        observed: number;
    }>;
    outcomes: SampleOutcome[];
}
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
export declare function evaluateSample(sample: EvaluationSample, policy?: AutoVerifyPolicy): SampleOutcome;
/**
 * Aggregate the labeled evaluation.
 *
 * Precision/recall are reported together with the sample counts and the per-category breakdown,
 * because a 30-sample set cannot establish a low false-accept rate on its own.
 * @param samples - labeled samples.
 * @param policy - eligibility policy.
 * @returns Trigger precision/recall, per-category counts and per-phase coverage.
 */
export declare function summarizeEvaluation(samples: readonly EvaluationSample[], policy?: AutoVerifyPolicy): EvaluationReport;
/** Loose reader for one labeled sample file entry. */
export declare function parseEvaluationSample(value: unknown): EvaluationSample | undefined;
//# sourceMappingURL=replay.d.ts.map