import { describe, expect, it } from 'vitest'
import { zh, en, computeJudgeCount, computeWorstCaseBudget } from './client-i18n.ts'
import {
  CONFIG_DEFAULTS,
  FIELDS,
  PROFILES,
  PROFILE_IDS,
  SECTIONS,
  acceptsNumber,
  activeProfile,
  applyProfile,
  fieldsOfSection,
  isFieldChanged,
  isFieldVisible,
  issueMap,
  issueMessageKey,
  recommendedBudgets,
  resetField,
  renderSections,
  sectionSummary,
  textIssue,
  validateValues,
  valuesFromView,
  type FieldSpec,
  type Values,
} from './client-fields.ts'

/** A base that passes every validation: the two identity fields have no default. */
const base: Values = { ...CONFIG_DEFAULTS, provider: 'deepseek-official', model: 'deepseek-flash' }
const translateFor = (dictionary: Record<string, string>) => (key: string): string | undefined => dictionary[key]
const zhT = translateFor(zh as unknown as Record<string, string>)
const enT = translateFor(en as unknown as Record<string, string>)
const format = (template: string, params?: Record<string, string | number>): string =>
  (zhT(template) ?? template).replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))

const field = (key: string): FieldSpec => {
  const found = FIELDS.find(candidate => candidate.key === key)
  if (!found) throw new Error('unknown field ' + key)
  return found
}
const codesFor = (values: Values, key: string): string[] =>
  validateValues(values)
    .filter(issue => issue.key === key)
    .map(issue => issue.code)

describe('settings field registry', () => {
  it('covers every declared field exactly once and only known sections', () => {
    const keys = FIELDS.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeGreaterThan(40)
    const sections = new Set(SECTIONS.map(section => section.id))
    for (const entry of FIELDS) expect(sections.has(entry.section)).toBe(true)
    // every section is addressable and non-empty except none: each id must appear
    for (const section of SECTIONS) expect(FIELDS.some(entry => entry.section === section.id)).toBe(true)
  })

  it('gives every field a default to fall back to', () => {
    for (const entry of FIELDS) {
      const optional = entry.key === 'reasoningEffort' || entry.key === 'label'
      expect(optional || Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, entry.key)).toBe(true)
    }
  })

  it('resolves every localized title and help string in both dictionaries', () => {
    for (const entry of FIELDS) {
      for (const dictionary of [zhT, enT]) {
        expect(typeof dictionary(entry.titleKey)).toBe('string')
        expect(typeof dictionary(entry.helpKey)).toBe('string')
        if (entry.helpKeyOff) expect(typeof dictionary(entry.helpKeyOff)).toBe('string')
      }
    }
  })

  it('resolves every section title, profile and validation message', () => {
    const keys = [
      ...SECTIONS.map(section => section.titleKey),
      ...PROFILES.map(profile => profile.titleKey),
      'settings.invalid.required',
      'settings.invalid.range',
      'settings.invalid.min',
      'settings.invalid.max',
      'settings.invalid.integer',
      'settings.invalid.cacheDirRelative',
      'settings.invalid.routeBudget',
      'settings.summary.line',
      'settings.summary.mode',
      'settings.summary.routing',
      'settings.summary.budgets',
      'settings.summary.storage',
      'settings.summary.execution',
      'settings.summary.on',
      'settings.summary.off',
      'settings.summary.manual',
      'settings.summary.manualShort',
      'settings.summary.judges',
      'settings.unit.ms',
      'settings.unit.chars',
      'settings.unit.calls',
      'settings.unit.tokens',
      'settings.fieldReset',
      'settings.fieldChanged',
      'settings.recommend',
      'settings.profile.title',
      'settings.profile.hint',
      'settings.profile.custom',
      'settings.advancedBadge',
      'settings.expandAll',
      'settings.collapseAll',
      'settings.sectionExpand',
      'settings.sectionCollapse',
      'settings.jumpToIssue',
      'settings.invalid.summary',
    ]
    for (const key of keys) {
      expect(typeof zhT(key), 'zh ' + key).toBe('string')
      expect(typeof enT(key), 'en ' + key).toBe('string')
    }
  })
})

