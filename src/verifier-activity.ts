/**
 * In-memory view of the verifier's in-flight cycles, for the chat chip.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every automatic stage runs judge calls while the chat shows nothing about it. Two of them are
 * silent windows rather than "no output at all":
 *
 * - P06 buffers the main reply, so while a cycle runs there is no streaming text whatsoever —
 *   indistinguishable from a hang;
 * - the routed reviews (compare/select/track) and the final acceptance run inside
 *   `agent/turn-stopping`, where the reply is already on screen but the turn stays open for as long
 *   as the judges take (a bounded but real pause, and a passing acceptance says nothing at all).
 *
 * The harness renders the host's own inline indicator ("Compacting context…") from a *session event*
 * pair, and that route is closed to an out-of-repo plugin: the persistence read path
 * (`validateStoredEvents` in `@deepseek-ai/dsh-session-persistence`) refuses to interpret a log
 * containing an event type outside the repository-generated `KNOWN_SESSION_EVENT_TYPES` unless the
 * stored envelope carries `ignorable: true`, and `Session.append` cannot set that marker — only a
 * seed/restore envelope can. Appending our own type would therefore make the topic unloadable.
 *
 * So the indicator is deliberately host-only state: the router (the one place that knows a cycle was
 * granted) and the P06 selector publish what they are doing here, the plugin's existing RPC answers
 * a read of it, and the client polls that read only while a turn runs. Nothing here is durable (a
 * reload shows nothing, which is correct: the cycle it described is gone) and nothing here touches
 * the model history, the session log, the statistics or any verdict.
 *
 * Pure bookkeeping: no I/O, no clock of its own (callers pass `now`), so it is directly testable.
 */
import type { Reservation, RouterCycleObserver, RoutedAgent } from './router.ts'

/** Which part of the plugin owns a cycle. */
export type ActivityStage = 'process' | 'route' | 'final'

/** What a cycle is doing right now, as far as the UI can tell it apart. */
export type ActivityPhase = 'generating' | 'comparing' | 'classifying' | 'reviewing' | 'accepting'

/** The routed decision a `route` cycle resolved to, once classification promoted it. */
export type ActivityDestination = 'compare' | 'select' | 'track'

/** How a finished cycle resolved, from the user's point of view. */
export type ActivityOutcome = 'replaced' | 'kept' | 'same' | 'failed' | 'accepted' | 'rejected'

/** One cycle in flight. */
export interface ActivityActive {
  cycleId: string
  stage: ActivityStage
  phase: ActivityPhase
  /** Routing target of a `route` cycle; absent while it is still classifying and for the others. */
  destination?: ActivityDestination
  /** Candidates in the P06 cycle, the original reply included (2..4). */
  candidates?: number
  /** Model calls this cycle reserved, for the copy that quotes a size. */
  expectedCalls?: number
  /** `provider/model` of P06's second generator, when `autoProcessAlternativeModel` is set. */
  alternativeModel?: string
  startedAt: number
}

/** One cycle that just finished; kept only long enough for the chip to explain the pause. */
export interface ActivitySettled {
  cycleId: string
  stage: ActivityStage
  outcome: ActivityOutcome
  candidates?: number
  /** Wall clock the cycle settled at. */
  at: number
}

/** What one session currently has to show. Both fields absent means "nothing to say". */
export interface ActivityView {
  active?: ActivityActive
  settled?: ActivitySettled
}

/**
 * How long a settled cycle keeps explaining itself.
 *
 * Long enough to be read after the reply lands (the chat scrolls as soon as the winner replays),
 * short enough that a stale line never becomes part of the transcript.
 */
export const ACTIVITY_SETTLED_TTL_MS = 20_000

/**
 * Safety bound on an in-flight record.
 *
 * Every cycle is bounded by the configured phase timeout and settles on every path we know of, so
 * this only ever fires for a cycle that leaked (a bug, or a host that never calls back). Without it
 * a leaked record would pin the chip in "working…" forever, because the client keeps polling while
 * it has something to render.
 */
export const ACTIVITY_ACTIVE_TTL_MS = 600_000

