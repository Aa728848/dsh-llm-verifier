import { type UsageStats, type VerifierClientConfig, type VerifierImage } from './caller.ts';
import { ScoreCache } from './cache.ts';
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
export interface CompareResult {
    scoreA: number;
    scoreB: number;
    winner: 'A' | 'B' | 'tie';
    criteria: CriterionResult[];
    calls: number;
    stats: RunStats;
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
}
export declare class VerifierEngine {
    readonly client: VerifierClientConfig;
    readonly maxConcurrency: number;
    readonly cache: ScoreCache | undefined;
    readonly inputPrice: number;
    readonly outputPrice: number;
    constructor(client: VerifierClientConfig, maxConcurrency?: number, cache?: ScoreCache, prices?: {
        input: number;
        output: number;
    });
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
    }>;
    select(options: SelectOptions, signal?: AbortSignal): Promise<SelectResult>;
}
export declare function normalizeCriteria(input: unknown): Criterion[];
export { DEFAULT_GROUND_TRUTH_NOTE };
//# sourceMappingURL=engine.d.ts.map