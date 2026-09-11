import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'

export const VERIFIER_SETTINGS_NAMESPACE = 'llm-verifier' as never

export type AutoVerifyMode = 'manual' | 'smart' | 'strict'

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
  autoRouteMaxItemChars?: number
  autoRouteMaxInputChars?: number
  autoMaxModelCallsPerTask?: number
  autoMaxModelCallsPerSession?: number
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
  extraJudges?: JudgeConfig[]
}

export interface ResolvedConfig {
  enabled: boolean
  autoVerifyMode: AutoVerifyMode
  autoVerifyThreshold: number
  autoVerifyRepeats: number
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
  autoTrackCompletionThreshold: z.number().min(0).max(1).default(0.8),
  autoRouteMaxItemChars: z.number().step(1).min(100).default(20000),
  autoRouteMaxInputChars: z.number().step(1).min(1000).default(60000),
  autoMaxModelCallsPerTask: z.number().step(1).min(1).default(96),
  autoMaxModelCallsPerSession: z.number().step(1).min(1).default(240),
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
  const values = {
    autoVerifyRepeats: config.autoVerifyRepeats ?? 1,
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
  const autoTrackCompletionThreshold = config.autoTrackCompletionThreshold ?? 0.8
  if (![autoRouteMinConfidence, autoTrackCompletionThreshold].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('llm-verifier: auto route thresholds must be between 0 and 1')
  const maxRetries = config.maxRetries ?? 3
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error('llm-verifier: maxRetries must be a non-negative safe integer')
  const cacheDir = (config.cacheDir ?? 'verifier').trim()
  if (!cacheDir) throw new Error('llm-verifier: cacheDir must be non-empty')
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(cacheDir)) throw new Error('llm-verifier: cacheDir must be relative to the topic directory')
  if (cacheDir.split(/[\\/]+/u).includes('..')) throw new Error('llm-verifier: cacheDir must stay inside the topic directory')
  const estimatedInputUsdPerMillion = config.estimatedInputUsdPerMillion ?? 0
  const estimatedOutputUsdPerMillion = config.estimatedOutputUsdPerMillion ?? 0
  if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion].every(value => Number.isFinite(value) && value >= 0)) throw new Error('llm-verifier: estimated token prices must be finite non-negative numbers')
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
