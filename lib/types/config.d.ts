import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type CriteriaPresetId } from './core.ts';
/** A configured rubric: a bundled task-class preset, or a markdown file. */
export type CriteriaPresetSelection = CriteriaPresetId | 'custom';
export declare const VERIFIER_SETTINGS_NAMESPACE: never;
export type AutoVerifyMode = 'manual' | 'smart' | 'strict';
/**
 * When the P06 request-level selector may register an intent.
 *
 * `off` is the shipped default and the closed path. `recovery` is the original behaviour: one cycle
 * per task, and only once two consecutive verification runs have failed. `every-step` buys a
 * request-level selection for EVERY main-loop request, bounded per task by
 * {@link Config.maxProcessCyclesPerTask}.
 */
export type AutoProcessSelectionMode = 'off' | 'recovery' | 'every-step';
/** The three legal values, in the order the settings page renders them. */
export declare const AUTO_PROCESS_SELECTION_MODES: readonly AutoProcessSelectionMode[];
/**
 * Normalize the P06 switch, accepting the pre-3-mode BOOLEAN spelling.
 *
 * `true` meant "the recovery trigger" before the mode existed, so it must resolve to `recovery` and
 * never to `every-step`: silently upgrading a saved boolean to the expensive mode would multiply an
 * existing installation's spend without the operator asking for it. `false` and an absent value are
 * `off`.
 *
 * Strings are NOT normalized here: an illegal string is a configuration error, not a typo to repair,
 * so it is left for {@link resolveConfig} to reject (fail closed).
 * @param value - raw value from the config, the schema or the settings page.
 * @returns The mode, or undefined when the value is neither a mode nor a boolean.
 */
export declare function normalizeAutoProcessSelection(value: unknown): AutoProcessSelectionMode | undefined;
/**
 * The schemastery schema of a P06 mode: the three modes first, the legacy boolean last.
 *
 * The boolean member exists so the HOST can still resolve a section an older client saved — the
 * schema validates the stored user layer, and rejecting `true` there would make the whole namespace
 * unreadable. It is placed AFTER the strings so a raw `Schema.simplify` prefers the real modes, and
 * {@link normalizeAutoProcessSelection} projects whatever comes out onto the three legal values.
 */
