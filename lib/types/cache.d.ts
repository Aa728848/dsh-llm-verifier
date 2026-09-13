import type { UsageStats } from './caller.ts';
import type { Diagnostic } from './core.ts';
export interface CachedPairScore {
    scoreA: number;
    scoreB: number;
    usage: UsageStats;
    scoringMode: 'top-logprobs' | 'explicit-tag';
    createdAt: number;
    /**
     * Findings the judge located for THIS exact prompt (P04), when it reported any.
     *
     * Part of the stored payload rather than the identity: the key is the rendered prompt hash, so an
     * entry only ever answers the very same evidence it was produced from. Entries written before this
     * field existed simply have none, which is also what a judge answer without findings yields.
     */
    diagnostics?: Diagnostic[];
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
    private hydrating;
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