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
 * spend N times the money choosing between the same answer.
 */
export declare const GENERATION_TEMPERATURE = 1;
/**
 * Output ceiling for one draft.
 *
 * 4096 was a guess in the plan, and the first real end-to-end acceptance disproved it: a
 * "function + 12 test cases + a note" task truncated ALL THREE drafts, so the tool returned
 * nothing at all. The measured cause is reasoning tokens: on a trivial 2-draft run the session
 * model (deepseek-official/deepseek-flash) spent 16363 reasoning tokens out of 17254 output
 * tokens — roughly 8k of reasoning PER DRAFT, which eats any 4096 budget before the answer starts.
 *
 * 16384 is about 2x that measured per-draft spend, and it is also the largest ceiling that keeps
 * a pairwise judge prompt inside the plugin's own evidence limit: two drafts at 16384 tokens are
 * roughly 130k characters against a 240k explicit-evidence ceiling (EXPLICIT_MAX_TOTAL_CHARS).
 * `maxTokens` is a ceiling rather than a reservation, so a draft that needs less room costs
 * exactly what it did before. A task whose answer genuinely needs more is too large for this tool,
 * and its truncation is REPORTED instead of being silently returned.
 */
export declare const GENERATION_MAX_TOKENS = 16384;
export interface GenerationTarget {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** One draft: plain text, never scored, plus whether it ran into the output ceiling. */
export interface GeneratedCandidate extends VerifierCompletion {
    truncated: boolean;
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
 * @param maxTokens - output ceiling for this attempt.
 * @returns A client config safe to pass to {@link callGeneratedText}.
 */
export declare function generationClient(base: VerifierClientConfig, target: GenerationTarget, maxTokens?: number): VerifierClientConfig;
/**
 * One best-of-N draft.
 *
 * A named seam over the plain-text path: generation has no A–T contract and no scoring channel, and
 * the name keeps it distinct from the judge calls at every call site and in the decision snapshot.
 *
 * Hitting the output ceiling is deliberately NOT an error here. The operator already paid for those
 * tokens, and the judge can see for itself that the text stops mid-sentence. That is exactly why the
 * judge's fail-closed max-tokens handling was split out of this path: before the split, one long
 * task made the whole tool return zero candidates.
 * @param base - any configured verifier client (the primary judge is the cheapest source).
 * @param target - the model that writes the draft (normally the session model).
 * @param prompt - the rendered drafting prompt.
 * @param signal - caller's abort signal.
 * @returns The draft text, token usage, and whether it ran into the ceiling.
 */
export declare function generateCandidate(base: VerifierClientConfig, target: GenerationTarget, prompt: string, signal?: AbortSignal): Promise<GeneratedCandidate>;
/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
export declare function callVerifierText(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion>;
export declare function addUsage(target: UsageStats, source: UsageStats): void;
export declare function emptyUsage(): UsageStats;
//# sourceMappingURL=caller.d.ts.map