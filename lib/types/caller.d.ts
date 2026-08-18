import { type LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { CompletionLogprobs } from './core.ts';
import { TopLogprobCapabilityCache } from './top-logprobs.ts';
import type { Context } from '@deepseek-ai/cordis';
export interface VerifierClientConfig {
    ctx: Context;
    llm: LlmRuntime;
    attachments: AttachmentStore;
    topLogprobCapabilities: TopLogprobCapabilityCache;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    limiter?: RequestLimiter;
}
export interface VerifierImage {
    data: Uint8Array;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}
export interface UsageStats {
    calls: number;
    attempts: number;
    retries: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
}
export type ScoringMode = 'top-logprobs' | 'explicit-tag';
export interface VerifierCompletion extends CompletionLogprobs {
    usage: UsageStats;
    scoringMode: ScoringMode;
}
export declare class RequestLimiter {
    readonly limit: number;
    private active;
    private readonly queue;
    constructor(limit: number);
    run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export declare function callVerifier(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion>;
export declare function addUsage(target: UsageStats, source: UsageStats): void;
export declare function emptyUsage(): UsageStats;
//# sourceMappingURL=caller.d.ts.map