describe('settings values', () => {
  it('builds exactly the defaults from an empty namespace view', () => {
    expect(valuesFromView({})).toEqual(CONFIG_DEFAULTS)
    expect(valuesFromView(undefined)).toEqual(CONFIG_DEFAULTS)
  })

  it('keeps the defaults self-consistent, so a fresh form can always be saved', () => {
    expect(validateValues(base)).toEqual([])
  })

  it('reads overrides and falls back to the safe member of every enum', () => {
    const values = valuesFromView({
      enabled: false,
      autoVerifyMode: 'strict',
      criteriaPreset: 'debug',
      autoRouteSemantic: false,
      maxRetries: 0,
      cacheDir: '  nested/cache  ',
      label: '  judge A ',
      reasoningEffort: 'high',
      extraJudges: [{ provider: 'p', model: 'm' }],
    })
    expect(values.enabled).toBe(false)
    expect(values.autoVerifyMode).toBe('strict')
    expect(values.criteriaPreset).toBe('debug')
    expect(values.autoRouteSemantic).toBe(false)
    expect(values.maxRetries).toBe(0)
    expect(values.cacheDir).toBe('nested/cache')
    expect(values.label).toBe('judge A')
    expect(values.reasoningEffort).toBe('high')
    expect(values.extraJudges).toHaveLength(1)
    expect(valuesFromView({ autoVerifyMode: 'nonsense', criteriaPreset: 'nonsense' })).toMatchObject({
      autoVerifyMode: 'smart',
      criteriaPreset: 'coding',
    })
    // a discarded enum member must not leak an invalid value into the draft
    expect(validateValues(valuesFromView({ provider: 'p', model: 'm', autoVerifyMode: 'nonsense', criteriaPreset: 'nonsense' }))).toEqual([])
  })
})

describe('P06 settings mirror resolveConfig', () => {
  it('offers the three modes as a select with one label key each', () => {
    const field = FIELDS.find(entry => entry.key === 'autoProcessSelection')!
    expect(field.kind).toBe('select')
    expect(field.select).toBe('processSelection')
    expect(field.section).toBe('routing')
    expect(CONFIG_DEFAULTS.autoProcessSelection).toBe('off')
    // Every selectable mode has a label in BOTH dictionaries; I18nDict makes a missing one a
    // compile error, and this keeps the render list and the dictionaries from drifting apart.
    for (const mode of ['off', 'recovery', 'every-step']) {
      expect(typeof zhT('field.autoProcessSelection.' + mode)).toBe('string')
      expect(typeof enT('field.autoProcessSelection.' + mode)).toBe('string')
    }
    // The every-step warning copy the settings page wires up later must exist in both dictionaries.
    expect(typeof zhT('field.autoProcessSelection.everyStepWarning')).toBe('string')
    expect(typeof enT('field.autoProcessSelection.everyStepWarning')).toBe('string')
  })

  it('reads a legacy boolean and an unknown mode as a legal draft value', () => {
    // The saved section may predate the mode (boolean) or be corrupt; neither may leak into the
    // draft, because '#validateValues' only knows the three modes.
    expect(valuesFromView({ autoProcessSelection: true }).autoProcessSelection).toBe('recovery')
    expect(valuesFromView({ autoProcessSelection: false }).autoProcessSelection).toBe('off')
    expect(valuesFromView({ autoProcessSelection: 'every-step' }).autoProcessSelection).toBe('every-step')
    expect(valuesFromView({ autoProcessSelection: 'nonsense' }).autoProcessSelection).toBe('off')
    expect(valuesFromView({}).autoProcessSelection).toBe('off')
    for (const raw of [true, false, 'nonsense', 'every-step', undefined]) {
      expect(validateValues(valuesFromView({ provider: 'p', model: 'm', autoProcessSelection: raw })), String(raw)).toEqual([])
    }
  })

  it('bounds the every-step cycle allowance exactly like resolveConfig', () => {
    const field = FIELDS.find(entry => entry.key === 'maxProcessCyclesPerTask')!
    expect(field.kind).toBe('number')
    expect(field.section).toBe('routing')
    expect({ min: field.min, max: field.max, integer: field.integer }).toEqual({ min: 1, max: 32, integer: true })
    expect(CONFIG_DEFAULTS.maxProcessCyclesPerTask).toBe(4)
    // Boundaries inclusive, and the exact mirror of the server rule.
    expect(validateValues({ ...base, maxProcessCyclesPerTask: 1 })).toEqual([])
    expect(validateValues({ ...base, maxProcessCyclesPerTask: 32 })).toEqual([])
    expect(codesFor({ ...base, maxProcessCyclesPerTask: 0 }, 'maxProcessCyclesPerTask')).toEqual(['range'])
    expect(codesFor({ ...base, maxProcessCyclesPerTask: 33 }, 'maxProcessCyclesPerTask')).toEqual(['range'])
    expect(codesFor({ ...base, maxProcessCyclesPerTask: 2.5 }, 'maxProcessCyclesPerTask')).toEqual(['integer'])
  })

  it('validates the alternative-model POOL entry by entry, not the joined string', () => {
    // A single regex over the whole setting would reject every valid pool.
    expect(codesFor(base, 'autoProcessAlternativeModel')).toEqual([])
    expect(codesFor({ ...base, autoProcessAlternativeModel: 'a/1,b/2' }, 'autoProcessAlternativeModel')).toEqual([])
    expect(codesFor({ ...base, autoProcessAlternativeModel: 'a/1,b/2,c/3' }, 'autoProcessAlternativeModel')).toEqual([])
    expect(codesFor({ ...base, autoProcessAlternativeModel: 'p/a/b' }, 'autoProcessAlternativeModel')).toEqual([])
    // Empty and blank entries stay legal: they mean "resample the session model".
    expect(codesFor({ ...base, autoProcessAlternativeModel: '' }, 'autoProcessAlternativeModel')).toEqual([])
    expect(codesFor({ ...base, autoProcessAlternativeModel: ' , ' }, 'autoProcessAlternativeModel')).toEqual([])
    expect(codesFor({ ...base, autoProcessAlternativeModel: 'a/1,,b/2' }, 'autoProcessAlternativeModel')).toEqual([])
    // Exactly the entries resolveConfig rejects.
    for (const bad of ['openai', 'a/1,openai', 'a/1, /b', 'b/', 'a b/2', 'a/1,b/2,/']) {
      expect(codesFor({ ...base, autoProcessAlternativeModel: bad }, 'autoProcessAlternativeModel'), bad).toEqual(['altModelList'])
    }
    expect(typeof zhT('settings.invalid.altModelList')).toBe('string')
    expect(typeof enT('settings.invalid.altModelList')).toBe('string')
  })

  it('owns the P06 fields in every profile, so a switch resets the expensive arm', () => {
    for (const id of PROFILE_IDS) {
      const next = applyProfile({ ...base, autoProcessSelection: 'every-step', maxProcessCyclesPerTask: 32 }, id)
      expect(next.autoProcessSelection, id).toBe('off')
      expect(next.maxProcessCyclesPerTask, id).toBe(4)
    }
    // A hand-tuned every-step draft is 'custom' rather than a profile it no longer matches.
    expect(activeProfile({ ...base, autoProcessSelection: 'every-step' })).toBe('custom')
  })
})

