import type { UsageStats } from './caller.ts';
export interface CachedPairScore {
    scoreA: number;
    scoreB: number;
    usage: UsageStats;
    scoringMode: 'top-logprobs' | 'explicit-tag';
    createdAt: number;
}
export declare function stableHash(value: unknown): string;
export declare function resolveCacheFile(cacheDir: string, cwd?: string): string;
/** Channel-independent single-flight: concurrent identical tasks share one promise; joiners are flagged so callers can avoid double-counting usage. */
export declare class SingleFlight<T> {
    private readonly flights;
    run(key: string, task: () => Promise<T>): Promise<{
        value: T;
        joined: boolean;
    }>;
}
export declare class ScoreCache {
    private readonly file;
    private readonly maxEntries;
    private loaded;
    private entries;
    private readonly inflight;
    private writing;
    constructor(file: string, maxEntries: number);
    load(): Promise<void>;
    getOrCreate(key: string, create: () => Promise<CachedPairScore>, keyFor?: (value: CachedPairScore) => string): Promise<{
        value: CachedPairScore;
        hit: boolean;
    }>;
    private trim;
    private persist;
}
//# sourceMappingURL=cache.d.ts.map