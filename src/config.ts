import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { CRITERIA_PRESET_IDS, type CriteriaPresetId } from './core.ts'

/** A configured rubric: a bundled task-class preset, or a markdown file. */
export type CriteriaPresetSelection = CriteriaPresetId | 'custom'

export const VERIFIER_SETTINGS_NAMESPACE = 'llm-verifier' as never

export type AutoVerifyMode = 'manual' | 'smart' | 'strict'

/**
 * When the P06 request-level selector may register an intent.
 *
 * `off` is the shipped default and the closed path. `recovery` is the original behaviour: one cycle
 * per task, and only once two consecutive verification runs have failed. `every-step` buys a
 * request-level selection for EVERY main-loop request, bounded per task by
 * {@link Config.maxProcessCyclesPerTask}.
 */
export type AutoProcessSelectionMode = 'off' | 'recovery' | 'every-step'

/** The three legal values, in the order the settings page renders them. */
export const AUTO_PROCESS_SELECTION_MODES: readonly AutoProcessSelectionMode[] = ['off', 'recovery', 'every-step']

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
export function normalizeAutoProcessSelection(value: unknown): AutoProcessSelectionMode | undefined {
  if (value === true) return 'recovery'
  if (value === false || value === undefined || value === null) return 'off'
  return typeof value === 'string' && (AUTO_PROCESS_SELECTION_MODES as readonly string[]).includes(value)
    ? value as AutoProcessSelectionMode
    : undefined
}

/**
 * The schemastery schema of a P06 mode: the three modes first, the legacy boolean last.
 *
 * The boolean member exists so the HOST can still resolve a section an older client saved — the
 * schema validates the stored user layer, and rejecting `true` there would make the whole namespace
 * unreadable. It is placed AFTER the strings so a raw `Schema.simplify` prefers the real modes, and
 * {@link normalizeAutoProcessSelection} projects whatever comes out onto the three legal values.
 */
export function autoProcessSelectionSchema(): z<AutoProcessSelectionMode | boolean, AutoProcessSelectionMode> {
  // The OUTER `.default('off')` is the one that matters: a transform swallows the inner default
  // (its own meta.default stays unset unless set explicitly), so without it an absent key would
  // resolve to undefined even though the union alone defaults correctly. The union has already
  // rejected everything outside the three modes and the boolean, so the callback's fallback is
  // unreachable — it exists only to keep the projection total.
  return z
    .transform(z.union([...AUTO_PROCESS_SELECTION_MODES, z.boolean()]).default('off'), (value: AutoProcessSelectionMode | boolean): AutoProcessSelectionMode => normalizeAutoProcessSelection(value) ?? 'off')
    .default('off') as unknown as z<AutoProcessSelectionMode | boolean, AutoProcessSelectionMode>
}

export interface JudgeConfig {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
  label?: string
}

export interface ResolvedJudge {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens: number
  label: string
}

export const MAX_EXTRA_JUDGES = 4

