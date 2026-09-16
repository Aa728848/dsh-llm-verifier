import { normalizeExtraJudges } from "./client-judges.js";
import { computeJudgeCount, computeWorstCaseBudget, WORST_CASE_CRITERIA_PER_COMPARISON } from "./client-i18n.js";
import { normalizeAutoProcessSelection } from "./config.js";
/**
 * Plugin defaults, i.e. what the form shows when the host reports no value.
 *
 * This is also the 'resolveConfig' default set, and it is the target of the
 * per-row "restore default" action and of the 'balanced' profile. It must stay
 * aligned with 'src/config.ts'; 'client-fields.test.ts' asserts that the defaults
 * need no correction once provider/model are filled in.
 */
export const CONFIG_DEFAULTS = {
    enabled: true,
    captureDecisions: true,
    autoProcessSelection: 'off',
    maxProcessCyclesPerTask: 4,
    autoProcessFailureContext: true,
    autoProcessAlternativeModel: '',
    autoProcessCandidates: 2,
    autoVerifyMode: 'smart',
    autoVerifyThreshold: 0.65,
    autoVerifyRepeats: 1,
    autoTrackRepeats: 3,
    autoVerifyFinalRepeats: 2,
    autoVerifyMinToolCalls: 3,
    autoVerifyMaxChars: 80000,
    autoVerifyMaxPerTask: 2,
    autoVerifyMaxPerSession: 8,
    autoRouteSemantic: true,
    autoRouteMinConfidence: 0.9,
    autoRouteMaxCandidates: 8,
    autoRouteMaxPerTask: 2,
    autoRouteMaxPerSession: 8,
    autoTrackCompletionThreshold: 0.684,
    autoRouteMaxItemChars: 20000,
    autoRouteMaxInputChars: 60000,
    autoMaxModelCallsPerTask: 96,
    autoMaxModelCallsPerSession: 240,
    autoVerifyTeamTasks: true,
    autoVerifyPlanMode: true,
    criteriaPreset: 'coding',
    criteriaFile: '',
    provider: '',
    model: '',
    maxTokens: 32768,
    temperature: 0.2,
    maxConcurrency: 8,
    maxRetries: 3,
    retryBaseDelayMs: 500,
    timeoutMs: 300000,
    cacheDir: 'verifier',
    cacheMaxEntries: 10000,
    estimatedInputUsdPerMillion: 0,
    estimatedOutputUsdPerMillion: 0,
    estimatedCachedInputUsdPerMillion: 0,
    autoPriceFromCatalog: true,
    autoPriceOnline: true,
    priceProviderOverride: '',
    autoVerifySubagents: false,
    extraJudges: [],
};
/**
 * Information architecture. The old page was five flat sections with 26 rows in
 * "automatic verification"; here the policy switches stay visible and the
 * numeric ceilings and persistence knobs move into collapsed advanced sections.
 */