describe('settings validation', () => {
  it('mirrors the resolveConfig bounds that a text box can violate', () => {
    expect(codesFor({ ...base, autoVerifyThreshold: 1.5 }, 'autoVerifyThreshold')).toEqual(['range'])
    expect(codesFor({ ...base, autoRouteMinConfidence: -0.1 }, 'autoRouteMinConfidence')).toEqual(['range'])
    expect(codesFor({ ...base, autoTrackCompletionThreshold: 2 }, 'autoTrackCompletionThreshold')).toEqual(['range'])
    expect(codesFor({ ...base, temperature: 2.5 }, 'temperature')).toEqual(['range'])
    expect(codesFor({ ...base, autoRouteMaxCandidates: 2 }, 'autoRouteMaxCandidates')).toEqual(['range'])
    expect(codesFor({ ...base, autoRouteMaxCandidates: 17 }, 'autoRouteMaxCandidates')).toEqual(['range'])
    expect(codesFor({ ...base, autoVerifyMaxChars: 999 }, 'autoVerifyMaxChars')).toEqual(['min'])
    expect(codesFor({ ...base, maxConcurrency: 0 }, 'maxConcurrency')).toEqual(['min'])
    expect(codesFor({ ...base, autoMaxModelCallsPerTask: 0 }, 'autoMaxModelCallsPerTask')).toEqual(['min'])
    expect(codesFor({ ...base, maxRetries: 1.5 }, 'maxRetries')).toEqual(['integer'])
    expect(codesFor({ ...base, estimatedOutputUsdPerMillion: -1 }, 'estimatedOutputUsdPerMillion')).toEqual(['min'])
    expect(codesFor({ ...base, timeoutMs: Number.NaN }, 'timeoutMs')).toEqual(['required'])
  })

  it('keeps the two route budgets ordered', () => {
    expect(codesFor({ ...base, autoRouteMaxItemChars: 20000, autoRouteMaxInputChars: 30000 }, 'autoRouteMaxInputChars')).toEqual(['routeBudget'])
    expect(codesFor({ ...base, autoRouteMaxItemChars: 20000, autoRouteMaxInputChars: 40000 }, 'autoRouteMaxInputChars')).toEqual([])
  })

  it('rejects a cache directory outside the topic, and empty identity fields', () => {
    expect(codesFor({ ...base, cacheDir: 'C:\\verifier' }, 'cacheDir')).toEqual(['cacheDirRelative'])
    expect(codesFor({ ...base, cacheDir: 'a/../b' }, 'cacheDir')).toEqual(['cacheDirRelative'])
    expect(codesFor({ ...base, cacheDir: '/etc/verifier' }, 'cacheDir')).toEqual(['cacheDirRelative'])
    expect(codesFor({ ...base, cacheDir: ' ' }, 'cacheDir')).toEqual(['required'])
    expect(codesFor({ ...base, cacheDir: 'nested/verifier' }, 'cacheDir')).toEqual([])
    expect(codesFor({ ...base, provider: '' }, 'provider')).toEqual(['required'])
    expect(codesFor({ ...base, model: '  ' }, 'model')).toEqual(['required'])
    expect(codesFor({ ...base, priceProviderOverride: '' }, 'priceProviderOverride')).toEqual([])
    expect(codesFor({ ...base, priceProviderOverride: 'deepseek-official' }, 'priceProviderOverride')).toEqual([])
  })

  it('never blocks a missing custom rubric file: the resolver falls back and reports why', () => {
    const values = { ...base, criteriaPreset: 'custom' as const, criteriaFile: '' }
    expect(validateValues(values)).toEqual([])
    // ...and the field is only rendered while the custom preset is selected
    expect(isFieldVisible(field('criteriaFile'), values)).toBe(true)
    expect(isFieldVisible(field('criteriaFile'), base)).toBe(false)
    expect(codesFor(base, 'criteriaFile')).toEqual([])
  })

  it('reports parse-time feedback for a half-typed number', () => {
    const threshold = field('autoVerifyThreshold')
    expect(textIssue(threshold, '0.7')).toBeNull()
    expect(textIssue(threshold, '')).toBeNull()
    expect(textIssue(threshold, '1.5')?.code).toBe('range')
    expect(textIssue(threshold, 'abc')?.code).toBe('required')
    expect(textIssue(field('autoRouteMaxCandidates'), '3.5')?.code).toBe('integer')
    expect(textIssue(field('maxRetries'), '0')).toBeNull()
    expect(acceptsNumber(threshold, '0.65')).toBe(true)
    expect(acceptsNumber(threshold, '1.5')).toBe(false)
    expect(acceptsNumber(threshold, '')).toBe(false)
  })

  it('maps issues to the localized message keys and keeps the first issue per field', () => {
    const issues = validateValues({ ...base, autoVerifyThreshold: 5, temperature: 5 })
    const map = issueMap(issues)
    expect(map.get('autoVerifyThreshold')?.code).toBe('range')
    expect(issueMessageKey({ key: 'autoVerifyThreshold', code: 'range' })).toBe('settings.invalid.range')
    expect(issues.map(issue => issue.key)).toContain('temperature')
  })
})