export interface Config {
  enabled?: boolean
  autoVerifyMode?: AutoVerifyMode
  autoVerifyThreshold?: number
  autoVerifyRepeats?: number
  /**
   * Scoring repeats for an automatic `track` route only.
   *
   * Progress scores on a model without token logprobs come from the explicit-tag
   * channel, i.e. ONE sampled letter per call, and one letter is worth 5.3% of the
   * A–T scale — adjacent bands are a couple of samples apart. Averaging repeats is
   * what the upstream `n_evaluations` does for exactly this reason, and a track call
   * is the cheapest kind (one prompt, no tournament), so it defaults to 3.
   */
  autoTrackRepeats?: number
  /**
   * Scoring repeats for the FINAL session acceptance only.
   *
   * Even rounds swap A/B positions, and the final acceptance is the one automatic
   * decision that gates turn completion, so it defaults to 2 even though the
   * intermediate routes stay at 1 repeat for cost.
   */
  autoVerifyFinalRepeats?: number
  autoVerifyMinToolCalls?: number
  autoVerifyMaxChars?: number
  autoVerifyMaxPerTask?: number
  autoVerifyMaxPerSession?: number
  autoRouteSemantic?: boolean
  autoRouteMinConfidence?: number
  autoRouteMaxCandidates?: number
  autoRouteMaxPerTask?: number
  autoRouteMaxPerSession?: number
  autoTrackCompletionThreshold?: number
  /**
   * P06 request-level selection over \`llm/stream\`: give a task an alternative next reply.
   *
   * Default OFF and never turned on automatically. Only smart mode enters the path, and a selection
   * is never an acceptance. The legacy boolean is still accepted (`true` → `recovery`).
   */
  autoProcessSelection?: AutoProcessSelectionMode | boolean
  /**
   * P06: cycles the \`every-step\` mode may buy within ONE task.
   *
   * Every-step buys a cycle for every main-loop request, so without a per-task ceiling a long task
   * would select on every step indefinitely. This allowance is INDEPENDENT of the routing quota
   * (\`autoRouteMaxPerTask\`) and of the final acceptance quota (\`autoVerifyMaxPerTask\`): the three
   * counters never share a value, so spending cycles can neither starve the final gate nor be
   * starved by it.
   */
  maxProcessCyclesPerTask?: number
  /**
   * P06: hand the alternative reply the failing-run evidence the cycle was triggered by.
   *
   * Default ON: without it the extra candidate is written from exactly the same information as the
   * reply the session already showed failing, so the comparison mostly measures sampling noise.
   * OFF is the control arm of the A/B comparison, not a supported end state.
   */
  autoProcessFailureContext?: boolean
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
  autoProcessAlternativeModel?: string
  /**
   * P06: how many candidates one process cycle compares, the original reply included.
   *
   * N=2 (the shipped default) judges one pair. N=3 or 4 runs the tournament over
   * [original, alternative 1, ...], which costs roughly five times the judge calls at N=3 — see
   * `estimateRoutedCalls` — and is therefore opt-in rather than the default.
   */
  autoProcessCandidates?: number
  autoRouteMaxItemChars?: number
  autoRouteMaxInputChars?: number
  autoMaxModelCallsPerTask?: number
  autoMaxModelCallsPerSession?: number
  /**
   * Persist a bounded snapshot (prompt + raw answer) of every verifier model call.
   *
   * Answers "why did the judge say that?" without replaying a session from its event
   * log; capped per call, per record and per invocation by `decisions.ts`.
   */
  captureDecisions?: boolean
  /**
   * Rubric the automatic gate (final acceptance, routed compare/select/track) scores with.
   *
   * Defaults to `coding` = the historical DEFAULT_CRITERIA, so an existing installation is
   * unaffected. Judging a research or ops task with the coding rubric measures the wrong thing.
   */
  criteriaPreset?: CriteriaPresetSelection
  /** Markdown rubric file, read when `criteriaPreset` is `custom`. See README for the format. */
  criteriaFile?: string
  autoVerifyTeamTasks?: boolean
  autoVerifyPlanMode?: boolean
  autoVerifySubagents?: boolean
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
  temperature?: number
  label?: string
  timeoutMs?: number
  maxConcurrency?: number
  maxRetries?: number
  retryBaseDelayMs?: number
  cacheDir?: string
  cacheMaxEntries?: number
  estimatedInputUsdPerMillion?: number
  estimatedOutputUsdPerMillion?: number
  /** USD per million prompt tokens served from cache; 0 falls back to the input rate. */
  estimatedCachedInputUsdPerMillion?: number
  /** Price a judge route from the installed pi-ai catalog when the operator typed no rate. */
  autoPriceFromCatalog?: boolean
  /** Consult the models.dev snapshot when the installed catalog has no price for the route. */
  autoPriceOnline?: boolean
  /** Provider id whose list price to follow for a route neither price table knows. */
  priceProviderOverride?: string
  extraJudges?: JudgeConfig[]
}

