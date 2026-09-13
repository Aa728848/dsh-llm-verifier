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
    /** User-facing judge name for tool output; cosmetic only, never part of the scoring cache identity. */
    label?: string;
    reasoningEffort?: string;
    maxTokens: number;
    temperature: number;
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
/** Best-effort pre-call channel prediction for cache identity only; callAutomatic() stays the runtime source of truth. */
export declare function predictScoringChannel(config: VerifierClientConfig): Promise<ScoringMode>;
export declare function callVerifier(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion>;
/**
 * Best-of-N generation sampling constants.
 *
 * Deliberately NOT the judge's temperature: best-of-N only pays off when the drafts actually
 * differ, and the judge's low default (0.2) would produce N near-copies — the tool would then
 * spend N times the money choosing between the same answer. The token cap keeps N drafts well
 * inside the explicit evidence budget instead of paying to generate text the judge then refuses.
 */
export declare const GENERATION_TEMPERATURE = 1;
export declare const GENERATION_MAX_TOKENS = 4096;
export interface GenerationTarget {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/**
 * Re-point an existing verifier client at the model that should draft the candidates.
 *
 * Everything transport-shaped (context, llm runtime, attachments, capability memory, limiter,
 * timeout, retry budget) is inherited; only the route and the two generation-specific scalars
 * are replaced. `reasoningEffort` comes from the target and is never inherited from the base,
 * because the base is a judge: a leftover judge effort would silently draft with the wrong model
 * settings.
 * @param base - any configured verifier client (the primary judge is the cheapest source).
 * @param target - the model that writes the drafts.
 * @returns A client config safe to pass to {@link generateCandidate}.
 */
export declare function generationClient(base: VerifierClientConfig, target: GenerationTarget): VerifierClientConfig;
/**
 * One best-of-N draft.
 *
 * A named seam over {@link callVerifierText}: generation is a plain-text call with no A–T
 * contract and no scoring channel, and the name keeps that distinct from the judge calls at
 * every call site and in the decision snapshot.
 * @param config - a client built by {@link generationClient}.
 * @param prompt - the rendered drafting prompt.
 * @param signal - caller's abort signal.
 * @returns The draft text plus token usage; never scored.
 */
export declare function generateCandidate(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion>;
/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
export declare function callVerifierText(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion>;
export declare function addUsage(target: UsageStats, source: UsageStats): void;
export declare function emptyUsage(): UsageStats;
//# sourceMappingURL=caller.d.ts.map