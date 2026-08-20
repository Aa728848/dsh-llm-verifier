import type { RunStats } from './engine.ts';
export declare const VERIFIER_TOOL_NAMES: readonly ["verifier_route_classify", "verifier_compare", "verifier_select", "verifier_track", "verifier_current_session"];
export type VerifierToolName = typeof VERIFIER_TOOL_NAMES[number];
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
    cacheHitRate: number;
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
    sessionId?: string;
    startedAt: number;
    finishedAt?: number;
    success: boolean;
    errorName?: string;
    errorMessage?: string;
    provider: string;
    model: string;
    stats: RunStats;
}
export declare function resolveStatisticsFile(cacheFile: string): string;
/** Combine independently persisted topic summaries for the all-topics dashboard. */
export declare function mergeStatisticsOverviews(overviews: readonly StatisticsOverview[], query: StatisticsQuery): StatisticsOverview;
export declare class StatisticsStore {
    private readonly file;
    private readonly maxEntries;
    private loaded;
    private records;
    private writing;
    constructor(file: string, maxEntries?: number);
    record(input: InvocationInput): Promise<InvocationRecord>;
    overview(query: StatisticsQuery): Promise<StatisticsOverview>;
    private load;
    private persist;
}
export declare function emptyRunStats(): RunStats;
export declare function errorDetails(error: unknown): {
    errorName: string;
    errorMessage: string;
};
//# sourceMappingURL=statistics.d.ts.map