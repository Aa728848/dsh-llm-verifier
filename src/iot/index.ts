/**
 * Auxiliary thinking for DeepSeek: compact finished reasoning blocks through one auxiliary call each.
 * The host wires {@link IoTController} onto llm/stream and session disposal.
 */
export { IoTController } from './controller.ts'
export type { IoTDeps, IoTSettings } from './controller.ts'
export {
  IOT_AUX_TIMEOUT_MS, IOT_MAX_CHARS, IOT_MAX_SESSIONS, IOT_MIN_CHARS, IOT_MODES, IOT_STRATEGIES,
  isIoTMode, isIoTTargetEnabled, resolveIoTRequestRoute, strategyFor,
} from './mode.ts'
export type { IoTMode, IoTRequestRoute, IoTStrategy, IoTThinkingTarget } from './mode.ts'
export { IOT_PROMPT_MARKER, IOT_TRACE_TAG, buildCompactionPrompt, iotTraceDelimiters, iotTraceToken } from './prompt.ts'
export { assessCompaction } from './compaction.ts'
export type { CompactionAssessment, CompactionNode, CompactionRejection } from './compaction.ts'
export { IoTSessions, copyMetrics, emptySessionMetrics } from './metrics.ts'
export type { SessionIoTMetrics, TokenCounts } from './metrics.ts'