export const SECTIONS = [
    { id: 'tools', titleKey: 'section.tools', tier: 'core', open: true },
    { id: 'autoVerify', titleKey: 'section.autoVerify', tier: 'core', open: true },
    { id: 'routing', titleKey: 'section.routing', tier: 'core', open: false },
    { id: 'model', titleKey: 'section.model', tier: 'core', open: true },
    { id: 'budgets', titleKey: 'section.budgets', tier: 'advanced', open: false },
    { id: 'storage', titleKey: 'section.storage', tier: 'advanced', open: false },
    { id: 'execution', titleKey: 'section.execution', tier: 'advanced', open: false },
    { id: 'cost', titleKey: 'section.cost', tier: 'advanced', open: false },
];
const fieldOf = (key, section, kind) => ({
    key,
    section,
    kind,
    titleKey: 'field.' + String(key) + '.title',
    helpKey: 'field.' + String(key) + '.help',
});
const number = (key, section, options = {}) => ({ ...fieldOf(key, section, 'number'), ...options });
const toggle = (key, section) => fieldOf(key, section, 'toggle');
const text = (key, section, resettable = false) => ({ ...fieldOf(key, section, 'text'), resettable });
const select = (key, section, source, resettable = true) => ({
    ...fieldOf(key, section, 'select'),
    select: source,
    resettable,
});
/** Render order inside a section follows this array. */
export const FIELDS = [
    { ...toggle('enabled', 'tools'), helpKey: 'field.enabled.helpOn', helpKeyOff: 'field.enabled.helpOff' },
    select('autoVerifyMode', 'autoVerify', 'mode'),
    select('criteriaPreset', 'autoVerify', 'criteriaPreset'),
    { ...text('criteriaFile', 'autoVerify', true), visibleWhen: values => values.criteriaPreset === 'custom' },
    number('autoVerifyThreshold', 'autoVerify', { min: 0, max: 1, slider: true }),
    toggle('autoRouteSemantic', 'routing'),
    number('autoRouteMinConfidence', 'routing', { min: 0, max: 1, slider: true }),
    number('autoRouteMaxCandidates', 'routing', { min: 3, max: 16, integer: true }),
    number('autoRouteMaxPerTask', 'routing', { min: 1, integer: true }),
    number('autoRouteMaxPerSession', 'routing', { min: 1, integer: true }),
    number('autoTrackCompletionThreshold', 'routing', { min: 0, max: 1, slider: true }),
    number('autoTrackRepeats', 'routing', { min: 1, integer: true }),
    toggle('autoVerifyTeamTasks', 'routing'),
    toggle('autoVerifyPlanMode', 'routing'),
    toggle('autoVerifySubagents', 'routing'),
    select('autoProcessSelection', 'routing', 'processSelection'),
    number('maxProcessCyclesPerTask', 'routing', { min: 1, max: 32, integer: true }),
    toggle('autoProcessFailureContext', 'routing'),
    text('autoProcessAlternativeModel', 'routing'),
    number('autoProcessCandidates', 'routing', { min: 2, max: 4, integer: true }),
    select('provider', 'model', 'provider', false),
    select('model', 'model', 'model', false),
    select('reasoningEffort', 'model', 'effort', false),
    number('maxTokens', 'model', { min: 1, integer: true, unitKey: 'settings.unit.tokens' }),
    number('temperature', 'model', { min: 0, max: 2 }),
    text('label', 'model', true),
    { key: 'extraJudges', section: 'model', kind: 'custom', titleKey: 'field.extraJudges.title', helpKey: 'field.extraJudges.help' },
    number('autoMaxModelCallsPerTask', 'budgets', { min: 1, integer: true, unitKey: 'settings.unit.calls' }),
    number('autoMaxModelCallsPerSession', 'budgets', { min: 1, integer: true, unitKey: 'settings.unit.calls' }),
    number('autoRouteMaxItemChars', 'budgets', { min: 1, integer: true, unitKey: 'settings.unit.chars' }),
    number('autoRouteMaxInputChars', 'budgets', { min: 1, integer: true, unitKey: 'settings.unit.chars' }),
    number('autoVerifyMaxChars', 'budgets', { min: 1000, integer: true, unitKey: 'settings.unit.chars' }),
    number('autoVerifyMaxPerTask', 'budgets', { min: 1, integer: true }),
    number('autoVerifyMaxPerSession', 'budgets', { min: 1, integer: true }),
    number('autoVerifyMinToolCalls', 'budgets', { min: 1, integer: true }),
    number('autoVerifyRepeats', 'budgets', { min: 1, integer: true }),
    number('autoVerifyFinalRepeats', 'budgets', { min: 1, integer: true }),
    toggle('captureDecisions', 'storage'),
    text('cacheDir', 'storage', true),
    number('cacheMaxEntries', 'storage', { min: 1, integer: true }),
    number('maxConcurrency', 'execution', { min: 1, integer: true }),
    number('maxRetries', 'execution', { min: 0, integer: true }),
    number('retryBaseDelayMs', 'execution', { min: 1, integer: true, unitKey: 'settings.unit.ms' }),
    number('timeoutMs', 'execution', { min: 1, integer: true, unitKey: 'settings.unit.ms' }),
    toggle('autoPriceFromCatalog', 'cost'),
    toggle('autoPriceOnline', 'cost'),
    text('priceProviderOverride', 'cost', true),
    number('estimatedInputUsdPerMillion', 'cost', { min: 0 }),
    number('estimatedOutputUsdPerMillion', 'cost', { min: 0 }),
    number('estimatedCachedInputUsdPerMillion', 'cost', { min: 0 }),
];
export function fieldsOfSection(section) {
    return FIELDS.filter(field => field.section === section);
}
export function isFieldVisible(field, values) {
    return field.visibleWhen ? field.visibleWhen(values) : true;
}
/** A field the user actually changed away from the plugin default, if it is resettable. */
export function isFieldChanged(field, values) {
    if (field.resettable === false || field.kind === 'custom')
        return false;
    const current = values[field.key];
    const fallback = CONFIG_DEFAULTS[field.key];
    if (Array.isArray(current) || Array.isArray(fallback))
        return JSON.stringify(current) !== JSON.stringify(fallback);
    return current !== fallback;
}
export function resetField(values, key) {
    return { ...values, [key]: CONFIG_DEFAULTS[key] };
}
/**
 * Build the form's value set from a settings namespace view.
 *
 * Every fallback comes from {@link CONFIG_DEFAULTS} so a fresh form and the
 * per-row "restore default" action can never disagree about what "default"
 * means. Only the shape handling (booleans default to their documented value,
 * enums fall back to the safe member, empty text clears an override) lives here.
 */
