/**
 * IoT-Lite strategy table: three fixed budgets, each with its own decision-label set.
 *
 * A strategy is a plan, not a suggestion: the label set and the node ceiling are what the
 * auxiliary answer is validated against, so a model that ignores them costs one call and keeps
 * the original reasoning. The numbers are the approved plan's, not tunables.
 */

/** The strategy one request runs under; `off` never reaches the model. */
export type IoTMode = 'off' | 'compact' | 'balanced' | 'full'

/** Every mode the auxiliary-thinking setting accepts, in display order. */
export const IOT_MODES: readonly IoTMode[] = ['off', 'compact', 'balanced', 'full']

/** Optional global auxiliary-thinking model settings. */
export interface IoTRequestRoute {
  /** Auxiliary provider; empty or absent defaults to `deepseek-official`. */
  readonly provider?: string
  /** Auxiliary model; empty or absent follows the main model. */
  readonly model?: string
  /** Auxiliary effort; empty or absent defaults to `low`. */
  readonly reasoningEffort?: string
}

/** One opt-in main route, with an optional auxiliary override for that route. */
export interface IoTThinkingTarget {
  /** Main provider enabled for auxiliary thinking. */
  readonly provider: string
  /** Main model enabled for auxiliary thinking; empty means every model of the provider. */
  readonly model?: string
  /** Auxiliary provider for this target; empty uses the global default. */
  readonly rewriteProvider?: string
  /** Auxiliary model for this target; empty uses the global default or main model. */
  readonly rewriteModel?: string
  /** Auxiliary effort for this target; empty uses the global default or low. */
  readonly rewriteEffort?: string
}

/** Whether a main provider/model is enabled: deepseek-official by default, plus explicit targets. */
export function isIoTTargetEnabled(targets: readonly IoTThinkingTarget[], provider: string, model: string): boolean {
  if (provider === 'deepseek-official') return true
  return targets.some(target => target.provider === provider && (target.model === undefined || target.model === model))
}

/** Resolve the global defaults and the matching target's optional auxiliary override. */
export function resolveIoTRequestRoute(
  route: IoTRequestRoute,
  mainModel: string,
  target?: IoTThinkingTarget,
): { provider: string; model: string; reasoningEffort: string } {
  return {
    provider: target?.rewriteProvider?.trim() || route.provider?.trim() || 'deepseek-official',
    model: target?.rewriteModel?.trim() || route.model?.trim() || mainModel,
    reasoningEffort: target?.rewriteEffort?.trim() || route.reasoningEffort?.trim() || 'low',
  }
}

/**
 * Smallest reasoning block worth an auxiliary call.
 *
 * Below this the trace is already short: paying a second model call to shorten it cannot save
 * more context than it costs, so the block streams through untouched.
 */
export const IOT_MIN_CHARS = 400

/**
 * Largest reasoning block eligible for compaction, in characters.
 *
 * The cap bounds the auxiliary PROMPT, not the answer: a longer trace is passed through instead
 * of being sent, so one pathological block cannot turn a reasoning stream into a huge request.
 */
export const IOT_MAX_CHARS = 24_000

/** Sessions whose overrides and metrics may be retained at once (process-local). */
export const IOT_MAX_SESSIONS = 256

/** Deadline of one auxiliary compaction call, measured from dispatch. */
export const IOT_AUX_TIMEOUT_MS = 60_000

/** One resolved compaction budget. */
export interface IoTStrategy {
  /** Mode this budget belongs to. */
  readonly mode: Exclude<IoTMode, 'off'>
  /** Decision labels the auxiliary answer may use. */
  readonly labels: readonly string[]
  /** Node ceiling of one auxiliary answer. */
  readonly maxNodes: number
  /** Output-token ceiling of the auxiliary call. */
  readonly maxTokens: number
}

/** The three compaction budgets, keyed by mode. */
export const IOT_STRATEGIES: Readonly<Record<Exclude<IoTMode, 'off'>, IoTStrategy>> = {
  compact: { mode: 'compact', labels: ['goal', 'decision', 'open'], maxNodes: 5, maxTokens: 800 },
  balanced: { mode: 'balanced', labels: ['goal', 'decision', 'rejected', 'risk', 'open'], maxNodes: 6, maxTokens: 1200 },
  full: {
    mode: 'full',
    labels: ['goal', 'constraint', 'decision', 'rejected', 'evidence', 'risk', 'open', 'next'],
    maxNodes: 8,
    maxTokens: 1600,
  },
}

/**
 * Whether a raw command argument names a mode.
 * @param value - one lower-cased auxiliary-thinking mode word.
 * @returns whether it is a known mode.
 */
export function isIoTMode(value: string): value is IoTMode {
  return value === 'off' || value === 'compact' || value === 'balanced' || value === 'full'
}

/**
 * The budget of one mode.
 * @param mode - effective mode of a request.
 * @returns The strategy, or undefined when the mode is `off`.
 */
export function strategyFor(mode: IoTMode): IoTStrategy | undefined {
  return mode === 'off' ? undefined : IOT_STRATEGIES[mode]
}
