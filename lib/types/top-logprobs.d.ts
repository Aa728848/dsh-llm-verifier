import type { Context } from '@deepseek-ai/cordis';
import type { CompletionLogprobs } from './core.ts';
import type { UsageStats, VerifierImage } from './caller.ts';
export interface TopLogprobRoute {
    baseURL: string;
    apiKey?: string;
    headers?: Record<string, string>;
    deepSeekThinking: boolean;
}
export interface TopLogprobCompletion extends CompletionLogprobs {
    usage: UsageStats;
    scoringMode: 'top-logprobs';
}
export declare class TopLogprobsUnsupportedError extends Error {
    constructor(message: string);
}
export declare function resolveTopLogprobRoute(ctx: Context, provider: string): Promise<TopLogprobRoute | undefined>;
export declare function callTopLogprobs(route: TopLogprobRoute, model: string, prompt: string, maxTokens: number, reasoningEffort: string | undefined, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<TopLogprobCompletion>;
/** Marks older than this are dropped on hydration so a provider that later gains logprobs support is re-probed. */
export declare const CAPABILITY_TTL_MS: number;
/** Resolves the capability memory file beside the score cache inside the topic verifier directory. */
export declare function resolveCapabilityFile(cacheDir: string, cwd?: string): string;
export declare class TopLogprobCapabilityCache {
    private readonly file?;
    private readonly now;
    private readonly unsupported;
    private loaded;
    private hydrating;
    private writing;
    constructor(file?: string | undefined, now?: () => number);
    isUnsupported(provider: string, model: string): boolean;
    /** Hydrates persisted marks once; in-process marks always win over file contents. */
    ensureLoaded(): Promise<void>;
    markUnsupported(provider: string, model: string): void;
    /** Resolves once the trailing persistence attempt settles; exposed for tests. */
    flush(): Promise<void>;
}
//# sourceMappingURL=top-logprobs.d.ts.map