export function valuesFromView(view) {
    const v = view ?? {};
    const numberOr = (key) => {
        const raw = v[key];
        return raw === undefined || raw === null ? CONFIG_DEFAULTS[key] : Number(raw);
    };
    const mode = v.autoVerifyMode === 'manual' || v.autoVerifyMode === 'strict' ? v.autoVerifyMode : 'smart';
    // The draft always holds one of the three modes, exactly like the two history-bearing enums: a
    // legacy boolean and an unknown string both degrade to a legal value instead of leaking into
    // 'validateValues' and blocking a save the host would accept.
    const processSelection = normalizeAutoProcessSelection(v.autoProcessSelection) ?? 'off';
    const preset = v.criteriaPreset === 'debug' ||
        v.criteriaPreset === 'research' ||
        v.criteriaPreset === 'ops' ||
        v.criteriaPreset === 'writing' ||
        v.criteriaPreset === 'custom'
        ? v.criteriaPreset
        : 'coding';
    return {
        enabled: v.enabled !== false,
        captureDecisions: v.captureDecisions !== false,
        autoProcessSelection: processSelection,
        maxProcessCyclesPerTask: numberOr('maxProcessCyclesPerTask'),
        autoProcessFailureContext: v.autoProcessFailureContext !== false,
        autoProcessAlternativeModel: typeof v.autoProcessAlternativeModel === 'string' ? v.autoProcessAlternativeModel.trim() : '',
        autoProcessCandidates: numberOr('autoProcessCandidates'),
        autoVerifyMode: mode,
        autoVerifyThreshold: numberOr('autoVerifyThreshold'),
        autoVerifyRepeats: numberOr('autoVerifyRepeats'),
        autoTrackRepeats: numberOr('autoTrackRepeats'),
        autoVerifyFinalRepeats: numberOr('autoVerifyFinalRepeats'),
        autoVerifyMinToolCalls: numberOr('autoVerifyMinToolCalls'),
        autoVerifyMaxChars: numberOr('autoVerifyMaxChars'),
        autoVerifyMaxPerTask: numberOr('autoVerifyMaxPerTask'),
        autoVerifyMaxPerSession: numberOr('autoVerifyMaxPerSession'),
        autoRouteSemantic: v.autoRouteSemantic !== false,
        autoRouteMinConfidence: numberOr('autoRouteMinConfidence'),
        autoRouteMaxCandidates: numberOr('autoRouteMaxCandidates'),
        autoRouteMaxPerTask: numberOr('autoRouteMaxPerTask'),
        autoRouteMaxPerSession: numberOr('autoRouteMaxPerSession'),
        autoTrackCompletionThreshold: numberOr('autoTrackCompletionThreshold'),
        autoRouteMaxItemChars: numberOr('autoRouteMaxItemChars'),
        autoRouteMaxInputChars: numberOr('autoRouteMaxInputChars'),
        autoMaxModelCallsPerTask: numberOr('autoMaxModelCallsPerTask'),
        autoMaxModelCallsPerSession: numberOr('autoMaxModelCallsPerSession'),
        autoVerifyTeamTasks: v.autoVerifyTeamTasks !== false,
        autoVerifyPlanMode: v.autoVerifyPlanMode !== false,
        criteriaPreset: preset,
        criteriaFile: typeof v.criteriaFile === 'string' ? v.criteriaFile.trim() : '',
        provider: String(v.provider ?? ''),
        model: String(v.model ?? ''),
        ...(typeof v.reasoningEffort === 'string' ? { reasoningEffort: v.reasoningEffort } : {}),
        maxTokens: numberOr('maxTokens'),
        temperature: numberOr('temperature'),
        ...(typeof v.label === 'string' && v.label.trim() ? { label: v.label.trim() } : {}),
        maxConcurrency: numberOr('maxConcurrency'),
        maxRetries: numberOr('maxRetries'),
        retryBaseDelayMs: numberOr('retryBaseDelayMs'),
        timeoutMs: numberOr('timeoutMs'),
        cacheDir: typeof v.cacheDir === 'string' && v.cacheDir.trim() ? v.cacheDir.trim() : CONFIG_DEFAULTS.cacheDir,
        cacheMaxEntries: numberOr('cacheMaxEntries'),
        estimatedInputUsdPerMillion: numberOr('estimatedInputUsdPerMillion'),
        estimatedOutputUsdPerMillion: numberOr('estimatedOutputUsdPerMillion'),
        estimatedCachedInputUsdPerMillion: numberOr('estimatedCachedInputUsdPerMillion'),
        autoPriceFromCatalog: v.autoPriceFromCatalog !== false,
        autoPriceOnline: v.autoPriceOnline !== false,
        priceProviderOverride: typeof v.priceProviderOverride === 'string' ? v.priceProviderOverride.trim() : '',
        autoVerifySubagents: v.autoVerifySubagents === true,
        extraJudges: normalizeExtraJudges(v.extraJudges),
    };
}
/**
 * Parse-time feedback for a numeric box the user is still typing in.
 *
 * The committed draft only ever holds values that already passed this check
 * (see the page's numeric handler), so this is the only place that can explain
 * \"1.5\" in a 0–1 field before the user blurs or hits save.
 */
