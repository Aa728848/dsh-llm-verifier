import { normalizeExtraJudges, type ExtraJudgeDraft } from './client-judges.ts'
import { computeJudgeCount, computeWorstCaseBudget, WORST_CASE_CRITERIA_PER_COMPARISON } from './client-i18n.ts'

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
  enabled: boolean
  captureDecisions: boolean
  autoProcessSelection: boolean
  autoProcessFailureContext: boolean
  autoProcessAlternativeModel: string
  autoProcessCandidates: number
  autoVerifyMode: 'manual' | 'smart' | 'strict'
  autoVerifyThreshold: number
  autoVerifyRepeats: number
  autoTrackRepeats: number
  autoVerifyFinalRepeats: number
  autoVerifyMinToolCalls: number
  autoVerifyMaxChars: number
  autoVerifyMaxPerTask: number
  autoVerifyMaxPerSession: number
  autoRouteSemantic: boolean
  autoRouteMinConfidence: number
  autoRouteMaxCandidates: number
  autoRouteMaxPerTask: number
  autoRouteMaxPerSession: number
  autoTrackCompletionThreshold: number
  autoRouteMaxItemChars: number
  autoRouteMaxInputChars: number
  autoMaxModelCallsPerTask: number
  autoMaxModelCallsPerSession: number
  autoVerifyTeamTasks: boolean
  autoVerifyPlanMode: boolean
  criteriaPreset: 'coding' | 'debug' | 'research' | 'ops' | 'writing' | 'custom'
  criteriaFile: string
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens: number
  temperature: number
  label?: string
  maxConcurrency: number
  maxRetries: number
  retryBaseDelayMs: number
  timeoutMs: number
  cacheDir: string
  cacheMaxEntries: number
  estimatedInputUsdPerMillion: number
  estimatedOutputUsdPerMillion: number
  estimatedCachedInputUsdPerMillion: number
  autoPriceFromCatalog: boolean
  autoPriceOnline: boolean
  priceProviderOverride: string
  autoVerifySubagents: boolean
  extraJudges: ExtraJudgeDraft[]
}

/**
 * Plugin defaults, i.e. what the form shows when the host reports no value.
 *
 * This is also the 'resolveConfig' default set, and it is the target of the
 * per-row "restore default" action and of the 'balanced' profile. It must stay
 * aligned with 'src/config.ts'; 'client-fields.test.ts' asserts that the defaults
 * need no correction once provider/model are filled in.
 */
export const CONFIG_DEFAULTS: Values = {
  enabled: true,
  captureDecisions: true,
  autoProcessSelection: false,
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
}

export type SectionId = 'tools' | 'autoVerify' | 'routing' | 'model' | 'budgets' | 'storage' | 'execution' | 'cost'

export interface SectionSpec {
  id: SectionId
  titleKey: string
  /** 'advanced' sections start collapsed and are expanded by "expand all" or a search hit. */
  tier: 'core' | 'advanced'
  open: boolean
}

/**
 * Information architecture. The old page was five flat sections with 26 rows in
 * "automatic verification"; here the policy switches stay visible and the
 * numeric ceilings and persistence knobs move into collapsed advanced sections.
 */
export const SECTIONS: readonly SectionSpec[] = [
  { id: 'tools', titleKey: 'section.tools', tier: 'core', open: true },
  { id: 'autoVerify', titleKey: 'section.autoVerify', tier: 'core', open: true },
  { id: 'routing', titleKey: 'section.routing', tier: 'core', open: false },
  { id: 'model', titleKey: 'section.model', tier: 'core', open: true },
  { id: 'budgets', titleKey: 'section.budgets', tier: 'advanced', open: false },
  { id: 'storage', titleKey: 'section.storage', tier: 'advanced', open: false },
  { id: 'execution', titleKey: 'section.execution', tier: 'advanced', open: false },
  { id: 'cost', titleKey: 'section.cost', tier: 'advanced', open: false },
]

export type FieldKind = 'toggle' | 'number' | 'text' | 'select' | 'custom'
export type SelectSource = 'mode' | 'criteriaPreset' | 'provider' | 'model' | 'effort'
export type UnitKey = 'settings.unit.ms' | 'settings.unit.chars' | 'settings.unit.calls' | 'settings.unit.tokens'

