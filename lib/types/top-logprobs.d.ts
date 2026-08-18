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
export declare class TopLogprobCapabilityCache {
    private readonly unsupported;
    isUnsupported(provider: string, model: string): boolean;
    markUnsupported(provider: string, model: string): void;
}
//# sourceMappingURL=top-logprobs.d.ts.map