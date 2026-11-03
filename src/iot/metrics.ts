/**
 * Process-local auxiliary-thinking counters, bounded per session.
 * Nothing here is durable: the plugin rebuilds this from live settings. Session overrides do not
 * exist, so there is no hidden command state that could outlive the global configuration.
 */
import { IOT_MAX_SESSIONS, type IoTMode } from './mode.ts'

/** Disjoint token counters of one side of the feature (cacheRead is the provider cache-hit count). */
export interface TokenCounts {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
}

/** What one session has seen since it was last cleared. */
export interface SessionIoTMetrics {
  /** Strategy the session last ran under. */
  mode: IoTMode
  /** Tokens of the MAIN requests; the usage chunks are relayed unaltered. */
  main: TokenCounts
  /** Tokens spent on auxiliary calls, which are never part of the main stream. */
  auxiliary: TokenCounts & { calls: number }
  /** Blocks replaced by an accepted compaction. */
  replacements: number
  /** Blocks relayed unchanged (skipped or refused). */
  kept: number
  /** Auxiliary calls that produced no acceptable replacement. */
  failures: number
  /** Blocks that never needed a call (empty, below the minimum, or over the cap). */
  skips: number
  /** Reasoning characters received (original) and actually emitted (emitted). */
  chars: { original: number; emitted: number }
}

/** Fresh counters for one session. */
export function emptySessionMetrics(mode: IoTMode): SessionIoTMetrics {
  return {
    mode,
    main: { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    auxiliary: { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    replacements: 0,
    kept: 0,
    failures: 0,
    skips: 0,
    chars: { original: 0, emitted: 0 },
  }
}

/** Detached copy of one session's counters. */
export function copyMetrics(source: SessionIoTMetrics): SessionIoTMetrics {
  return {
    mode: source.mode,
    main: { ...source.main },
    auxiliary: { ...source.auxiliary },
    replacements: source.replacements,
    kept: source.kept,
    failures: source.failures,
    skips: source.skips,
    chars: { ...source.chars },
  }
}

/** Bounded per-session table, evicting least-recently-used counters first. */
export class IoTSessions {
  private readonly order = new Map<string, true>()
  private readonly counters = new Map<string, SessionIoTMetrics>()

  constructor(private readonly limit: number = IOT_MAX_SESSIONS) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('llm-iot: the session limit must be a positive integer')
  }

  /** Sessions currently retained. */
  get size(): number { return this.order.size }

  /** Live counters of one session, created on first use. */
  metricsFor(sessionId: string, mode: IoTMode): SessionIoTMetrics {
    this.touch(sessionId)
    let metrics = this.counters.get(sessionId)
    if (metrics === undefined) {
      metrics = emptySessionMetrics(mode)
      this.counters.set(sessionId, metrics)
    }
    metrics.mode = mode
    return metrics
  }

  /** Detached counters of one session. */
  metrics(sessionId: string): SessionIoTMetrics | undefined {
    this.refresh(sessionId)
    const metrics = this.counters.get(sessionId)
    return metrics === undefined ? undefined : copyMetrics(metrics)
  }

  /** Forget one session's counters. */
  clear(sessionId: string): void {
    this.order.delete(sessionId)
    this.counters.delete(sessionId)
  }

  /** Promote an already-retained session; reading an unknown id must not resurrect it. */
  private refresh(sessionId: string): void {
    if (!this.order.has(sessionId)) return
    this.order.delete(sessionId)
    this.order.set(sessionId, true)
  }

  /** Mark one session as retained and evict the oldest activity past the cap. */
  private touch(sessionId: string): void {
    this.order.delete(sessionId)
    this.order.set(sessionId, true)
    while (this.order.size > this.limit) {
      const oldest = this.order.keys().next().value
      if (oldest === undefined) return
      this.order.delete(oldest)
      this.counters.delete(oldest)
    }
  }
}