export interface FieldSpec {
  key: keyof Values
  section: SectionId
  titleKey: string
  helpKey: string
  /** Second help string, used by the couple of rows whose help text depends on the current value. */
  helpKeyOff?: string
  kind: FieldKind
  /** Which catalog/static list the select renders; only for kind 'select'. */
  select?: SelectSource
  /** Numeric bounds, mirrored from 'resolveConfig'. */
  min?: number
  max?: number
  integer?: boolean
  /** Render a range control next to the number box. */
  slider?: boolean
  unitKey?: UnitKey
  /** `false` for identity fields that have no meaningful default (provider/model/judges). */
  resettable?: boolean
  visibleWhen?: (values: Values) => boolean
}

const fieldOf = (key: keyof Values, section: SectionId, kind: FieldKind): Pick<FieldSpec, 'key' | 'section' | 'kind' | 'titleKey' | 'helpKey'> => ({
  key,
  section,
  kind,
  titleKey: 'field.' + String(key) + '.title',
  helpKey: 'field.' + String(key) + '.help',
})

const number = (
  key: keyof Values,
  section: SectionId,
  options: Omit<FieldSpec, 'key' | 'section' | 'kind' | 'titleKey' | 'helpKey'> = {},
): FieldSpec => ({ ...fieldOf(key, section, 'number'), ...options })

const toggle = (key: keyof Values, section: SectionId): FieldSpec => fieldOf(key, section, 'toggle')

const text = (key: keyof Values, section: SectionId, resettable = false): FieldSpec => ({ ...fieldOf(key, section, 'text'), resettable })

const select = (key: keyof Values, section: SectionId, source: SelectSource, resettable = true): FieldSpec => ({
  ...fieldOf(key, section, 'select'),
  select: source,
  resettable,
})

/** Render order inside a section follows this array. */
export const FIELDS: readonly FieldSpec[] = [
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
  toggle('autoProcessSelection', 'routing'),
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
]

export function fieldsOfSection(section: SectionId): FieldSpec[] {
  return FIELDS.filter(field => field.section === section)
}

export function isFieldVisible(field: FieldSpec, values: Values): boolean {
  return field.visibleWhen ? field.visibleWhen(values) : true
}

/** A field the user actually changed away from the plugin default, if it is resettable. */
export function isFieldChanged(field: FieldSpec, values: Values): boolean {
  if (field.resettable === false || field.kind === 'custom') return false
  const current = values[field.key]
  const fallback = CONFIG_DEFAULTS[field.key]
  if (Array.isArray(current) || Array.isArray(fallback)) return JSON.stringify(current) !== JSON.stringify(fallback)
  return current !== fallback
}

export function resetField<K extends keyof Values>(values: Values, key: K): Values {
  return { ...values, [key]: CONFIG_DEFAULTS[key] }
}

/**
 * Build the form's value set from a settings namespace view.
 *
 * Every fallback comes from {@link CONFIG_DEFAULTS} so a fresh form and the
 * per-row "restore default" action can never disagree about what "default"
 * means. Only the shape handling (booleans default to their documented value,
 * enums fall back to the safe member, empty text clears an override) lives here.
 */
export function valuesFromView(view: Record<string, unknown> | undefined): Values {
  const v = view ?? {}
  const numberOr = (key: keyof Values): number => {
    const raw = v[key]
    return raw === undefined || raw === null ? (CONFIG_DEFAULTS[key] as number) : Number(raw)
  }
  const mode = v.autoVerifyMode === 'manual' || v.autoVerifyMode === 'strict' ? v.autoVerifyMode : 'smart'
  const preset =
    v.criteriaPreset === 'debug' ||
    v.criteriaPreset === 'research' ||
    v.criteriaPreset === 'ops' ||
    v.criteriaPreset === 'writing' ||
    v.criteriaPreset === 'custom'
      ? v.criteriaPreset
      : 'coding'
  return {
    enabled: v.enabled !== false,
    captureDecisions: v.captureDecisions !== false,
    autoProcessSelection: v.autoProcessSelection === true,
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
  }
}

/**
 * Parse-time feedback for a numeric box the user is still typing in.
 *
 * The committed draft only ever holds values that already passed this check
 * (see the page's numeric handler), so this is the only place that can explain
 * \"1.5\" in a 0–1 field before the user blurs or hits save.
 */
