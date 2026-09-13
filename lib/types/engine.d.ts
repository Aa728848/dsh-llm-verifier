import { type UsageStats, type VerifierClientConfig, type VerifierImage } from './caller.ts';
import { ScoreCache, SingleFlight, type CachedPairScore } from './cache.ts';
import type { DecisionTrace } from './decisions.ts';
import { DEFAULT_GROUND_TRUTH_NOTE, type Criterion } from './core.ts';
export interface CompareOptions {
    problem: string;
    candidateA: string;
    candidateB: string;
    criteria?: readonly Criterion[];
    groundTruthNote?: string;
    repeats?: number;
    images?: readonly VerifierImage[];
    trace?: DecisionTrace; /** Prefix for this comparison's decision-snapshot labels; one invocation that judges twice on the same criteria needs them distinguishable. */
    traceLabelPrefix?: string;
}
export interface CriterionResult {
    id: string;
    name: string;
    scoreA: number;
    scoreB: number;
}
export interface RunStats extends UsageStats {
    cacheHits: number;
    cacheMisses: number;
    estimatedCostUsd: number;
    topLogprobScores: number;
    explicitTagScores: number;
    /**
     * At least one request failed before returning usage. The tokens it may have spent are
     * UNKNOWN, not zero: a failed call must not make the invocation look free.
     */
    usageIncomplete?: boolean;
    /** Calls that were attempted on the direct logprob transport and downgraded to explicit tags. */
    channelFallbacks?: number;
}
export interface JudgeScore {
    provider: string;
    model: string;
    label: string;
    ok: boolean;
    calls: number;
    error?: string;
    scoreA?: number;
    scoreB?: number;
    winner?: 'A' | 'B' | 'tie';
    scores?: number[];
    ranking?: number[];
}
export interface CompareResult {
    scoreA: number;
    scoreB: number;
    winner: 'A' | 'B' | 'tie';
    criteria: CriterionResult[];
    calls: number;
    stats: RunStats;
    judges: JudgeScore[];
    agreement: number;
    /** Set when both sides were byte-identical: no model call was made and both sides score 0.5. */
    identical?: true;
}
export interface SelectOptions {
    problem: string;
    candidates: readonly string[];
    criteria?: readonly Criterion[];
    groundTruthNote?: string;
    repeats?: number;
    pivots?: number;
    seed?: number;
    images?: readonly VerifierImage[];
    trace?: DecisionTrace;
}
export interface SelectResult {
    index: number;
    best: string;
    scores: number[];
    ranking: number[];
    pivots: number[];
    comparisons: number;
    calls: number;
    stats: RunStats;
    judges: JudgeScore[];
    /** Set when every candidate was byte-identical: no pair was judged and every score is 0.5. */
    identical?: true;
}
/**
 * Where an invocation records the usage it accumulated before it finally failed.
 *
 * The engine aggregates per-judge usage while jobs are still running, so a later job that
 * throws used to discard everything the earlier jobs had already spent: a run with two
 * successful calls then one failure was persisted as one attempt and zero tokens. Attaching
 * the live stats object to the error keeps every known request and token.
 */
/**
 * Usage accumulated before an invocation failed; undefined when the error carries none.
 *
 * The carrier may be a bare UsageStats (a caller-level response) or a full RunStats (an engine
 * accumulator). It is normalized here so no caller can merge a partial shape and turn the
 * RunStats-only counters into NaN (which the host serializes as null and rejects).
 */
export declare function partialStats(error: unknown): RunStats | undefined;
/**
 * Fold one nested run's counters into an accumulator (usage, cache, channel, incompleteness).
 *
 * Shared with index.ts so a multi-phase tool (best-of-N) accumulates generation, tournament and
 * baseline usage the same way. Never folds a value into itself, and zero-fills the RunStats-only
 * counters so a partial source cannot poison the totals with NaN.
 */
