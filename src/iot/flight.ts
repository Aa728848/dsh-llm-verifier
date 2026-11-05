/**
 * Which sessions are holding a reasoning block back right now.
 *
 * The bypass's only visible surface is the chat activity chip (D15), and the chip needs exactly one
 * fact from it: is a block being held? Pure in-memory bookkeeping — no I/O, no clock of its own,
 * nothing durable. A held record is NOT durable state: it mirrors one `compacting()` call.
 */
import { IOT_MAX_SESSIONS } from './mode.ts'

/**
 * How long a held record may outlive its block before it is treated as a leak.
 *
 * Every hold is released on every path the bypass knows about, and the auxiliary call itself is
 * bounded by IOT_AUX_TIMEOUT_MS. This only fires for a record that leaked (a bug, or a stream the
 * host abandoned without finishing), and it matters because the chip keeps polling while it has
 * something to render — a pinned record would poll forever.
 */
export const IOT_THINKING_TTL_MS = 300_000

/** Bounded per-session table of held blocks, evicting least-recently-started sessions first. */
export class IoTFlights {
  private readonly order = new Map<string, number>()

  /**
   * @param limit - maximum sessions retained; the same bound the counters use.
   */
  constructor(private readonly limit: number = IOT_MAX_SESSIONS) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('llm-iot: the flight limit must be a positive integer')
  }

  /** Sessions currently held. */
  get size(): number { return this.order.size }

  /**
   * Record the first held block of one session.
   *
   * Called only on the transition from "nothing held" to "something held", so re-entering here for
   * an already-held session means the caller lost track; refreshing the timestamp is then the least
   * surprising recovery.
   * @param sessionId - session whose block is now held.
   * @param now - wall clock the hold began at.
   */
  begin(sessionId: string, now: number): void {
    this.order.delete(sessionId)
    this.order.set(sessionId, now)
    while (this.order.size > this.limit) {
      const oldest = this.order.keys().next().value
      if (oldest === undefined) return
      this.order.delete(oldest)
    }
  }

  /**
   * Drop one session's hold. Idempotent: every release path calls it unconditionally.
   * @param sessionId - session whose hold ended.
   */
  end(sessionId: string): void { this.order.delete(sessionId) }

  /**
   * When one session started holding a block, if it still is.
   * @param sessionId - session to read.
   * @param now - wall clock used for the leak bound.
   * @returns The hold start, or undefined when nothing is held (or the record leaked).
   */
  held(sessionId: string, now: number): number | undefined {
    const startedAt = this.order.get(sessionId)
    if (startedAt === undefined) return undefined
    if (now - startedAt > IOT_THINKING_TTL_MS) {
      this.order.delete(sessionId)
      return undefined
    }
    return startedAt
  }

  /**
   * Forget one session entirely (session disposal).
   * @param sessionId - session to forget.
   */
  clear(sessionId: string): void { this.order.delete(sessionId) }
}
