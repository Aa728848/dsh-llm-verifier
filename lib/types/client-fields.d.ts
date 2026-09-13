import { type ExtraJudgeDraft } from './client-judges.ts';
/**
 * The settings form's single source of truth.
 *
 * The page used to hand-write 41 row blocks, which made the form impossible to
 * reorganize: every new field had to be pasted into a 5000px column, its default
 * restated inline, and its constraints (if any) only existed server-side in
 * 'resolveConfig'. This module is a declarative registry: the renderer, the
 * search box, the collapse state, the cross-field validation and the
 * quick-configuration profiles are all driven by the same table.
 *
 * Everything here is pure so it can be unit tested without a DOM.
 */
export interface Values {
    enabled: boolean;
    captureDecisions: boolean;
    autoProcessSelection: boolean;
    autoProcessFailureContext: boolean;
    autoProcessAlternativeModel: string;
    autoVerifyMode: 'manual' | 'smart' | 'strict';
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
    autoRouteMaxItemChars: number;
    autoRouteMaxInputChars: number;
    autoMaxModelCallsPerTask: number;
    autoMaxModelCallsPerSession: number;
    autoVerifyTeamTasks: boolean;
    autoVerifyPlanMode: boolean;
    criteriaPreset: 'coding' | 'debug' | 'research' | 'ops' | 'writing' | 'custom';
    criteriaFile: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens: number;
    temperature: number;
    label?: string;
    maxConcurrency: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    timeoutMs: number;
    cacheDir: string;
    cacheMaxEntries: number;
    estimatedInputUsdPerMillion: number;
    estimatedOutputUsdPerMillion: number;
    autoVerifySubagents: boolean;
    extraJudges: ExtraJudgeDraft[];
}
/**
 * Plugin defaults, i.e. what the form shows when the host reports no value.
 *
 * This is also the 'resolveConfig' default set, and it is the target of the
 * per-row "restore default" action and of the 'balanced' profile. It must stay
 * aligned with 'src/config.ts'; 'client-fields.test.ts' asserts that the defaults
 * need no correction once provider/model are filled in.
 */
export declare const CONFIG_DEFAULTS: Values;
export type SectionId = 'tools' | 'autoVerify' | 'routing' | 'model' | 'budgets' | 'storage' | 'execution' | 'cost';
export interface SectionSpec {
    id: SectionId;
    titleKey: string;
    /** 'advanced' sections start collapsed and are expanded by "expand all" or a search hit. */
    tier: 'core' | 'advanced';
    open: boolean;
}
/**
 * Information architecture. The old page was five flat sections with 26 rows in
 * "automatic verification"; here the policy switches stay visible and the
 * numeric ceilings and persistence knobs move into collapsed advanced sections.
 */
export declare const SECTIONS: readonly SectionSpec[];
export type FieldKind = 'toggle' | 'number' | 'text' | 'select' | 'custom';
export type SelectSource = 'mode' | 'criteriaPreset' | 'provider' | 'model' | 'effort';
export type UnitKey = 'settings.unit.ms' | 'settings.unit.chars' | 'settings.unit.calls' | 'settings.unit.tokens';
export interface FieldSpec {
    key: keyof Values;
    section: SectionId;
    titleKey: string;
    helpKey: string;
    /** Second help string, used by the couple of rows whose help text depends on the current value. */
    helpKeyOff?: string;
    kind: FieldKind;
    /** Which catalog/static list the select renders; only for kind 'select'. */
    select?: SelectSource;
    /** Numeric bounds, mirrored from 'resolveConfig'. */
    min?: number;
    max?: number;
    integer?: boolean;
    /** Render a range control next to the number box. */
    slider?: boolean;
    unitKey?: UnitKey;
    /** `false` for identity fields that have no meaningful default (provider/model/judges). */
    resettable?: boolean;
    visibleWhen?: (values: Values) => boolean;
}
/** Render order inside a section follows this array. */
export declare const FIELDS: readonly FieldSpec[];
export declare function fieldsOfSection(section: SectionId): FieldSpec[];
export declare function isFieldVisible(field: FieldSpec, values: Values): boolean;
/** A field the user actually changed away from the plugin default, if it is resettable. */
export declare function isFieldChanged(field: FieldSpec, values: Values): boolean;
export declare function resetField<K extends keyof Values>(values: Values, key: K): Values;
/**
 * Build the form's value set from a settings namespace view.
 *
 * Every fallback comes from {@link CONFIG_DEFAULTS} so a fresh form and the
 * per-row "restore default" action can never disagree about what "default"
 * means. Only the shape handling (booleans default to their documented value,
 * enums fall back to the safe member, empty text clears an override) lives here.
 */
export declare function valuesFromView(view: Record<string, unknown> | undefined): Values;
/**
 * Parse-time feedback for a numeric box the user is still typing in.
 *
 * The committed draft only ever holds values that already passed this check
 * (see the page's numeric handler), so this is the only place that can explain
 * \"1.5\" in a 0–1 field before the user blurs or hits save.
 */
export declare function textIssue(field: FieldSpec, raw: string): FieldIssue | null;
/** True when a raw numeric string can be committed to the draft. */
export declare function acceptsNumber(field: FieldSpec, raw: string): boolean;
export interface FieldIssue {
    key: keyof Values;
    code: 'required' | 'range' | 'min' | 'max' | 'integer' | 'cacheDirRelative' | 'routeBudget';
    params?: Record<string, string | number>;
}
export declare function validateValues(values: Values): FieldIssue[];
export declare function issueMap(issues: readonly FieldIssue[]): Map<keyof Values, FieldIssue>;
/** 'settings.invalid.<code>' — the page renders these through tFormat. */
export declare function issueMessageKey(issue: FieldIssue): string;
export type ProfileId = 'balanced' | 'strict' | 'frugal' | 'toolsOnly';
export declare const PROFILE_IDS: readonly ProfileId[];
export interface ProfileSpec {
    id: ProfileId;
    titleKey: string;
}
export declare const PROFILES: readonly ProfileSpec[];
/** The budget floor a full tournament needs for the given number of judges. */
export declare function recommendedBudgets(judgeCount: number, criteria?: number): {
    autoMaxModelCallsPerTask: number;
    autoMaxModelCallsPerSession: number;
};
export declare function applyProfile(values: Values, id: ProfileId, criteria?: number): Values;
/**
 * Which profile a draft currently *is*, or 'custom' when it matches none.
 *
 * The selector shows this value, so it must never claim a profile the settings
 * no longer describe. Budgets are deliberately excluded from the comparison:
 * they are derived (the safe floor for the current judge count), so a hand-made
 * budget tweak should not flip an otherwise untouched policy set to "custom".
 */
export type ActiveProfile = ProfileId | 'custom';
export declare function activeProfile(values: Values, criteria?: number): ActiveProfile;
export type Translate = (key: string) => string | undefined;
export type Format = (template: string, params?: Record<string, string | number>) => string;
export declare function sectionSummary(id: SectionId, values: Values, t: Translate, format: Format): string;
/** Every section with the fields that are currently visible (value-dependent rows included). */
export declare function renderSections(values: Values): {
    section: SectionSpec;
    fields: FieldSpec[];
}[];
//# sourceMappingURL=client-fields.d.ts.map