export interface ResolvedConfig {
  enabled: boolean
  autoVerifyMode: AutoVerifyMode
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
  autoProcessSelection: AutoProcessSelectionMode
  maxProcessCyclesPerTask: number
  autoProcessFailureContext: boolean
  autoProcessAlternativeModel: string
  autoProcessCandidates: number
  autoRouteMaxItemChars: number
  autoRouteMaxInputChars: number
  autoMaxModelCallsPerTask: number
  autoMaxModelCallsPerSession: number
  captureDecisions: boolean
  criteriaPreset: CriteriaPresetSelection
  criteriaFile: string
  autoVerifyTeamTasks: boolean
  autoVerifyPlanMode: boolean
  autoVerifySubagents: boolean
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens: number
  temperature: number
  timeoutMs: number
  maxConcurrency: number
  maxRetries: number
  retryBaseDelayMs: number
  cacheDir: string
  cacheMaxEntries: number
  estimatedInputUsdPerMillion: number
  estimatedOutputUsdPerMillion: number
  estimatedCachedInputUsdPerMillion: number
  autoPriceFromCatalog: boolean
  autoPriceOnline: boolean
  priceProviderOverride: string
  judges: ResolvedJudge[]
}

export const JudgeConfig: z<JudgeConfig> = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  maxTokens: z.number().step(1).min(1),
  label: z.string(),
})

export const Config: z<Config> = z.object({
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
  criteriaPreset: z.union([...CRITERIA_PRESET_IDS, 'custom'] as const).default('coding'),
  criteriaFile: z.string().default(''),
  autoVerifyTeamTasks: z.boolean().default(true),
  autoVerifyPlanMode: z.boolean().default(true),
  autoVerifySubagents: z.boolean().default(false),
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
})