/**
 * Map one finished P06 cycle onto the outcome the chip distinguishes.
 *
 * `replayed` is the host-facing fact ("which stream did the host actually receive") and wins over
 * the outcome label: a cycle recorded as `candidate-selected` whose winner was withheld before the
 * first chunk is corrected to `replayed: 'original'` and must read as "kept", not as a replacement.
 * @param outcome - the durable outcome string the cycle was recorded with.
 * @param replayed - which stream the host actually received.
 * @returns The chip-level outcome.
 */
export function classifyProcessOutcome(
  outcome: string,
  replayed: 'original' | 'candidate' | 'none',
): ActivityOutcome {
  if (replayed === 'candidate') return 'replaced'
  if (outcome === 'identical-candidate') return 'same'
  if (outcome === 'tie' || outcome === 'original-selected') return 'kept'
  if (outcome.startsWith('candidate-not-delivered')) return 'kept'
  return 'failed'
}

/**
 * Map one granted reservation onto the chip's active record.
 *
 * `process` is deliberately NOT mapped: P06 publishes its own richer record (candidate count,
 * generation vs comparison), and two writers for one cycle id would race. `plan_review` and
 * `team_task` are not announced either — the plan gate already shows a pending tool row in the
 * chat, so a chip line would only repeat it.
 * @param reservation - the reservation the router just granted.
 * @param startedAt - wall clock the cycle began at.
 * @returns The active record, or undefined for a phase the chip stays silent about.
 */
export function reservationActivity(
  reservation: Pick<Reservation, 'id' | 'phase' | 'expectedCalls'>,
  startedAt: number,
): ActivityActive | undefined {
  switch (reservation.phase) {
    case 'semantic':
      return { cycleId: reservation.id, stage: 'route', phase: 'classifying', expectedCalls: reservation.expectedCalls, startedAt }
    case 'compare':
    case 'select':
    case 'track':
      return { cycleId: reservation.id, stage: 'route', phase: 'reviewing', destination: reservation.phase, expectedCalls: reservation.expectedCalls, startedAt }
    case 'final':
      return { cycleId: reservation.id, stage: 'final', phase: 'accepting', expectedCalls: reservation.expectedCalls, startedAt }
    default:
      return undefined
  }
}

/**
 * Map a promotion onto the update the chip needs.
 *
 * A classification cycle that resolved to a decision stays the SAME reservation (that is what
 * promotion is for), so the chip must be moved from "classifying" to "reviewing" instead of leaving
 * a second cycle behind.
 * @param reservation - the promoted reservation, already carrying its execution phase.
 * @returns The patch, or undefined when the phase is not one the chip announces.
 */
export function reservationPromotion(
  reservation: Pick<Reservation, 'phase' | 'expectedCalls'>,
): Pick<ActivityActive, 'phase' | 'expectedCalls'> & { destination?: ActivityDestination } | undefined {
  switch (reservation.phase) {
    case 'compare':
    case 'select':
    case 'track':
      return { phase: 'reviewing', destination: reservation.phase, expectedCalls: reservation.expectedCalls }
    default:
      return undefined
  }
}

/**
 * Map a router settlement onto the chip's settled row.
 *
 * A routed verdict is steered into the chat by the caller right after the cycle settles, so a second
 * transient line would only repeat it; the final gate is the opposite (a PASSING acceptance steers
 * nothing), and that is exactly the case worth showing. `undefined` means "clear the active row and
 * leave nothing behind".
 * @param reservation - the reservation being settled.
 * @param outcome - whether the router committed or failed it.
 * @returns The stage and outcome to keep, or undefined to clear silently.
 */
export function reservationSettled(
  reservation: Pick<Reservation, 'id' | 'phase'>,
  outcome: 'committed' | 'failed',
): { stage: ActivityStage; outcome: ActivityOutcome } | undefined {
  return reservation.phase === 'final'
    ? { stage: 'final', outcome: outcome === 'committed' ? 'accepted' : 'rejected' }
    : undefined
}

/**
 * Build the router's advisory observer over one activity table.
 *
 * The router supplies the reservation (it is the only component that knows a cycle was granted and
 * when it settled); this module owns what the chip says about it.
 * @param activities - the table the plugin's RPC reads.
 * @param now - wall clock used for the records and their TTLs.
 * @returns The observer to hand to `new AutoVerifierRouter(...)`.
 */
