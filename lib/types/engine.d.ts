import { type UsageStats, type VerifierClientConfig, type VerifierImage } from './caller.ts';
import { ScoreCache, SingleFlight, type CachedPairScore } from './cache.ts';
import { DEFAULT_GROUND_TRUTH_NOTE, type Criterion } from './core.ts';
export interface CompareOptions {
    problem: string;
    candidateA: string;
    candidateB: string;
    criteria?: readonly Criterion[];
    groundTruthNote?: string;
    repeats?: number;
    images?: readonly VerifierImage[];
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
}
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
    compare(options: CompareOptions, signal?: AbortSignal): Promise<CompareResult>;
    private scorePairs;
    track(problem: string, steps: readonly string[], checkpoints: readonly number[], repeats?: number, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<{
        scores: number[];
        perRepeat: number[][];
        calls: number;
        stats: RunStats;
        judges: JudgeScore[];
    }>;
    select(options: SelectOptions, signal?: AbortSignal): Promise<SelectResult>;
}
export declare function normalizeCriteria(input: unknown): Criterion[];
export { DEFAULT_GROUND_TRUTH_NOTE };
//# sourceMappingURL=engine.d.ts.map