describe('settings defaults and profiles', () => {
  it('tracks a changed field and restores it', () => {
    const threshold = field('autoVerifyThreshold')
    expect(isFieldChanged(threshold, base)).toBe(false)
    const changed = { ...base, autoVerifyThreshold: 0.8 }
    expect(isFieldChanged(threshold, changed)).toBe(true)
    expect(resetField(changed, 'autoVerifyThreshold').autoVerifyThreshold).toBe(CONFIG_DEFAULTS.autoVerifyThreshold)
    // identity fields have no meaningful default and must not offer a reset
    expect(isFieldChanged(field('provider'), { ...base, provider: 'other' })).toBe(false)
    expect(isFieldChanged(field('model'), { ...base, model: 'other' })).toBe(false)
    expect(isFieldChanged(field('extraJudges'), base)).toBe(false)
  })

  it('writes a coherent, warning-free configuration for every profile', () => {
    const lean = { ...base, provider: 'other', model: 'other-model', criteriaPreset: 'ops' as const, maxConcurrency: 3 }
    for (const id of PROFILE_IDS) {
      const next = applyProfile(lean, id)
      expect(validateValues(next), id).toEqual([])
      // identity/plumbing settings survive a profile switch
      expect(next.provider, id).toBe('other')
      expect(next.model, id).toBe('other-model')
      expect(next.criteriaPreset, id).toBe('ops')
      expect(next.maxConcurrency, id).toBe(3)
      const floor = recommendedBudgets(computeJudgeCount(next.extraJudges.length))
      expect(next.autoMaxModelCallsPerTask, id).toBeGreaterThanOrEqual(floor.autoMaxModelCallsPerTask)
      expect(next.autoMaxModelCallsPerSession, id).toBeGreaterThanOrEqual(floor.autoMaxModelCallsPerSession)
      const worst = computeWorstCaseBudget(computeJudgeCount(next.extraJudges.length))
      expect(next.autoMaxModelCallsPerTask, id).toBeGreaterThanOrEqual(worst.worstCaseTask)
      expect(next.autoMaxModelCallsPerSession, id).toBeGreaterThanOrEqual(worst.worstCaseSession)
    }
    expect(applyProfile(lean, 'strict').autoVerifyMode).toBe('strict')
    expect(applyProfile(lean, 'toolsOnly').autoVerifyMode).toBe('manual')
    expect(applyProfile(lean, 'frugal')).toMatchObject({ autoVerifyMode: 'smart', autoVerifyTeamTasks: false, autoRouteMaxCandidates: 3 })
    // the recommendation itself still respects the judge count
    const shape = (budget: { worstCaseTask: number; worstCaseSession: number }) => ({
      autoMaxModelCallsPerTask: budget.worstCaseTask,
      autoMaxModelCallsPerSession: budget.worstCaseSession,
    })
    expect(recommendedBudgets(2)).toEqual(shape(computeWorstCaseBudget(2)))
    expect(recommendedBudgets(0)).toEqual(shape(computeWorstCaseBudget(1)))
  })
})