export function textIssue(field, raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed))
        return { key: field.key, code: 'required' };
    if (field.integer && !Number.isSafeInteger(parsed))
        return { key: field.key, code: 'integer' };
    if (field.min !== undefined && field.max !== undefined) {
        if (parsed < field.min || parsed > field.max)
            return { key: field.key, code: 'range', params: { min: field.min, max: field.max } };
    }
    else if (field.min !== undefined && parsed < field.min) {
        return { key: field.key, code: 'min', params: { min: field.min } };
    }
    else if (field.max !== undefined && parsed > field.max) {
        return { key: field.key, code: 'max', params: { max: field.max } };
    }
    return null;
}
/** True when a raw numeric string can be committed to the draft. */
export function acceptsNumber(field, raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return false;
    return textIssue(field, trimmed) === null;
}
export function validateValues(values) {
    const issues = [];
    for (const field of FIELDS) {
        if (field.kind === 'custom' || field.kind === 'toggle')
            continue;
        if (!isFieldVisible(field, values))
            continue;
        const raw = values[field.key];
        if (field.kind === 'number') {
            const value = typeof raw === 'number' ? raw : Number.NaN;
            if (!Number.isFinite(value)) {
                issues.push({ key: field.key, code: 'required' });
                continue;
            }
            if (field.integer && !Number.isSafeInteger(value)) {
                issues.push({ key: field.key, code: 'integer' });
                continue;
            }
            if (field.min !== undefined && field.max !== undefined) {
                if (value < field.min || value > field.max) {
                    issues.push({ key: field.key, code: 'range', params: { min: field.min, max: field.max } });
                    continue;
                }
            }
            else if (field.min !== undefined && value < field.min) {
                issues.push({ key: field.key, code: 'min', params: { min: field.min } });
                continue;
            }
            else if (field.max !== undefined && value > field.max) {
                issues.push({ key: field.key, code: 'max', params: { max: field.max } });
                continue;
            }
            if (field.key === 'autoRouteMaxInputChars' && values.autoRouteMaxInputChars < values.autoRouteMaxItemChars * 2) {
                issues.push({ key: field.key, code: 'routeBudget', params: { factor: 2 } });
            }
            continue;
        }
        // Empty is a legal value for the optional text fields: the custom criteria file falls
        // back to `coding`, the alternative model falls back to the request's own route, label falls
        // back to provider/model, and priceProviderOverride defaults to empty (no cross-provider guessing).
        // Requiring text here would reject a save the host accepts.
        if (field.kind === 'text' &&
            field.key !== 'criteriaFile' &&
            field.key !== 'label' &&
            field.key !== 'autoProcessAlternativeModel' &&
            field.key !== 'priceProviderOverride') {
            const value = typeof raw === 'string' ? raw.trim() : '';
            if (!value) {
                issues.push({ key: field.key, code: 'required' });
                continue;
            }
            if (field.key === 'cacheDir' && (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value) || value.split(/[\\/]+/u).includes('..'))) {
                issues.push({ key: field.key, code: 'cacheDirRelative' });
            }
        }
    }
    // The alternative-model POOL is a comma-separated list, so a single-entry regex over the whole
    // string would reject a perfectly valid pool. Every non-blank entry is validated on its own, in
    // lockstep with 'resolveConfig'; empty stays legal (= resample the session model) and blank
    // entries are dropped rather than rejected.
    const alternativePool = values.autoProcessAlternativeModel.split(',').map(entry => entry.trim()).filter(entry => entry !== '');
    if (alternativePool.some(entry => !/^[^\s/]+\/[^\s]+$/u.test(entry))) {
        issues.push({ key: 'autoProcessAlternativeModel', code: 'altModelList' });
    }
    if (!values.provider.trim())
        issues.push({ key: 'provider', code: 'required' });
    if (!values.model.trim())
        issues.push({ key: 'model', code: 'required' });
    return issues;
}
export function issueMap(issues) {
    const map = new Map();
    for (const issue of issues)
        if (!map.has(issue.key))
            map.set(issue.key, issue);
    return map;
}
/** 'settings.invalid.<code>' — the page renders these through tFormat. */
export function issueMessageKey(issue) {
    return 'settings.invalid.' + issue.code;
}
export const PROFILE_IDS = ['balanced', 'strict', 'frugal', 'toolsOnly'];
export const PROFILES = PROFILE_IDS.map(id => ({ id, titleKey: 'settings.profile.' + id }));
/**
 * The policy keys a profile owns. Identity/plumbing keys (provider, model,
 * judges, rubric, storage, execution, prices) are deliberately NOT owned by a
 * profile: switching to "frugal" must not silently repoint the judge or drop a
 * rubric the user chose.
 */
