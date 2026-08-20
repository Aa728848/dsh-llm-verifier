import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
export declare const VERIFIER_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export type AutoVerifyMode = 'manual' | 'smart' | 'strict';
export interface Config {
    enabled?: boolean;
    autoVerifyMode?: AutoVerifyMode;
    autoVerifyThreshold?: number;
    autoVerifyRepeats?: number;
    autoVerifyMinToolCalls?: number;
    autoVerifyMaxChars?: number;
    autoVerifyMaxPerTask?: number;
    autoVerifyMaxPerSession?: number;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
    timeoutMs?: number;
    maxConcurrency?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    cacheDir?: string;
    cacheMaxEntries?: number;
    estimatedInputUsdPerMillion?: number;
    estimatedOutputUsdPerMillion?: number;
}
export interface ResolvedConfig {
    enabled: boolean;
    autoVerifyMode: AutoVerifyMode;
    autoVerifyThreshold: number;
    autoVerifyRepeats: number;
    autoVerifyMinToolCalls: number;
    autoVerifyMaxChars: number;
    autoVerifyMaxPerTask: number;
    autoVerifyMaxPerSession: number;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    timeoutMs: number;
    maxConcurrency: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    cacheDir: string;
    cacheMaxEntries: number;
    estimatedInputUsdPerMillion: number;
    estimatedOutputUsdPerMillion: number;
}
export declare const Config: z<Config>;
export declare function resolveConfig(config?: Config): ResolvedConfig;
export declare function installVerifierSettings(ctx: Context, entry: ResolvedConfig, onChange: () => void): () => ResolvedConfig;
//# sourceMappingURL=config.d.ts.map