import type { Context } from '@deepseek-ai/cordis';
import type { CompletionLogprobs } from './core.ts';
import type { UsageStats, VerifierImage } from './caller.ts';
/**
 * The two scoring channels are the logprob expectation (this file) and the explicit tag reply
 * (caller.ts). Upstream has a THIRD one worth knowing about before inventing anything new:
 * when an open-model server does not emit the score tags at all, it prefills the tag itself and
 * constrains the next token to the twenty scale letters, then reads that token's distribution
 * (llm-as-a-verifier `_score_tags_by_prefill`: vLLM/SGLang `continue_final_message` plus
 * `structured_outputs`). That turns ANY OpenAI-compatible server into a distribution-scoring
 * judge, which is strictly more informative than our explicit-tag channel's single sampled letter
 * — it is why upstream can run K=1 and we average repeats instead.
 *
 * NOT implemented here, deliberately: the direct transport below speaks to whichever
 * OpenAI-compatible endpoint a provider declares, and the prefill/grammar parameters are
 * vLLM/SGLang extensions that a normal endpoint rejects. Two preconditions before adding it:
 * (1) the DSH stream adapter exposes prefill or a constrained-decoding option, or the route is
 * known to be a local inference server; (2) the capability probe can detect support at runtime and
 * degrade to explicit tags — NEVER keyed off a provider or model name (AGENTS.md rule 7). If it
 * lands, it belongs in `callTopLogprobs` as an opt-in third mode, and `autoTrackRepeats` could
 * then drop.
 */
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
/**
 * A provider-level rejection of the direct transport that is not a logprobs
 * capability answer (bad request, auth, quota, malformed body). It downgrades
 * this topic to the DSH stream instead of failing the whole verification.
 */
export declare class TopLogprobsRouteError extends TopLogprobsUnsupportedError {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export declare function resolveTopLogprobRoute(ctx: Context, provider: string): Promise<TopLogprobRoute | undefined>;
export declare function callTopLogprobs(route: TopLogprobRoute, model: string, prompt: string, maxTokens: number, reasoningEffort: string | undefined, signal?: AbortSignal, images?: readonly VerifierImage[], attempt?: number, temperature?: number): Promise<TopLogprobCompletion>;
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
    /** Expired marks are dropped so a provider that later gains logprobs support is re-probed. */
    isUnsupported(provider: string, model: string): boolean;
    /** Hydrates persisted marks once; in-process marks always win over file contents. */
    ensureLoaded(): Promise<void>;
    markUnsupported(provider: string, model: string): void;
    /** Resolves once the trailing persistence attempt settles; exposed for tests. */
    flush(): Promise<void>;
}
//# sourceMappingURL=top-logprobs.d.ts.map