function resolveJudgeLabel(
  rawLabel: string | undefined,
  provider: string,
  model: string,
  takenLabels: Set<string>,
): string {
  const initial = rawLabel?.trim() || model
  if (!takenLabels.has(initial)) {
    takenLabels.add(initial)
    return initial
  }
  const fallback = `${provider}/${model}`
  if (!takenLabels.has(fallback)) {
    takenLabels.add(fallback)
    return fallback
  }
  let index = 2
  while (takenLabels.has(`${fallback}#${index}`)) {
    index++
  }
  const resolved = `${fallback}#${index}`
  takenLabels.add(resolved)
  return resolved
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const provider = (config.provider ?? 'deepseek-official').trim()
  const model = (config.model ?? 'deepseek-flash').trim()
  if (!provider) throw new Error('llm-verifier: provider must be non-empty')
  if (!model) throw new Error('llm-verifier: model must be non-empty')
  const autoVerifyMode = config.autoVerifyMode ?? 'smart'
  if (!['manual', 'smart', 'strict'].includes(autoVerifyMode)) throw new Error('llm-verifier: autoVerifyMode must be manual, smart, or strict')
  const autoVerifyThreshold = config.autoVerifyThreshold ?? 0.65
  if (!Number.isFinite(autoVerifyThreshold) || autoVerifyThreshold < 0 || autoVerifyThreshold > 1) throw new Error('llm-verifier: autoVerifyThreshold must be between 0 and 1')
  const temperature = config.temperature ?? 0.2
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('llm-verifier: temperature must be between 0 and 2')
  // P06's candidate count. The upper bound is a spend ceiling, not a technical one: at N=4 the
  // tournament is 6 pairs under the shipped criteria, which is already a third of the task budget.
  const processCandidates = config.autoProcessCandidates ?? 2
  if (!Number.isSafeInteger(processCandidates) || processCandidates < 2 || processCandidates > 4) {
    throw new Error('llm-verifier: autoProcessCandidates must be an integer between 2 and 4')
  }
  // The alternative-model pool: a comma-separated list of complete routes. Each entry is validated
  // on its own (a half-specified route would silently fall back to the session model while the row
  // claimed a second model was used), blank entries are dropped, and the normalized list is stored
  // back as the comma-joined string the statistics row reports.
  const alternativeModelParts = (config.autoProcessAlternativeModel ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
  for (const entry of alternativeModelParts) {
    if (!/^[^\s/]+\/[^\s]+$/u.test(entry)) {
      throw new Error('llm-verifier: autoProcessAlternativeModel entry "' + entry + '" must be "provider/model"')
    }
  }
  const alternativeModel = alternativeModelParts.join(',')
  // P06's trigger mode. The legacy boolean is normalized (true -> recovery) and anything else that is
  // neither a mode nor a boolean fails closed, so a typo cannot silently select a more expensive arm.
  const processSelection = normalizeAutoProcessSelection(config.autoProcessSelection)
  if (processSelection === undefined) {
    throw new Error('llm-verifier: autoProcessSelection must be off, recovery, or every-step')
  }
  // The every-step per-task allowance. The upper bound is a spend ceiling, not a technical one: each
  // cycle is a whole extra generation plus a judged pair.
  const maxProcessCyclesPerTask = config.maxProcessCyclesPerTask ?? 4
  if (!Number.isSafeInteger(maxProcessCyclesPerTask) || maxProcessCyclesPerTask < 1 || maxProcessCyclesPerTask > 32) {
    throw new Error('llm-verifier: maxProcessCyclesPerTask must be an integer between 1 and 32')
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
  }
  for (const [name, value] of Object.entries(values)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('llm-verifier: ' + name + ' must be a positive safe integer')
  if (values.autoVerifyMaxChars < 1000) throw new Error('llm-verifier: autoVerifyMaxChars must be at least 1000')
  if (values.autoRouteMaxCandidates < 3 || values.autoRouteMaxCandidates > 16) throw new Error('llm-verifier: autoRouteMaxCandidates must be between 3 and 16')
  if (values.autoRouteMaxInputChars < values.autoRouteMaxItemChars * 2) throw new Error('llm-verifier: autoRouteMaxInputChars must fit at least two route items')
  const autoRouteMinConfidence = config.autoRouteMinConfidence ?? 0.9
  const autoTrackCompletionThreshold = config.autoTrackCompletionThreshold ?? 0.684
  if (![autoRouteMinConfidence, autoTrackCompletionThreshold].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('llm-verifier: auto route thresholds must be between 0 and 1')
  const maxRetries = config.maxRetries ?? 3
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error('llm-verifier: maxRetries must be a non-negative safe integer')
  const cacheDir = (config.cacheDir ?? 'verifier').trim()
  if (!cacheDir) throw new Error('llm-verifier: cacheDir must be non-empty')
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(cacheDir)) throw new Error('llm-verifier: cacheDir must be relative to the topic directory')
  if (cacheDir.split(/[\\/]+/u).includes('..')) throw new Error('llm-verifier: cacheDir must stay inside the topic directory')
  const estimatedInputUsdPerMillion = config.estimatedInputUsdPerMillion ?? 0
  const estimatedOutputUsdPerMillion = config.estimatedOutputUsdPerMillion ?? 0
  const estimatedCachedInputUsdPerMillion = config.estimatedCachedInputUsdPerMillion ?? 0
  if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion, estimatedCachedInputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0)) throw new Error('llm-verifier: estimated token prices must be finite non-negative numbers')
  // A reseller route has no price in either table; the override names the provider whose list
  // price the operator chose to follow. Empty (the default) means "never guess across providers".
  const priceProviderOverride = (config.priceProviderOverride ?? '').trim()
  const criteriaPreset = config.criteriaPreset ?? 'coding'
  if (criteriaPreset !== 'custom' && !CRITERIA_PRESET_IDS.includes(criteriaPreset as CriteriaPresetId)) throw new Error('llm-verifier: criteriaPreset must be one of ' + [...CRITERIA_PRESET_IDS, 'custom'].join(', '))
  // A half-configured custom rubric is NOT a config error: CriteriaResolver falls back to the
  // coding preset and reports why, so a typo in a rubric path cannot disable the gate.
  const criteriaFile = (config.criteriaFile ?? '').trim()
  const reasoningEffort = config.reasoningEffort?.trim()

  const extraJudges = config.extraJudges ?? []
  if (!Array.isArray(extraJudges)) throw new Error('llm-verifier: extraJudges must be an array')
  if (extraJudges.length > MAX_EXTRA_JUDGES) {
    throw new Error(`llm-verifier: extraJudges cannot exceed ${MAX_EXTRA_JUDGES}`)
  }

  const seenJudges = new Set<string>([`${provider}\u0000${model}`])
  const takenLabels = new Set<string>()
  const primaryLabel = resolveJudgeLabel(config.label, provider, model, takenLabels)

  const primaryJudge: ResolvedJudge = {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    maxTokens: values.maxTokens,
    label: primaryLabel,
  }

  const judges: ResolvedJudge[] = [primaryJudge]

  for (let i = 0; i < extraJudges.length; i++) {
    const extra = extraJudges[i]
    if (!extra || typeof extra !== 'object') {
      throw new Error(`llm-verifier: extraJudges[${i}] must be an object`)
    }
    const extraProvider = (extra.provider ?? '').trim()
    if (!extraProvider) {
      throw new Error(`llm-verifier: extraJudges[${i}].provider must be non-empty`)
    }
    const extraModel = (extra.model ?? '').trim()
    if (!extraModel) {
      throw new Error(`llm-verifier: extraJudges[${i}].model must be non-empty`)
    }

    const identityKey = `${extraProvider}\u0000${extraModel}`
    if (seenJudges.has(identityKey)) {
      throw new Error(`llm-verifier: duplicate judge: ${extraProvider}/${extraModel}`)
    }
    seenJudges.add(identityKey)

    let extraMaxTokens = values.maxTokens
    if (extra.maxTokens !== undefined) {
      if (typeof extra.maxTokens !== 'number' || !Number.isSafeInteger(extra.maxTokens) || extra.maxTokens <= 0) {
        throw new Error(`llm-verifier: extraJudges[${i}].maxTokens must be a positive safe integer`)
      }
      extraMaxTokens = extra.maxTokens
    }

    // Do NOT inherit the primary judge's reasoning effort; an empty or absent effort
    // allows the adapter to use the judge model's own default.
    const extraEffort = extra.reasoningEffort?.trim()
    const extraLabel = resolveJudgeLabel(extra.label, extraProvider, extraModel, takenLabels)

    judges.push({
      provider: extraProvider,
      model: extraModel,
      ...(extraEffort ? { reasoningEffort: extraEffort } : {}),
      maxTokens: extraMaxTokens,
      label: extraLabel,
    })
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
  }
}

export function installVerifierSettings(ctx: Context, entry: ResolvedConfig, onChange: () => void): () => ResolvedConfig {
  let source = () => entry
  const ns = VERIFIER_SETTINGS_NAMESPACE
  ctx.inject(['settings'], (sctx: Context & { settings?: any }) => {
    if (!sctx.settings) return
    if (typeof sctx.settings.installSection === 'function') {
      sctx.settings.installSection(ctx, ns, Config as z<ResolvedConfig>, entry, {
        setSource(current: () => ResolvedConfig) { source = current },
        onChange,
        validate(value: ResolvedConfig) { resolveConfig(value) },
      })
    } else if (typeof sctx.settings.register === 'function') {
      const scope = sctx.settings.register(ns, Config as z<ResolvedConfig>, {
        base: entry,
        validate: (value: ResolvedConfig) => { resolveConfig(value) },
      })
      source = () => scope.get()
      sctx.effect(() => () => {
        source = () => entry
        onChange()
      })
      onChange()
      scope.watch(() => {
        onChange()
      })
    }
  })
  return () => resolveConfig(source())
}
