import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
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
    autoRouteMaxItemChars?: number;
    autoRouteMaxInputChars?: number;
    autoMaxModelCallsPerTask?: number;
    autoMaxModelCallsPerSession?: number;
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
    autoRouteMaxItemChars: number;
    autoRouteMaxInputChars: number;
    autoMaxModelCallsPerTask: number;
    autoMaxModelCallsPerSession: number;
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