export function textIssue(field: FieldSpec, raw: string): FieldIssue | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { key: field.key, code: 'required' }
  if (field.integer && !Number.isSafeInteger(parsed)) return { key: field.key, code: 'integer' }
  if (field.min !== undefined && field.max !== undefined) {
    if (parsed < field.min || parsed > field.max) return { key: field.key, code: 'range', params: { min: field.min, max: field.max } }
  } else if (field.min !== undefined && parsed < field.min) {
    return { key: field.key, code: 'min', params: { min: field.min } }
  } else if (field.max !== undefined && parsed > field.max) {
    return { key: field.key, code: 'max', params: { max: field.max } }
  }
  return null
}

/** True when a raw numeric string can be committed to the draft. */
export function acceptsNumber(field: FieldSpec, raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed === '') return false
  return textIssue(field, trimmed) === null
}

// ---------------------------------------------------------------------------
// Validation: a client-side mirror of 'resolveConfig' so the form can point at
// the offending row instead of surfacing one server-side sentence at the bottom
// of a 5000px page. Only rules that 'src/config.ts' really enforces are mirrored;
// anything else would block a save the host accepts.
// ---------------------------------------------------------------------------

export interface FieldIssue {
  key: keyof Values
  code: 'required' | 'range' | 'min' | 'max' | 'integer' | 'cacheDirRelative' | 'routeBudget'
  params?: Record<string, string | number>
}

export function validateValues(values: Values): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const field of FIELDS) {
    if (field.kind === 'custom' || field.kind === 'toggle') continue
    if (!isFieldVisible(field, values)) continue
    const raw = values[field.key]
    if (field.kind === 'number') {
      const value = typeof raw === 'number' ? raw : Number.NaN
      if (!Number.isFinite(value)) {
        issues.push({ key: field.key, code: 'required' })
        continue
      }
      if (field.integer && !Number.isSafeInteger(value)) {
        issues.push({ key: field.key, code: 'integer' })
        continue
      }
      if (field.min !== undefined && field.max !== undefined) {
        if (value < field.min || value > field.max) {
          issues.push({ key: field.key, code: 'range', params: { min: field.min, max: field.max } })
          continue
        }
      } else if (field.min !== undefined && value < field.min) {
        issues.push({ key: field.key, code: 'min', params: { min: field.min } })
        continue
      } else if (field.max !== undefined && value > field.max) {
        issues.push({ key: field.key, code: 'max', params: { max: field.max } })
        continue
      }
      if (field.key === 'autoRouteMaxInputChars' && values.autoRouteMaxInputChars < values.autoRouteMaxItemChars * 2) {
        issues.push({ key: field.key, code: 'routeBudget', params: { factor: 2 } })
      }
      continue
    }
    // Empty is a legal value for the two identity-ish text fields: the custom criteria file falls
    // back to `coding`, and the alternative model falls back to the request's own route. Requiring
    // text here would reject a save the host accepts.
    if (field.kind === 'text' && field.key !== 'criteriaFile' && field.key !== 'label' && field.key !== 'autoProcessAlternativeModel') {
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) {
        issues.push({ key: field.key, code: 'required' })
        continue
      }
      if (field.key === 'cacheDir' && (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value) || value.split(/[\\/]+/u).includes('..'))) {
        issues.push({ key: field.key, code: 'cacheDirRelative' })
      }
    }
  }
  if (!values.provider.trim()) issues.push({ key: 'provider', code: 'required' })
  if (!values.model.trim()) issues.push({ key: 'model', code: 'required' })
  return issues
}

export function issueMap(issues: readonly FieldIssue[]): Map<keyof Values, FieldIssue> {
  const map = new Map<keyof Values, FieldIssue>()
  for (const issue of issues) if (!map.has(issue.key)) map.set(issue.key, issue)
  return map
}

/** 'settings.invalid.<code>' — the page renders these through tFormat. */
export function issueMessageKey(issue: FieldIssue): string {
  return 'settings.invalid.' + issue.code
}

// ---------------------------------------------------------------------------
// Quick configuration profiles
// ---------------------------------------------------------------------------

export type ProfileId = 'balanced' | 'strict' | 'frugal' | 'toolsOnly'

export const PROFILE_IDS: readonly ProfileId[] = ['balanced', 'strict', 'frugal', 'toolsOnly']

export interface ProfileSpec {
  id: ProfileId
  titleKey: string
}

export const PROFILES: readonly ProfileSpec[] = PROFILE_IDS.map(id => ({ id, titleKey: 'settings.profile.' + id }))

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
  'autoProcessFailureContext',
  'autoProcessCandidates',
] as const satisfies readonly (keyof Values)[]