export declare function autoProcessSelectionSchema(): z<AutoProcessSelectionMode | boolean, AutoProcessSelectionMode>;
export interface JudgeConfig {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
    label?: string;
}
export interface ResolvedJudge {
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    label: string;
}
export declare const MAX_EXTRA_JUDGES = 4;
export interface Config {
    enabled?: boolean;
    autoVerifyMode?: AutoVerifyMode;
    autoVerifyThreshold?: number;
    autoVerifyRepeats?: number;
    /**
     * Scoring repeats for an automatic `track` route only.
     *
     * Progress scores on a model without token logprobs come from the explicit-tag
     * channel, i.e. ONE sampled letter per call, and one letter is worth 5.3% of the
     * A–T scale — adjacent bands are a couple of samples apart. Averaging repeats is
     * what the upstream `n_evaluations` does for exactly this reason, and a track call
     * is the cheapest kind (one prompt, no tournament), so it defaults to 3.
     */
    autoTrackRepeats?: number;
    /**
     * Scoring repeats for the FINAL session acceptance only.
     *
     * Even rounds swap A/B positions, and the final acceptance is the one automatic
     * decision that gates turn completion, so it defaults to 2 even though the
     * intermediate routes stay at 1 repeat for cost.
     */
    autoVerifyFinalRepeats?: number;
    autoVerifyMinToolCalls?: number;
    autoVerifyMaxChars?: number;
    autoVerifyMaxPerTask?: number;
    autoVerifyMaxPerSession?: number;
    autoRouteSemantic?: boolean;
    autoRouteMinConfidence?: number;
    autoRouteMaxCandidates?: number;
    autoRouteMaxPerTask?: number;
    autoRouteMaxPerSession?: number;
    autoTrackCompletionThreshold?: number;
    /**
     * P06 request-level selection over \`llm/stream\`: give a task an alternative next reply.
     *
     * Default OFF and never turned on automatically. Only smart mode enters the path, and a selection
     * is never an acceptance. The legacy boolean is still accepted (`true` → `recovery`).
     */
    autoProcessSelection?: AutoProcessSelectionMode | boolean;
    /**
     * P06: cycles the \`every-step\` mode may buy within ONE task.
     *
     * Every-step buys a cycle for every main-loop request, so without a per-task ceiling a long task
     * would select on every step indefinitely. This allowance is INDEPENDENT of the routing quota
     * (\`autoRouteMaxPerTask\`) and of the final acceptance quota (\`autoVerifyMaxPerTask\`): the three
     * counters never share a value, so spending cycles can neither starve the final gate nor be
     * starved by it.
     */
    maxProcessCyclesPerTask?: number;
    /**
     * P06: hand the alternative reply the failing-run evidence the cycle was triggered by.
     *
     * Default ON: without it the extra candidate is written from exactly the same information as the
     * reply the session already showed failing, so the comparison mostly measures sampling noise.
     * OFF is the control arm of the A/B comparison, not a supported end state.
     */
    autoProcessFailureContext?: boolean;
    /**
     * P06: generate the alternative replies with these `provider/model` routes instead of the request's own.
     *
     * A COMMA-SEPARATED list. Entry i supplies the i-th generated candidate, and a list shorter than
     * the candidate count wraps around (see `resolveAlternativeTargets`). Empty (the default) resamples
     * the session model. A second model is the upstream ensemble idea without the proxy: the candidates
     * are then genuinely different hypotheses rather than samples of one model. It turns the comparison
     * into "which model's next step is better", which is a different question — hence the arm is
     * recorded on the row (`route.alternativeModel`), as the normalized whole list.
     */
    autoProcessAlternativeModel?: string;
    /**
     * P06: how many candidates one process cycle compares, the original reply included.
     *
     * N=2 (the shipped default) judges one pair. N=3 or 4 runs the tournament over
     * [original, alternative 1, ...], which costs roughly five times the judge calls at N=3 — see
     * `estimateRoutedCalls` — and is therefore opt-in rather than the default.
     */
    autoProcessCandidates?: number;
    autoRouteMaxItemChars?: number;
    autoRouteMaxInputChars?: number;
    autoMaxModelCallsPerTask?: number;
    autoMaxModelCallsPerSession?: number;
    /**
     * Persist a bounded snapshot (prompt + raw answer) of every verifier model call.
     *
     * Answers "why did the judge say that?" without replaying a session from its event
     * log; capped per call, per record and per invocation by `decisions.ts`.
     */
    captureDecisions?: boolean;
    /**
     * Rubric the automatic gate (final acceptance, routed compare/select/track) scores with.
     *
     * Defaults to `coding` = the historical DEFAULT_CRITERIA, so an existing installation is
     * unaffected. Judging a research or ops task with the coding rubric measures the wrong thing.
     */
    criteriaPreset?: CriteriaPresetSelection;
    /** Markdown rubric file, read when `criteriaPreset` is `custom`. See README for the format. */
    criteriaFile?: string;
    autoVerifyTeamTasks?: boolean;
    autoVerifyPlanMode?: boolean;
    autoVerifySubagents?: boolean;
    /**
     * Attach the host's own record of what the workspace changed to session acceptance.
     *
     * DSH 0.1.6 keeps per-turn file summaries and serves them through `workspaceChanges`; without
     * this the acceptance judge only sees what the agent said it changed. Absent or disabled, no
     * evidence block is added — which is also the behaviour on hosts that do not provide the service.
     */
    autoWorkspaceEvidence?: boolean;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
    temperature?: number;
    label?: string;
    timeoutMs?: number;
    maxConcurrency?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    cacheDir?: string;
    cacheMaxEntries?: number;
    estimatedInputUsdPerMillion?: number;
    estimatedOutputUsdPerMillion?: number;
    /** USD per million prompt tokens served from cache; 0 falls back to the input rate. */
    estimatedCachedInputUsdPerMillion?: number;
    /** Price a judge route from the installed pi-ai catalog when the operator typed no rate. */
    autoPriceFromCatalog?: boolean;
    /** Consult the models.dev snapshot when the installed catalog has no price for the route. */
    autoPriceOnline?: boolean;
    /** Provider id whose list price to follow for a route neither price table knows. */
    priceProviderOverride?: string;
    extraJudges?: JudgeConfig[];
}
export interface ResolvedConfig {
    enabled: boolean;
    autoVerifyMode: AutoVerifyMode;
    autoVerifyThreshold: number;
    autoVerifyRepeats: number;
    autoTrackRepeats: number;
    autoVerifyFinalRepeats: number;
    autoVerifyMinToolCalls: number;
    autoVerifyMaxChars: number;
    autoVerifyMaxPerTask: number;
    autoVerifyMaxPerSession: number;
    autoRouteSemantic: boolean;
    autoRouteMinConfidence: number;
    autoRouteMaxCandidates: number;
    autoRouteMaxPerTask: number;
    autoRouteMaxPerSession: number;
    autoTrackCompletionThreshold: number;
    autoProcessSelection: AutoProcessSelectionMode;
    maxProcessCyclesPerTask: number;
    autoProcessFailureContext: boolean;
    autoProcessAlternativeModel: string;
    autoProcessCandidates: number;
    autoRouteMaxItemChars: number;
    autoRouteMaxInputChars: number;
    autoMaxModelCallsPerTask: number;
    autoMaxModelCallsPerSession: number;
    captureDecisions: boolean;
    criteriaPreset: CriteriaPresetSelection;
    criteriaFile: string;
    autoVerifyTeamTasks: boolean;
    autoVerifyPlanMode: boolean;
    autoVerifySubagents: boolean;
    autoWorkspaceEvidence: boolean;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    maxConcurrency: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    cacheDir: string;
    cacheMaxEntries: number;
    estimatedInputUsdPerMillion: number;
    estimatedOutputUsdPerMillion: number;
    estimatedCachedInputUsdPerMillion: number;
    autoPriceFromCatalog: boolean;
    autoPriceOnline: boolean;
    priceProviderOverride: string;
    judges: ResolvedJudge[];
}
/**
 * Recursively unwrap a volatile configuration container or reference into a plain value.
 *
 * DSH 0.1.7 wraps volatile-marked schemas in cosmokit Volatile references (`{ get(): T }`).
 * Resolving safely unwraps these references, ensuring callers receive plain config objects
 * without breaking when running under older hosts or direct test invocations.
 */