export declare function mergeRunStats(target: RunStats, source: (UsageStats & Partial<RunStats>) | undefined): void;
/**
 * Deterministic A/B slot for one pivot-round pair, balanced by construction.
 *
 * The round used to emit `[candidate, pivot]` for every edge, so the ring leaders sat
 * in trajectory B in all of their extra matches: with a judge that merely prefers slot A
 * the pivots averaged 0.36 against 0.60 for everyone else and sank in the final ranking.
 * Alternating on the sum of the two RANKS — not the raw indices: the pivot set is
 * selected by score, so its indices can share a parity and a parity rule would then
 * handicap half the field — gives every pivot and every candidate both slots within one
 * edge of each other, without a second model call.
 *
 * Deliberately NOT in core.ts: `pivotRoundPairs` is compared against the upstream Python
 * reference in `parity.test.ts`, so the orientation stays an orchestration-side decision.
 * @param pair - one unordered pair from the pivot round.
 * @param pivotRanks - pivot index → its rank among the pivots.
 * @param nonPivotRanks - candidate index → its rank among the non-pivots.
 * @returns The pair in the order it should be presented.
 */
export declare function orientRoundPairs(pairs: readonly (readonly [number, number])[]): Array<[number, number]>;
export declare class VerifierEngine {
    readonly client: VerifierClientConfig;
    readonly clients: readonly VerifierClientConfig[];
    readonly maxConcurrency: number;
    readonly cache: ScoreCache | undefined;
    readonly inputPrice: number;
    readonly outputPrice: number;
    private readonly flights;
    constructor(client: VerifierClientConfig | readonly VerifierClientConfig[], maxConcurrency?: number, cache?: ScoreCache, prices?: {
        input: number;
        output: number;
    }, flights?: SingleFlight<{
        value: CachedPairScore;
        hit: boolean;
    }>);
    private finishStats;
    private scoreOne;
    private mapLimited;
    /**
     * Verdict for a comparison whose two sides are byte-identical.
     *
     * Deliberately uninformative: no model call is made, both sides score 0.5 and the winner is
     * a tie. Judging identical text would ask the model to break a tie it cannot break, and any
     * confident score would let the acceptance gate pass a session indistinguishable from the
     * empty-work baseline. Callers that need "these are the same" read {@link CompareResult.identical}.
     * @param criteria - the criteria the comparison would have scored.
     * @returns A tie carrying 0.5 per criterion, zero calls and one agreeing judge per client.
     */
    private informationalTie;
    compare(options: CompareOptions, signal?: AbortSignal): Promise<CompareResult>;
    private scorePairs;
    track(problem: string, steps: readonly string[], checkpoints: readonly number[], repeats?: number, signal?: AbortSignal, images?: readonly VerifierImage[], trace?: DecisionTrace): Promise<{
        scores: number[];
        perRepeat: number[][];
        calls: number;
        stats: RunStats;
        judges: JudgeScore[];
    }>;
    /**
     * Verdict for a candidate list whose entries are all byte-identical.
     *
     * Ranking identical text is a coin flip, so the result is deliberately uninformative
     * (0.5 everywhere) rather than a confident 1.0. No model call is made. This is the
     * cost-saving half of upstream's majority-vote shortcut without its semantics: we never
     * declare an unjudged candidate the winner, we only decline to spend calls on a tie.
     * @param candidates - the identical candidates (length >= 2).
     * @returns A ranking with every score at 0.5 and zero calls.
     */
    private identicalCandidates;
    /**
     * Judge only the DISTINCT candidates, then expand the verdict back onto the caller's list.
     *
     * Duplicated candidates are the common case when an agent pastes several drafts of the same
     * artifact: every pair that touches a duplicate is a comparison that cannot change the
     * ranking but still costs model calls. The tournament runs on the distinct list and every
     * duplicate inherits its representative's score, so no index, score or ranking entry shifts.
     * @param options - the original select options, duplicates included.
     * @param signal - caller's abort signal.
     * @returns The tournament verdict mapped back onto the original candidate list.
     */
    private selectUnique;
    select(options: SelectOptions, signal?: AbortSignal): Promise<SelectResult>;
}
/**
 * Normalize a caller-supplied `criteria` argument into the engine's canonical shape.
 *
 * Mirrors upstream's `normalize_criteria` so a caller does not have to fill in every field: a
 * plain string is both the name and the instruction, and a missing `id` is slugged from the
 * name (the score cache keys on the rendered prompt, so a slug is cosmetic). Ids are
 * de-duplicated because `compare` groups per-criterion results by id — a collision would
 * silently merge two criteria into one line of the verdict.
 * @param input - undefined (the default rubric), or a non-empty array of strings/objects.
 * @returns The criteria the engine will score with.
 */
export declare function normalizeCriteria(input: unknown): Criterion[];
export { DEFAULT_GROUND_TRUTH_NOTE };
//# sourceMappingURL=engine.d.ts.map