function policyDefaults(values: Values): Values {
  const next = { ...values } as Record<string, unknown>
  for (const key of POLICY_KEYS) next[key] = CONFIG_DEFAULTS[key]
  return next as unknown as Values
}

/** The budget floor a full tournament needs for the given number of judges. */
export function recommendedBudgets(judgeCount: number, criteria = WORST_CASE_CRITERIA_PER_COMPARISON): {
  autoMaxModelCallsPerTask: number
  autoMaxModelCallsPerSession: number
} {
  const { worstCaseTask, worstCaseSession } = computeWorstCaseBudget(Math.max(1, judgeCount), criteria)
  return { autoMaxModelCallsPerTask: worstCaseTask, autoMaxModelCallsPerSession: worstCaseSession }
}

export function applyProfile(values: Values, id: ProfileId, criteria = WORST_CASE_CRITERIA_PER_COMPARISON): Values {
  const base = policyDefaults(values)
  // Budgets are only ceilings: a profile writes the safe floor for the current
  // judge count so the warning banner cannot fire on a coherent configuration.
  const budgets = recommendedBudgets(computeJudgeCount(values.extraJudges.length), criteria)
  switch (id) {
    case 'strict':
      return { ...base, ...budgets, autoVerifyMode: 'strict' }
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
      }
    case 'toolsOnly':
      return { ...base, ...budgets, autoVerifyMode: 'manual' }
    case 'balanced':
    default:
      return { ...base, ...budgets }
  }
}

/**
 * Which profile a draft currently *is*, or 'custom' when it matches none.
 *
 * The selector shows this value, so it must never claim a profile the settings
 * no longer describe. Budgets are deliberately excluded from the comparison:
 * they are derived (the safe floor for the current judge count), so a hand-made
 * budget tweak should not flip an otherwise untouched policy set to "custom".
 */
export type ActiveProfile = ProfileId | 'custom'

const PROFILE_IDENTITY_KEYS: readonly (keyof Values)[] = POLICY_KEYS.filter(
  key => key !== 'autoMaxModelCallsPerTask' && key !== 'autoMaxModelCallsPerSession',
)

export function activeProfile(values: Values, criteria = WORST_CASE_CRITERIA_PER_COMPARISON): ActiveProfile {
  for (const id of PROFILE_IDS) {
    const target = applyProfile(values, id, criteria)
    if (PROFILE_IDENTITY_KEYS.every(key => values[key] === target[key])) return id
  }
  return 'custom'
}

// ---------------------------------------------------------------------------
// Collapsed-section summaries: a collapsed header still says what it holds.
// ---------------------------------------------------------------------------

export type Translate = (key: string) => string | undefined

export type Format = (template: string, params?: Record<string, string | number>) => string

export function sectionSummary(id: SectionId, values: Values, t: Translate, format: Format): string {
  const label = (key: string): string => t(key) ?? key
  const state = values.enabled ? label('settings.summary.on') : label('settings.summary.off')
  switch (id) {
    case 'tools':
      return state
    case 'autoVerify':
      if (values.autoVerifyMode === 'manual') return label('settings.summary.manualShort')
      return format('settings.summary.mode', {
        mode: label('field.autoVerifyMode.' + values.autoVerifyMode),
        preset: label('field.criteriaPreset.' + values.criteriaPreset),
        threshold: values.autoVerifyThreshold,
      })
    case 'routing':
      return format('settings.summary.routing', {
        state: values.autoRouteSemantic ? label('settings.summary.on') : label('settings.summary.off'),
        task: values.autoRouteMaxPerTask,
        session: values.autoRouteMaxPerSession,
      })
    case 'budgets':
      return format('settings.summary.budgets', {
        task: values.autoMaxModelCallsPerTask,
        session: values.autoMaxModelCallsPerSession,
      })
    case 'storage':
      return format('settings.summary.storage', {
        state: values.captureDecisions ? label('settings.summary.on') : label('settings.summary.off'),
        entries: values.cacheMaxEntries,
      })
    case 'execution':
      return format('settings.summary.execution', { concurrency: values.maxConcurrency, timeout: values.timeoutMs })
    case 'model':
    case 'cost':
    default:
      return ''
  }
}

/** Every section with the fields that are currently visible (value-dependent rows included). */
export function renderSections(values: Values): { section: SectionSpec; fields: FieldSpec[] }[] {
  return SECTIONS.map(section => ({
    section,
    fields: fieldsOfSection(section.id).filter(field => isFieldVisible(field, values)),
  }))
}