describe('active profile', () => {
  it('reports the profile a draft currently matches, and custom otherwise', () => {
    expect(activeProfile(base)).toBe('balanced')
    for (const id of PROFILE_IDS) expect(activeProfile(applyProfile(base, id)), id).toBe(id)
    expect(activeProfile({ ...base, autoVerifyThreshold: 0.5 })).toBe('custom')
    expect(activeProfile({ ...base, autoRouteSemantic: false })).toBe('custom')
    expect(activeProfile(applyProfile(base, 'toolsOnly'))).toBe('toolsOnly')
  })

  it('ignores the derived budgets when deciding which profile is active', () => {
    const tuned = { ...applyProfile(base, 'strict'), autoMaxModelCallsPerTask: 321, autoMaxModelCallsPerSession: 654 }
    expect(activeProfile(tuned)).toBe('strict')
    expect(validateValues(tuned)).toEqual([])
  })
})

describe('settings navigation', () => {
  const visibleKeys = (values: Values): string[] =>
    renderSections(values).flatMap(entry => entry.fields.map(entry => String(entry.key)))

  it('renders every section with the fields that are visible for the draft', () => {
    const all = renderSections(base)
    expect(all.map(entry => entry.section.id)).toEqual(SECTIONS.map(section => section.id))
    for (const entry of all) expect(entry.fields.length, entry.section.id).toBeGreaterThan(0)
    expect(visibleKeys(base)).not.toContain('criteriaFile')
    const custom = visibleKeys({ ...base, criteriaPreset: 'custom' })
    expect(custom).toContain('criteriaFile')
    expect(custom).toHaveLength(visibleKeys(base).length + 1)
  })

  it('summarizes a collapsed section from the live draft', () => {
    expect(sectionSummary('tools', { ...base, enabled: false }, zhT, format)).toBe(zhT('settings.summary.off'))
    expect(sectionSummary('tools', base, zhT, format)).toBe(zhT('settings.summary.on'))
    expect(sectionSummary('autoVerify', { ...base, autoVerifyMode: 'manual' }, zhT, format)).toBe(zhT('settings.summary.manualShort'))
    expect(sectionSummary('autoVerify', base, zhT, format)).toContain('0.65')
    expect(sectionSummary('routing', base, zhT, format)).toContain('2/8')
    // The collapsed routing header states the P06 arm: the one setting here that can multiply spend
    // per step must be readable without expanding the section.
    expect(sectionSummary('routing', base, zhT, format)).toContain(zhT('field.autoProcessSelection.off'))
    expect(sectionSummary('routing', { ...base, autoProcessSelection: 'every-step' }, zhT, format)).toContain(zhT('field.autoProcessSelection.every-step'))
    expect(sectionSummary('budgets', base, zhT, format)).toContain('96')
    expect(sectionSummary('model', base, zhT, format)).toBe('')
  })

  it('keeps every section reachable through its own fields', () => {
    for (const section of SECTIONS) expect(fieldsOfSection(section.id).length).toBeGreaterThan(0)
  })
})