export function createActivityObserver(
  activities: VerifierActivities,
  now: () => number = Date.now,
): RouterCycleObserver {
  const key = (agent: RoutedAgent): string => String(agent.id)
  return {
    begin: (agent, reservation) => {
      const activity = reservationActivity(reservation, now())
      if (activity !== undefined) activities.begin(key(agent), activity)
    },
    promoted: (agent, reservation) => {
      const patch = reservationPromotion(reservation)
      if (patch !== undefined) activities.update(key(agent), reservation.id, patch)
    },
    settled: (agent, reservation, outcome) => {
      const settled = reservationSettled(reservation, outcome)
      activities.finish(key(agent), reservation.id, settled?.outcome, now())
    },
  }
}

/**
 * Per-session activity table.
 *
 * One active cycle per session, because the router owns one in-flight reservation per agent at a
 * time; a settled cycle replaces the previous settled one (the chip is a status line, not a history
 * — the statistics sidecar is the history).
 */
export class VerifierActivities {
  private readonly active = new Map<string, ActivityActive>()
  private readonly settled = new Map<string, ActivitySettled>()

  /** Publish one cycle as in flight. */
  begin(sessionId: string, activity: ActivityActive): void {
    this.active.set(sessionId, activity)
  }

  /**
   * Move one in-flight cycle to a later phase.
   *
   * Guarded by cycle id: a cycle that already settled (or was replaced by a newer one) must not be
   * moved back into "in flight" by a late async step.
   * @returns whether the exact cycle was the active one.
   */
  update(
    sessionId: string,
    cycleId: string,
    patch: Partial<Pick<ActivityActive, 'phase' | 'destination' | 'candidates' | 'expectedCalls'>>,
  ): boolean {
    const current = this.active.get(sessionId)
    if (current === undefined || current.cycleId !== cycleId) return false
    this.active.set(sessionId, { ...current, ...patch })
    return true
  }

  /**
   * Retire one cycle.
   *
   * A cycle nobody observed (the purchase itself failed, so `begin` never ran) leaves nothing
   * behind: the chip must not claim a cycle that never started. A cycle that WAS observed stays
   * correctable while its own settled record is the current one, which is what P06's late
   * "the winner was not delivered" correction needs.
   * @param sessionId - the session the cycle belongs to.
   * @param cycleId - the cycle to retire.
   * @param outcome - the settled row to keep, or undefined to clear without leaving one.
   * @param now - wall clock used for the settled record.
   * @returns whether the cycle was known and retired.
   */
  finish(
    sessionId: string,
    cycleId: string,
    outcome: ActivityOutcome | undefined,
    now: number,
  ): boolean {
    const active = this.active.get(sessionId)
    const settled = this.settled.get(sessionId)
    const known = active?.cycleId === cycleId
      ? active
      : settled?.cycleId === cycleId
        ? settled
        : undefined
    if (known === undefined) return false
    if (active?.cycleId === cycleId) this.active.delete(sessionId)
    if (outcome === undefined) {
      if (settled?.cycleId === cycleId) this.settled.delete(sessionId)
      return true
    }
    this.settled.set(sessionId, {
      cycleId,
      stage: known.stage,
      outcome,
      ...(known.candidates === undefined ? {} : { candidates: known.candidates }),
      at: now,
    })
    return true
  }

  /**
   * What one session has to show right now, with expired records pruned in place.
   * @param sessionId - the session to read.
   * @param now - wall clock used for both TTLs.
   */
  read(sessionId: string, now: number): ActivityView {
    const active = this.active.get(sessionId)
    if (active !== undefined && now - active.startedAt >= ACTIVITY_ACTIVE_TTL_MS) this.active.delete(sessionId)
    const settled = this.settled.get(sessionId)
    if (settled !== undefined && now - settled.at >= ACTIVITY_SETTLED_TTL_MS) this.settled.delete(sessionId)
    const currentActive = this.active.get(sessionId)
    const currentSettled = this.settled.get(sessionId)
    return {
      ...(currentActive === undefined ? {} : { active: currentActive }),
      ...(currentSettled === undefined ? {} : { settled: currentSettled }),
    }
  }

  /** Forget one session entirely (settings changed, task replaced, agent disposed). */
  clear(sessionId: string): void {
    this.active.delete(sessionId)
    this.settled.delete(sessionId)
  }

  /** Forget every session (settings change, shutdown). */
  clearAll(): void {
    this.active.clear()
    this.settled.clear()
  }
}