export declare function unwrapVolatileConfig<T>(value: T): T;
/** A stable reference to one immutable configuration snapshot. */
export interface VolatileConfigRef<T> {
    /** @returns the current immutable snapshot, including `undefined` for an absent value. */
    get(): T;
}
/** Whether a value implements the shared cosmokit volatile reference protocol. */
export declare function isVolatileConfigRef(value: unknown): value is VolatileConfigRef<unknown>;
/**
 * Create a stable reference holding an immutable copy of the supplied data.
 *
 * The returned object is frozen and exposes only `get()` plus the shared write symbol, so the
 * owning runtime (the host Loader) is the only writer.
 * @param value - validated config data produced by the schema itself.
 * @returns a reference whose snapshot is replaced only through the volatile protocol.
 */
export declare function createVolatileConfigRef<T>(value: T): VolatileConfigRef<T>;
/**
 * Make a schema's successful parses return a volatile reference.
 *
 * A volatile-marked schema must not only set `meta.volatile` (which is all the community
 * `schemastery` builder can express): the host Loader identifies live configuration by walking
 * `fiber.config` for cosmokit references, so a schema that returns a plain object is treated as
 * having no live fields. The entry then takes the volatile-only update path, finds zero references,
 * and silently drops every saved value.
 *
 * The shadow is installed on the instance, leaving the community prototype untouched, and is
 * idempotent: a schema already handling the protocol is returned unchanged.
 * @param schema - schema to extend with the volatile reference protocol.
 * @returns the same schema, now returning references from `~standard.validate`.
 */
export declare function installVolatileRefProtocol<T extends z>(schema: T): T;
/**
 * Mark a Schemastery schema as volatile so DSH 0.1.7+ projects its fields into SettingsForms.
 *
 * Sets the `volatile` metadata that drives `volatileForm` / `isVolatilePath`, then installs the
 * volatile reference protocol so the host Loader can actually commit live values into the running
 * fiber. Compatible with both `@deepseek-ai/schemastery` (which provides `.volatile()`) and
 * community `schemastery` (where `.extra('volatile', true)` attaches the metadata alone).
 */
export declare function markVolatile<T extends z>(schema: T): T;
export declare const JudgeConfig: z<JudgeConfig>;
export declare const Config: z<Config>;
export declare function resolveConfig(config?: Config): ResolvedConfig;
export declare function installVerifierSettings(ctx: Context, entry: ResolvedConfig, onChange: () => void): () => ResolvedConfig;
//# sourceMappingURL=config.d.ts.map