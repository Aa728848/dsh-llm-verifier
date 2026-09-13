import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import { type CriteriaPresetId } from './core.ts';
/** A configured rubric: a bundled task-class preset, or a markdown file. */
export type CriteriaPresetSelection = CriteriaPresetId | 'custom';
export declare const VERIFIER_SETTINGS_NAMESPACE: never;
export type AutoVerifyMode = 'manual' | 'smart' | 'strict';
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
     * P06 request-level selection over \`llm/stream\`: give a struck task one alternative next reply.
     *
     * Default OFF and never turned on automatically. Only smart mode enters the path, at most one
     * cycle is bought per task, and a selection is never an acceptance.
     */
    autoProcessSelection?: boolean;
    /**
     * P06: hand the alternative reply the failing-run evidence the cycle was triggered by.
     *
     * Default ON: without it the extra candidate is written from exactly the same information as the
     * reply the session already showed failing, so the comparison mostly measures sampling noise.
     * OFF is the control arm of the A/B comparison, not a supported end state.
     */
    autoProcessFailureContext?: boolean;
    /**
     * P06: generate the alternative reply with this `provider/model` instead of the request's own.
     *
     * Empty (the default) resamples the session model. A second model is the upstream ensemble idea
     * without the proxy: the candidates are then genuinely different hypotheses rather than two
     * samples of one model. It turns the comparison into "which model's next step is better", which is
     * a different question — hence the arm is recorded on the row (`route.alternativeModel`).
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
    autoProcessSelection: boolean;
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
    judges: ResolvedJudge[];
}
export declare const JudgeConfig: z<JudgeConfig>;
export declare const Config: z<Config>;
export declare function resolveConfig(config?: Config): ResolvedConfig;
export declare function installVerifierSettings(ctx: Context, entry: ResolvedConfig, onChange: () => void): () => ResolvedConfig;
//# sourceMappingURL=config.d.ts.map