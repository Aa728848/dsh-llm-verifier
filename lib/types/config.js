import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from 'schemastery';
export const VERIFIER_SETTINGS_NAMESPACE = settingsNamespace('llm-verifier');
export const Config = z.object({
    enabled: z.boolean().default(true),
    autoVerifyMode: z.union(['manual', 'smart', 'strict']).default('smart'),
    autoVerifyThreshold: z.number().min(0).max(1).default(0.65),
    autoVerifyRepeats: z.number().step(1).min(1).default(1),
    autoVerifyMinToolCalls: z.number().step(1).min(1).default(3),
    autoVerifyMaxChars: z.number().step(1).min(1000).default(80000),
    autoVerifyMaxPerTask: z.number().step(1).min(1).default(2),
    autoVerifyMaxPerSession: z.number().step(1).min(1).default(8),
    autoRouteSemantic: z.boolean().default(true),
    autoRouteMinConfidence: z.number().min(0).max(1).default(0.9),
    autoRouteMaxCandidates: z.number().step(1).min(3).default(8),
    autoRouteMaxPerTask: z.number().step(1).min(1).default(2),
    autoRouteMaxPerSession: z.number().step(1).min(1).default(8),
    autoTrackCompletionThreshold: z.number().min(0).max(1).default(0.8),
    autoRouteMaxItemChars: z.number().step(1).min(100).default(20000),
    autoRouteMaxInputChars: z.number().step(1).min(1000).default(60000),
    autoMaxModelCallsPerTask: z.number().step(1).min(1).default(48),
    autoMaxModelCallsPerSession: z.number().step(1).min(1).default(160),
    provider: z.string().default('deepseek-official'),
    model: z.string().default('deepseek-v4-flash'),
    reasoningEffort: z.string(),
    maxTokens: z.number().step(1).min(1).default(32768),
    timeoutMs: z.number().step(1).min(1).default(300000),
    maxConcurrency: z.number().step(1).min(1).default(8),
    maxRetries: z.number().step(1).min(0).default(3),
    retryBaseDelayMs: z.number().step(1).min(1).default(500),
    cacheDir: z.string().default('verifier'),
    cacheMaxEntries: z.number().step(1).min(1).default(10000),
    estimatedInputUsdPerMillion: z.number().min(0).default(0),
    estimatedOutputUsdPerMillion: z.number().min(0).default(0),
});
export function resolveConfig(config = {}) {
    const provider = (config.provider ?? 'deepseek-official').trim();
    const model = (config.model ?? 'deepseek-v4-flash').trim();
    if (!provider)
        throw new Error('llm-verifier: provider must be non-empty');
    if (!model)
        throw new Error('llm-verifier: model must be non-empty');
    const autoVerifyMode = config.autoVerifyMode ?? 'smart';
    if (!['manual', 'smart', 'strict'].includes(autoVerifyMode))
        throw new Error('llm-verifier: autoVerifyMode must be manual, smart, or strict');
    const autoVerifyThreshold = config.autoVerifyThreshold ?? 0.65;
    if (!Number.isFinite(autoVerifyThreshold) || autoVerifyThreshold < 0 || autoVerifyThreshold > 1)
        throw new Error('llm-verifier: autoVerifyThreshold must be between 0 and 1');
    const values = {
        autoVerifyRepeats: config.autoVerifyRepeats ?? 1,
        autoVerifyMinToolCalls: config.autoVerifyMinToolCalls ?? 3,
        autoVerifyMaxChars: config.autoVerifyMaxChars ?? 80000,
        autoVerifyMaxPerTask: config.autoVerifyMaxPerTask ?? 2,
        autoVerifyMaxPerSession: config.autoVerifyMaxPerSession ?? 8,
        autoRouteMaxCandidates: config.autoRouteMaxCandidates ?? 8,
        autoRouteMaxPerTask: config.autoRouteMaxPerTask ?? 2,
        autoRouteMaxPerSession: config.autoRouteMaxPerSession ?? 8,
        autoRouteMaxItemChars: config.autoRouteMaxItemChars ?? 20000,
        autoRouteMaxInputChars: config.autoRouteMaxInputChars ?? 60000,
        autoMaxModelCallsPerTask: config.autoMaxModelCallsPerTask ?? 48,
        autoMaxModelCallsPerSession: config.autoMaxModelCallsPerSession ?? 160,
        maxTokens: config.maxTokens ?? 32768,
        timeoutMs: config.timeoutMs ?? 300000,
        maxConcurrency: config.maxConcurrency ?? 8,
        retryBaseDelayMs: config.retryBaseDelayMs ?? 500,
        cacheMaxEntries: config.cacheMaxEntries ?? 10000,
    };
    for (const [name, value] of Object.entries(values))
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new Error('llm-verifier: ' + name + ' must be a positive safe integer');
    if (values.autoVerifyMaxChars < 1000)
        throw new Error('llm-verifier: autoVerifyMaxChars must be at least 1000');
    if (values.autoRouteMaxCandidates < 3 || values.autoRouteMaxCandidates > 16)
        throw new Error('llm-verifier: autoRouteMaxCandidates must be between 3 and 16');
    if (values.autoRouteMaxInputChars < values.autoRouteMaxItemChars * 2)
        throw new Error('llm-verifier: autoRouteMaxInputChars must fit at least two route items');
    const autoRouteMinConfidence = config.autoRouteMinConfidence ?? 0.9;
    const autoTrackCompletionThreshold = config.autoTrackCompletionThreshold ?? 0.8;
    if (![autoRouteMinConfidence, autoTrackCompletionThreshold].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
        throw new Error('llm-verifier: auto route thresholds must be between 0 and 1');
    const maxRetries = config.maxRetries ?? 3;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0)
        throw new Error('llm-verifier: maxRetries must be a non-negative safe integer');
    const cacheDir = (config.cacheDir ?? 'verifier').trim();
    if (!cacheDir)
        throw new Error('llm-verifier: cacheDir must be non-empty');
    if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(cacheDir))
        throw new Error('llm-verifier: cacheDir must be relative to the topic directory');
    if (cacheDir.split(/[\\/]+/u).includes('..'))
        throw new Error('llm-verifier: cacheDir must stay inside the topic directory');
    const estimatedInputUsdPerMillion = config.estimatedInputUsdPerMillion ?? 0;
    const estimatedOutputUsdPerMillion = config.estimatedOutputUsdPerMillion ?? 0;
    if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0))
        throw new Error('llm-verifier: estimated token prices must be finite non-negative numbers');
    const reasoningEffort = config.reasoningEffort?.trim();
    return { enabled: config.enabled ?? true, autoVerifyMode, autoVerifyThreshold, autoRouteSemantic: config.autoRouteSemantic ?? true, autoRouteMinConfidence, autoTrackCompletionThreshold, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}), maxRetries, cacheDir, estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion, ...values };
}
export function installVerifierSettings(ctx, entry, onChange) {
    let source = () => entry;
    installSettingsSection(ctx, VERIFIER_SETTINGS_NAMESPACE, Config, entry, {
        setSource(current) { source = current; },
        onChange,
        validate(value) { resolveConfig(value); },
    });
    return () => resolveConfig(source());
}
//# sourceMappingURL=config.js.map