const POLICY_KEYS = [
    'autoVerifyMode',
    'autoVerifyThreshold',
    'autoVerifyRepeats',
    'autoTrackRepeats',
    'autoVerifyFinalRepeats',
    'autoVerifyMinToolCalls',
    'autoVerifyMaxChars',
    'autoVerifyMaxPerTask',
    'autoVerifyMaxPerSession',
    'autoRouteSemantic',
    'autoRouteMinConfidence',
    'autoRouteMaxCandidates',
    'autoRouteMaxPerTask',
    'autoRouteMaxPerSession',
    'autoTrackCompletionThreshold',
    'autoRouteMaxItemChars',
    'autoRouteMaxInputChars',
    'autoMaxModelCallsPerTask',
    'autoMaxModelCallsPerSession',
    'autoVerifyTeamTasks',
    'autoVerifyPlanMode',
    'autoVerifySubagents',
    'autoProcessSelection',
    'maxProcessCyclesPerTask',
    'autoProcessFailureContext',
    'autoProcessCandidates',
];
function policyDefaults(values) {
    const next = { ...values };
    for (const key of POLICY_KEYS)
        next[key] = CONFIG_DEFAULTS[key];
    return next;
}
/** The budget floor a full tournament needs for the given number of judges. */
export function recommendedBudgets(judgeCount, criteria = WORST_CASE_CRITERIA_PER_COMPARISON) {
    const { worstCaseTask, worstCaseSession } = computeWorstCaseBudget(Math.max(1, judgeCount), criteria);
    return { autoMaxModelCallsPerTask: worstCaseTask, autoMaxModelCallsPerSession: worstCaseSession };
}
export function applyProfile(values, id, criteria = WORST_CASE_CRITERIA_PER_COMPARISON) {
    const base = policyDefaults(values);
    // Budgets are only ceilings: a profile writes the safe floor for the current
    // judge count so the warning banner cannot fire on a coherent configuration.
    const budgets = recommendedBudgets(computeJudgeCount(values.extraJudges.length), criteria);
    switch (id) {
        case 'strict':
            return { ...base, ...budgets, autoVerifyMode: 'strict' };
        case 'frugal':
            return {
                ...base,
                ...budgets,
                autoVerifyMode: 'smart',
                autoVerifyThreshold: 0.7,
                autoRouteMaxCandidates: 3,
                autoRouteMaxPerTask: 1,
                autoRouteMaxPerSession: 3,
                autoVerifyMaxPerTask: 1,
                autoVerifyMaxPerSession: 3,
                autoTrackRepeats: 1,
                autoVerifyTeamTasks: false,
                autoVerifyPlanMode: false,
            };
        case 'toolsOnly':
            return { ...base, ...budgets, autoVerifyMode: 'manual' };
        case 'balanced':
        default:
            return { ...base, ...budgets };
    }
}
const PROFILE_IDENTITY_KEYS = POLICY_KEYS.filter(key => key !== 'autoMaxModelCallsPerTask' && key !== 'autoMaxModelCallsPerSession');
export function activeProfile(values, criteria = WORST_CASE_CRITERIA_PER_COMPARISON) {
    for (const id of PROFILE_IDS) {
        const target = applyProfile(values, id, criteria);
        if (PROFILE_IDENTITY_KEYS.every(key => values[key] === target[key]))
            return id;
    }
    return 'custom';
}
export function sectionSummary(id, values, t, format) {
    const label = (key) => t(key) ?? key;
    const state = values.enabled ? label('settings.summary.on') : label('settings.summary.off');
    switch (id) {
        case 'tools':
            return state;
        case 'autoVerify':
            if (values.autoVerifyMode === 'manual')
                return label('settings.summary.manualShort');
            return format('settings.summary.mode', {
                mode: label('field.autoVerifyMode.' + values.autoVerifyMode),
                preset: label('field.criteriaPreset.' + values.criteriaPreset),
                threshold: values.autoVerifyThreshold,
            });
        case 'routing':
            return format('settings.summary.routing', {
                state: values.autoRouteSemantic ? label('settings.summary.on') : label('settings.summary.off'),
                task: values.autoRouteMaxPerTask,
                session: values.autoRouteMaxPerSession,
                // The collapsed header states the P06 arm too: 'every-step' is the one setting on this page
                // that can multiply spend per step, and it must be visible without expanding the section.
                selection: label('field.autoProcessSelection.' + values.autoProcessSelection),
            });
        case 'budgets':
            return format('settings.summary.budgets', {
                task: values.autoMaxModelCallsPerTask,
                session: values.autoMaxModelCallsPerSession,
            });
        case 'storage':
            return format('settings.summary.storage', {
                state: values.captureDecisions ? label('settings.summary.on') : label('settings.summary.off'),
                entries: values.cacheMaxEntries,
            });
        case 'execution':
            return format('settings.summary.execution', { concurrency: values.maxConcurrency, timeout: values.timeoutMs });
        case 'model':
        case 'cost':
        default:
            return '';
    }
}
/** Every section with the fields that are currently visible (value-dependent rows included). */
export function renderSections(values) {
    return SECTIONS.map(section => ({
        section,
        fields: fieldsOfSection(section.id).filter(field => isFieldVisible(field, values)),
    }));
}
//# sourceMappingURL=client-fields.js.map