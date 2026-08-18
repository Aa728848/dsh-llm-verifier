/** Pure scoring and Probabilistic Pivot Tournament primitives. */
export interface Criterion {
    id: string;
    name: string;
    description: string;
}
export interface TokenAlternative {
    token: string;
    logprob: number;
}
export interface CompletionLogprobs {
    text: string;
    tokens: string[];
    positions: TokenAlternative[][];
}
export interface CandidateScore {
    index: number;
    score: number;
}
export declare const GRANULARITY = 20;
export declare const LETTERS: string[];
export declare const SCALE_DESCRIPTION: string;
export declare const DEFAULT_CRITERIA: Criterion[];
export declare const DEFAULT_GROUND_TRUTH_NOTE = "**IMPORTANT:** Focus on observed tool and terminal output as ground truth. Do NOT trust the agent's self-assessment or claims of success.";
export declare function normalizeScoreLetter(token: string): string | undefined;
export declare function extractScore(completion: CompletionLogprobs, tag: string): number;
export declare function buildPairwisePrompt(problem: string, traceA: string, traceB: string, criterion: Criterion, groundTruthNote?: string): string;
export declare function buildProgressPrompt(problem: string, steps: readonly string[], checkpoints: readonly number[]): string;
/** Progress uses A=NO..T=YES, the reverse of pairwise success scoring. */
export declare function extractProgressScore(completion: CompletionLogprobs, tag: string): number;
export declare function bradleyTerry(rewardA: number, rewardB: number): number;
export declare function seededRandom(seed: number): () => number;
export declare function ringCycle(count: number, seed?: number): Array<[number, number]>;
export declare function pivotRoundPairs(count: number, pivots: readonly number[]): Array<[number, number]>;
export declare function accumulatePairs(pairs: readonly [number, number][], rewards: ReadonlyMap<string, readonly [number, number]>, wins: number[], counts: number[]): void;
export declare function topPivots(wins: readonly number[], counts: readonly number[], requested: number): number[];
export declare function rankScores(wins: readonly number[], counts: readonly number[]): CandidateScore[];
//# sourceMappingURL=core.d.ts.map