import z from 'schemastery';
import { CRITERIA_PRESET_IDS } from "./core.js";
export const VERIFIER_SETTINGS_NAMESPACE = 'llm-verifier';
/** The three legal values, in the order the settings page renders them. */
export const AUTO_PROCESS_SELECTION_MODES = ['off', 'recovery', 'every-step'];
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
export function normalizeAutoProcessSelection(value) {
    if (value === true)
        return 'recovery';
    if (value === false || value === undefined || value === null)
        return 'off';
    return typeof value === 'string' && AUTO_PROCESS_SELECTION_MODES.includes(value)
        ? value
        : undefined;
}
/**
 * The schemastery schema of a P06 mode: the three modes first, the legacy boolean last.
 *
 * The boolean member exists so the HOST can still resolve a section an older client saved — the
 * schema validates the stored user layer, and rejecting `true` there would make the whole namespace
 * unreadable. It is placed AFTER the strings so a raw `Schema.simplify` prefers the real modes, and
 * {@link normalizeAutoProcessSelection} projects whatever comes out onto the three legal values.
 */
export function autoProcessSelectionSchema() {
    // The OUTER `.default('off')` is the one that matters: a transform swallows the inner default
    // (its own meta.default stays unset unless set explicitly), so without it an absent key would
    // resolve to undefined even though the union alone defaults correctly. The union has already
    // rejected everything outside the three modes and the boolean, so the callback's fallback is
    // unreachable — it exists only to keep the projection total.
    return z
        .transform(z.union([...AUTO_PROCESS_SELECTION_MODES, z.boolean()]).default('off'), (value) => normalizeAutoProcessSelection(value) ?? 'off')
        .default('off');
}
export const MAX_EXTRA_JUDGES = 4;
export const JudgeConfig = z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    maxTokens: z.number().step(1).min(1),
    label: z.string(),
});
export const Config = z.object({
    enabled: z.boolean().default(true),
    autoVerifyMode: z.union(['manual', 'smart', 'strict']).default('smart'),
    autoVerifyThreshold: z.number().min(0).max(1).default(0.65),
    autoVerifyRepeats: z.number().step(1).min(1).default(1),
    autoTrackRepeats: z.number().step(1).min(1).default(3),
    autoVerifyFinalRepeats: z.number().step(1).min(1).default(2),
    autoVerifyMinToolCalls: z.number().step(1).min(1).default(3),
    autoVerifyMaxChars: z.number().step(1).min(1000).default(80000),
    autoVerifyMaxPerTask: z.number().step(1).min(1).default(2),
    autoVerifyMaxPerSession: z.number().step(1).min(1).default(8),
    autoRouteSemantic: z.boolean().default(true),
    autoRouteMinConfidence: z.number().min(0).max(1).default(0.9),
    autoRouteMaxCandidates: z.number().step(1).min(3).default(8),
    autoRouteMaxPerTask: z.number().step(1).min(1).default(2),
    autoRouteMaxPerSession: z.number().step(1).min(1).default(8),
    autoTrackCompletionThreshold: z.number().min(0).max(1).default(0.684),
    autoProcessSelection: autoProcessSelectionSchema(),
    maxProcessCyclesPerTask: z.number().step(1).min(1).max(32).default(4),
    autoProcessFailureContext: z.boolean().default(true),
    autoProcessAlternativeModel: z.string().default(''),
    autoProcessCandidates: z.number().step(1).min(2).default(2),
    autoRouteMaxItemChars: z.number().step(1).min(100).default(20000),
    autoRouteMaxInputChars: z.number().step(1).min(1000).default(60000),
    autoMaxModelCallsPerTask: z.number().step(1).min(1).default(96),
    autoMaxModelCallsPerSession: z.number().step(1).min(1).default(240),
    captureDecisions: z.boolean().default(true),
    criteriaPreset: z.union([...CRITERIA_PRESET_IDS, 'custom']).default('coding'),
    criteriaFile: z.string().default(''),
    autoVerifyTeamTasks: z.boolean().default(true),
    autoVerifyPlanMode: z.boolean().default(true),
    autoVerifySubagents: z.boolean().default(false),
    autoWorkspaceEvidence: z.boolean().default(true),
    provider: z.string().default('deepseek-official'),
    model: z.string().default('deepseek-flash'),
    reasoningEffort: z.string(),
    maxTokens: z.number().step(1).min(1).default(32768),
    temperature: z.number().min(0).max(2).default(0.2),
    label: z.string(),
    timeoutMs: z.number().step(1).min(1).default(300000),
    maxConcurrency: z.number().step(1).min(1).default(8),
    maxRetries: z.number().step(1).min(0).default(3),
    retryBaseDelayMs: z.number().step(1).min(1).default(500),
    cacheDir: z.string().default('verifier'),
    cacheMaxEntries: z.number().step(1).min(1).default(10000),
    estimatedInputUsdPerMillion: z.number().min(0).default(0),
    estimatedOutputUsdPerMillion: z.number().min(0).default(0),
    estimatedCachedInputUsdPerMillion: z.number().min(0).default(0),
    autoPriceFromCatalog: z.boolean().default(true),
    autoPriceOnline: z.boolean().default(true),
    priceProviderOverride: z.string().default(''),
    extraJudges: z.array(z.object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string(),
        maxTokens: z.number().step(1).min(1),
        label: z.string(),
    })).default([]),
});
function resolveJudgeLabel(rawLabel, provider, model, takenLabels) {
    const initial = rawLabel?.trim() || model;
    if (!takenLabels.has(initial)) {
        takenLabels.add(initial);
        return initial;
    }
    const fallback = `${provider}/${model}`;
    if (!takenLabels.has(fallback)) {
        takenLabels.add(fallback);
        return fallback;
    }
    let index = 2;
    while (takenLabels.has(`${fallback}#${index}`)) {
        index++;
    }
    const resolved = `${fallback}#${index}`;
    takenLabels.add(resolved);
    return resolved;
}
export function resolveConfig(config = {}) {
    const provider = (config.provider ?? 'deepseek-official').trim();
    const model = (config.model ?? 'deepseek-flash').trim();
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
    const temperature = config.temperature ?? 0.2;
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
        throw new Error('llm-verifier: temperature must be between 0 and 2');
    // P06's candidate count. The upper bound is a spend ceiling, not a technical one: at N=4 the
    // tournament is 6 pairs under the shipped criteria, which is already a third of the task budget.
    const processCandidates = config.autoProcessCandidates ?? 2;
    if (!Number.isSafeInteger(processCandidates) || processCandidates < 2 || processCandidates > 4) {
        throw new Error('llm-verifier: autoProcessCandidates must be an integer between 2 and 4');
    }
    // The alternative-model pool: a comma-separated list of complete routes. Each entry is validated
    // on its own (a half-specified route would silently fall back to the session model while the row
    // claimed a second model was used), blank entries are dropped, and the normalized list is stored
    // back as the comma-joined string the statistics row reports.
    const alternativeModelParts = (config.autoProcessAlternativeModel ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');
    for (const entry of alternativeModelParts) {
        if (!/^[^\s/]+\/[^\s]+$/u.test(entry)) {
            throw new Error('llm-verifier: autoProcessAlternativeModel entry "' + entry + '" must be "provider/model"');
        }
    }
    const alternativeModel = alternativeModelParts.join(',');
    // P06's trigger mode. The legacy boolean is normalized (true -> recovery) and anything else that is
    // neither a mode nor a boolean fails closed, so a typo cannot silently select a more expensive arm.
    const processSelection = normalizeAutoProcessSelection(config.autoProcessSelection);
    if (processSelection === undefined) {
        throw new Error('llm-verifier: autoProcessSelection must be off, recovery, or every-step');
    }
    // The every-step per-task allowance. The upper bound is a spend ceiling, not a technical one: each
    // cycle is a whole extra generation plus a judged pair.
    const maxProcessCyclesPerTask = config.maxProcessCyclesPerTask ?? 4;
    if (!Number.isSafeInteger(maxProcessCyclesPerTask) || maxProcessCyclesPerTask < 1 || maxProcessCyclesPerTask > 32) {
        throw new Error('llm-verifier: maxProcessCyclesPerTask must be an integer between 1 and 32');
    }
    const values = {
        autoVerifyRepeats: config.autoVerifyRepeats ?? 1,
        autoTrackRepeats: config.autoTrackRepeats ?? 3,
        autoVerifyFinalRepeats: config.autoVerifyFinalRepeats ?? 2,
        autoVerifyMinToolCalls: config.autoVerifyMinToolCalls ?? 3,
        autoVerifyMaxChars: config.autoVerifyMaxChars ?? 80000,
        autoVerifyMaxPerTask: config.autoVerifyMaxPerTask ?? 2,
        autoVerifyMaxPerSession: config.autoVerifyMaxPerSession ?? 8,
        autoRouteMaxCandidates: config.autoRouteMaxCandidates ?? 8,
        autoRouteMaxPerTask: config.autoRouteMaxPerTask ?? 2,
        autoRouteMaxPerSession: config.autoRouteMaxPerSession ?? 8,
        autoRouteMaxItemChars: config.autoRouteMaxItemChars ?? 20000,
        autoRouteMaxInputChars: config.autoRouteMaxInputChars ?? 60000,
        autoMaxModelCallsPerTask: config.autoMaxModelCallsPerTask ?? 96,
        autoMaxModelCallsPerSession: config.autoMaxModelCallsPerSession ?? 240,
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
    const autoTrackCompletionThreshold = config.autoTrackCompletionThreshold ?? 0.684;
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
    const estimatedCachedInputUsdPerMillion = config.estimatedCachedInputUsdPerMillion ?? 0;
    if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion, estimatedCachedInputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0))
        throw new Error('llm-verifier: estimated token prices must be finite non-negative numbers');
    // A reseller route has no price in either table; the override names the provider whose list
    // price the operator chose to follow. Empty (the default) means "never guess across providers".
    const priceProviderOverride = (config.priceProviderOverride ?? '').trim();
    const criteriaPreset = config.criteriaPreset ?? 'coding';
    if (criteriaPreset !== 'custom' && !CRITERIA_PRESET_IDS.includes(criteriaPreset))
        throw new Error('llm-verifier: criteriaPreset must be one of ' + [...CRITERIA_PRESET_IDS, 'custom'].join(', '));
    // A half-configured custom rubric is NOT a config error: CriteriaResolver falls back to the
    // coding preset and reports why, so a typo in a rubric path cannot disable the gate.
    const criteriaFile = (config.criteriaFile ?? '').trim();
    const reasoningEffort = config.reasoningEffort?.trim();
    const extraJudges = config.extraJudges ?? [];
    if (!Array.isArray(extraJudges))
        throw new Error('llm-verifier: extraJudges must be an array');
    if (extraJudges.length > MAX_EXTRA_JUDGES) {
        throw new Error(`llm-verifier: extraJudges cannot exceed ${MAX_EXTRA_JUDGES}`);
    }
    const seenJudges = new Set([`${provider}\u0000${model}`]);
    const takenLabels = new Set();
    const primaryLabel = resolveJudgeLabel(config.label, provider, model, takenLabels);
    const primaryJudge = {
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        maxTokens: values.maxTokens,
        label: primaryLabel,
    };
    const judges = [primaryJudge];
    for (let i = 0; i < extraJudges.length; i++) {
        const extra = extraJudges[i];
        if (!extra || typeof extra !== 'object') {
            throw new Error(`llm-verifier: extraJudges[${i}] must be an object`);
        }
        const extraProvider = (extra.provider ?? '').trim();
        if (!extraProvider) {
            throw new Error(`llm-verifier: extraJudges[${i}].provider must be non-empty`);
        }
        const extraModel = (extra.model ?? '').trim();
        if (!extraModel) {
            throw new Error(`llm-verifier: extraJudges[${i}].model must be non-empty`);
        }
        const identityKey = `${extraProvider}\u0000${extraModel}`;
        if (seenJudges.has(identityKey)) {
            throw new Error(`llm-verifier: duplicate judge: ${extraProvider}/${extraModel}`);
        }
        seenJudges.add(identityKey);
        let extraMaxTokens = values.maxTokens;
        if (extra.maxTokens !== undefined) {
            if (typeof extra.maxTokens !== 'number' || !Number.isSafeInteger(extra.maxTokens) || extra.maxTokens <= 0) {
                throw new Error(`llm-verifier: extraJudges[${i}].maxTokens must be a positive safe integer`);
            }
            extraMaxTokens = extra.maxTokens;
        }
        // Do NOT inherit the primary judge's reasoning effort; an empty or absent effort
        // allows the adapter to use the judge model's own default.
        const extraEffort = extra.reasoningEffort?.trim();
        const extraLabel = resolveJudgeLabel(extra.label, extraProvider, extraModel, takenLabels);
        judges.push({
            provider: extraProvider,
            model: extraModel,
            ...(extraEffort ? { reasoningEffort: extraEffort } : {}),
            maxTokens: extraMaxTokens,
            label: extraLabel,
        });
    }
    return {
        enabled: config.enabled ?? true,
        autoVerifyMode,
        autoVerifyThreshold,
        autoRouteSemantic: config.autoRouteSemantic ?? true,
        autoRouteMinConfidence,
        autoTrackCompletionThreshold,
        captureDecisions: config.captureDecisions ?? true,
        autoProcessSelection: processSelection,
        maxProcessCyclesPerTask,
        autoProcessFailureContext: config.autoProcessFailureContext ?? true,
        autoProcessAlternativeModel: alternativeModel,
        autoProcessCandidates: processCandidates,
        criteriaPreset,
        criteriaFile,
        autoVerifyTeamTasks: config.autoVerifyTeamTasks ?? true,
        autoVerifyPlanMode: config.autoVerifyPlanMode ?? true,
        autoVerifySubagents: config.autoVerifySubagents ?? false,
        autoWorkspaceEvidence: config.autoWorkspaceEvidence ?? true,
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        maxRetries,
        cacheDir,
        estimatedInputUsdPerMillion,
        estimatedOutputUsdPerMillion,
        estimatedCachedInputUsdPerMillion,
        autoPriceFromCatalog: config.autoPriceFromCatalog ?? true,
        autoPriceOnline: config.autoPriceOnline ?? true,
        priceProviderOverride,
        ...values,
        temperature,
        judges,
    };
}
export function installVerifierSettings(ctx, entry, onChange) {
    let source = () => entry;
    const ns = VERIFIER_SETTINGS_NAMESPACE;
    ctx.inject(['settings'], (sctx) => {
        if (!sctx.settings)
            return;
        if (typeof sctx.settings.installSection === 'function') {
            sctx.settings.installSection(ctx, ns, Config, entry, {
                setSource(current) { source = current; },
                onChange,
                validate(value) { resolveConfig(value); },
            });
        }
        else if (typeof sctx.settings.register === 'function') {
            const scope = sctx.settings.register(ns, Config, {
                base: entry,
                validate: (value) => { resolveConfig(value); },
            });
            source = () => scope.get();
            sctx.effect(() => () => {
                source = () => entry;
                onChange();
            });
            onChange();
            scope.watch(() => {
                onChange();
            });
        }
    });
    return () => resolveConfig(source());
}
//# sourceMappingURL=config.js.map