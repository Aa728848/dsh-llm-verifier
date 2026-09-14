import type { RunStats } from './engine.ts';
export declare const VERIFIER_TOOL_NAMES: readonly ["verifier_route_classify", "verifier_compare", "verifier_select", "verifier_track", "verifier_best_of_n", "verifier_current_session"];
export type VerifierToolName = typeof VERIFIER_TOOL_NAMES[number];
export interface VerdictSummary {
    phase?: string;
    outcome?: string;
    score?: number;
    /** Per-checkpoint progression of a `verifier_track` verdict, oldest first. Optional: old records do not carry it. */
    scores?: number[];
    /** Candidate B's score of a two-way comparison; `score` is the winning side. */
    scoreB?: number;
    /** Per-criterion A-side scores of a session acceptance; the mean alone can hide a failed requirement. */
    criteria?: Array<{
        id: string;
        score: number;
    }>;
    baselineScore?: number;
    winner?: 'A' | 'B' | 'tie';
    threshold?: number;
    /**
     * Review stage the call declared (P02): `proposal` means unexecuted plans/drafts.
     *
     * Optional and additive: old records have no stage and are rendered as artifacts, which is
     * exactly the semantics they were produced under.
     */
    reviewStage?: string;
    /** Which rubric produced the score: a preset id, `proposal`, `explicit`, `custom` or `fallback`. */
    criteriaSource?: string;
}
/** Thresholds the verdict summary needs; plain values keep the mapping a pure function. */
export interface VerdictThresholds {
    autoVerifyThreshold: number;
    autoTrackCompletionThreshold: number;
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
export declare function summarizeVerdict(toolName: VerifierToolName, value: unknown, phase: string, thresholds: VerdictThresholds): VerdictSummary;
/** Host boundary that started an automatic routing cycle. */
export type RouteTrigger = 'turn-stopping' | 'plan' | 'team' | 'pre-step' | 'llm-stream';
/** Stage of the cycle a statistics row describes. */
export type RouteStage = 'classification' | 'execution' | 'final' | 'skipped' | 'process';
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
    cycleId: string;
    /** Which host boundary started the cycle. */
    trigger: RouteTrigger;
    /** Which stage of the cycle this row reports. */
    stage: RouteStage;
    /** Decision kind the cycle reached, or 'none' when it deliberately did not route. */
    destination: string;
    /** 1-based route attempt the cycle consumed, when it reached a reservation. */
    attempt?: number;
    /** Conservative model calls the cycle had reserved at the time of this row. */
    reservedCalls?: number;
    /** Why the cycle ended without executing a decision. */
    skipReason?: string;
    /** Evidence items the bounded routing view actually rendered. */
    evidenceKept?: number;
    /** Evidence items the same view omitted for budget reasons. */
    evidenceOmitted?: number;
    /** Exact characters of the rendered evidence payload. */
    evidenceChars?: number;
    /** True when at least one request this row paid for failed before returning usage. */
    usageIncomplete?: boolean;
    /** True when the task, snapshot or signal stopped being current mid-cycle. */
    canceled?: boolean;
    /**
     * P06 process selection: which stream was actually replayed to the host.
     *
     * `original` is the fallback for every decline (candidate failed, tie, identical, stale,
     * budget); `none` means not even a replay decision was reached (the intent never matched a
     * request, or the cycle was never purchased). Only `candidate` means the generated reply ran.
     */
    replayed?: 'original' | 'candidate' | 'none';
    /** Extra generation calls this cycle bought (0 or 1 on the shipped N=2 design). */
    generatedCalls?: number;
    /** Judge calls this cycle bought. */
    judgeCalls?: number;
    /** The normalized candidate was byte-identical to the original, so no judge was called. */
    sameCandidate?: boolean;
    /**
     * P06: the alternative was generated WITH the failing-run evidence attached.
     *
     * The A/B discriminator for the controlled comparison of the two designs (resample the same
     * prompt vs. hand the extra candidate the failure): without it the two arms are indistinguishable
     * in the stored rows.
     */
    alternativeAugmented?: boolean;
    /** P06: the `provider/model` the alternative was generated with, when it was not the request's own. */
    alternativeModel?: string;
}
export interface InvocationRecord {
    id: string;
    toolName: VerifierToolName;
    sessionId?: string;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    success: boolean;
    errorName?: string;
    errorMessage?: string;
    provider: string;
    model: string;
    stats: RunStats;
    verdict?: VerdictSummary;
    /** Automatic routing-cycle observation; absent on explicit calls and on old records. */
    route?: RouteObservation;
}
export interface DailyStatistics {
    date: string;
    invocations: number;
    successes: number;
    failures: number;
    calls: number;
    tokens: number;
    estimatedCostUsd: number;
    byTool: Record<string, number>;
}
export interface ToolStatistics {
    toolName: VerifierToolName;
    invocations: number;
    successes: number;
    failures: number;
    successRate: number;
    averageDurationMs: number;
    calls: number;
    tokens: number;
    cacheHits: number;
    cacheMisses: number;
    estimatedCostUsd: number;
}
export interface ModelStatistics {
    provider: string;
    model: string;
    invocations: number;
    calls: number;
    tokens: number;
    estimatedCostUsd: number;
}
export interface StatisticsTotals {
    invocations: number;
    successes: number;
    failures: number;
    successRate: number;
    averageDurationMs: number;
    calls: number;
    attempts: number;
    retries: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    tokens: number;
    cacheHits: number;
    cacheMisses: number;
    /** Share of score-cache lookups answered locally (no model call). */
    cacheHitRate: number;
    /**
     * Share of verifier input tokens served by the PROVIDER's prefix cache.
     *
     * A different thing from {@link cacheHitRate}: that one counts local score-cache lookups,
     * this one counts tokens the backend billed as cache hits. It is the metric a warm-up or
     * prompt-ordering change moves, and leaving the two merged hid a 30%-hit-rate prefix cache.
     */
    prefixCacheHitRate: number;
    estimatedCostUsd: number;
    topLogprobScores: number;
    explicitTagScores: number;
}
export interface StatisticsOverview {
    generatedAt: number;
    fromMs: number;
    toMs: number;
    sessionId?: string;
    totals: StatisticsTotals;
    daily: DailyStatistics[];
    tools: ToolStatistics[];
    models: ModelStatistics[];
    recent: InvocationRecord[];
}
export interface StatisticsQuery {
    fromMs: number;
    toMs: number;
    timezoneOffsetMinutes?: number;
    sessionId?: string;
    recentLimit?: number;
}
export interface InvocationInput {
    toolName: VerifierToolName;
    /**
     * Invocation id; a fresh uuid when omitted.
     *
     * Shared with the decision snapshot of the same invocation: the dashboard lists these rows and
     * asks for "the snapshot of THIS row" by the id it was listed under, so the caller passes the
     * id the snapshot was filed with (see `decisions.ts`).
     */
    id?: string;
    sessionId?: string;
    startedAt: number;
    finishedAt?: number;
    success: boolean;
    errorName?: string;
    errorMessage?: string;
    provider: string;
    model: string;
    stats: RunStats;
    verdict?: VerdictSummary;
    route?: RouteObservation;
}
export declare function parseStatisticsQuery(payload: unknown): {
    ok: true;
    query: StatisticsQuery;
} | {
    ok: false;
    message: string;
};
export declare function resolveStatisticsFile(cacheFile: string): string;
/** Combine independently persisted topic summaries for the all-topics dashboard. */
export declare function mergeStatisticsOverviews(overviews: readonly StatisticsOverview[], query: StatisticsQuery): StatisticsOverview;
export declare class StatisticsStore {
    private readonly file;
    private readonly maxEntries;
    private loaded;
    private hydrating;
    private records;
    private writing;
    constructor(file: string, maxEntries?: number);
    record(input: InvocationInput): Promise<InvocationRecord>;
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
    amend(cycleId: string, patch: {
        outcome?: string;
        replayed?: 'original' | 'candidate' | 'none';
    }): Promise<boolean>;
    overview(query: StatisticsQuery): Promise<StatisticsOverview>;
    load(): Promise<void>;
    private persist;
}
export declare function emptyRunStats(): RunStats;
export declare function errorDetails(error: unknown): {
    errorName: string;
    errorMessage: string;
};
//# sourceMappingURL=statistics.d.ts.map