/**
 * How long a settled cycle keeps explaining itself.
 *
 * Long enough to be read after the reply lands (the chat scrolls as soon as the winner replays),
 * short enough that a stale line never becomes part of the transcript.
 */
export const ACTIVITY_SETTLED_TTL_MS = 20_000;
/**
 * Safety bound on an in-flight record.
 *
 * Every cycle is bounded by the configured phase timeout and settles on every path we know of, so
 * this only ever fires for a cycle that leaked (a bug, or a host that never calls back). Without it
 * a leaked record would pin the chip in "working…" forever, because the client keeps polling while
 * it has something to render.
 */
export const ACTIVITY_ACTIVE_TTL_MS = 600_000;
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
export function classifyProcessOutcome(outcome, replayed) {
    if (replayed === 'candidate')
        return 'replaced';
    if (outcome === 'identical-candidate')
        return 'same';
    if (outcome === 'tie' || outcome === 'original-selected')
        return 'kept';
    if (outcome.startsWith('candidate-not-delivered'))
        return 'kept';
    return 'failed';
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
export function reservationActivity(reservation, startedAt) {
    switch (reservation.phase) {
        case 'semantic':
            return { cycleId: reservation.id, stage: 'route', phase: 'classifying', expectedCalls: reservation.expectedCalls, startedAt };
        case 'compare':
        case 'select':
        case 'track':
            return { cycleId: reservation.id, stage: 'route', phase: 'reviewing', destination: reservation.phase, expectedCalls: reservation.expectedCalls, startedAt };
        case 'final':
            return { cycleId: reservation.id, stage: 'final', phase: 'accepting', expectedCalls: reservation.expectedCalls, startedAt };
        default:
            return undefined;
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
export function reservationPromotion(reservation) {
    switch (reservation.phase) {
        case 'compare':
        case 'select':
        case 'track':
            return { phase: 'reviewing', destination: reservation.phase, expectedCalls: reservation.expectedCalls };
        default:
            return undefined;
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
export function reservationSettled(reservation, outcome) {
    return reservation.phase === 'final'
        ? { stage: 'final', outcome: outcome === 'committed' ? 'accepted' : 'rejected' }
        : undefined;
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
export function createActivityObserver(activities, now = Date.now) {
    const key = (agent) => String(agent.id);
    return {
        begin: (agent, reservation) => {
            const activity = reservationActivity(reservation, now());
            if (activity !== undefined)
                activities.begin(key(agent), activity);
        },
        promoted: (agent, reservation) => {
            const patch = reservationPromotion(reservation);
            if (patch !== undefined)
                activities.update(key(agent), reservation.id, patch);
        },
        settled: (agent, reservation, outcome) => {
            const settled = reservationSettled(reservation, outcome);
            activities.finish(key(agent), reservation.id, settled?.outcome, now());
        },
    };
}
/**
 * Per-session activity table.
 *
 * One active cycle per session, because the router owns one in-flight reservation per agent at a
 * time; a settled cycle replaces the previous settled one (the chip is a status line, not a history
 * — the statistics sidecar is the history).
 */
export class VerifierActivities {
    active = new Map();
    settled = new Map();
    /** Publish one cycle as in flight. */
    begin(sessionId, activity) {
        this.active.set(sessionId, activity);
    }
    /**
     * Move one in-flight cycle to a later phase.
     *
     * Guarded by cycle id: a cycle that already settled (or was replaced by a newer one) must not be
     * moved back into "in flight" by a late async step.
     * @returns whether the exact cycle was the active one.
     */
    update(sessionId, cycleId, patch) {
        const current = this.active.get(sessionId);
        if (current === undefined || current.cycleId !== cycleId)
            return false;
        this.active.set(sessionId, { ...current, ...patch });
        return true;
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
    finish(sessionId, cycleId, outcome, now) {
        const active = this.active.get(sessionId);
        const settled = this.settled.get(sessionId);
        const known = active?.cycleId === cycleId
            ? active
            : settled?.cycleId === cycleId
                ? settled
                : undefined;
        if (known === undefined)
            return false;
        if (active?.cycleId === cycleId)
            this.active.delete(sessionId);
        if (outcome === undefined) {
            if (settled?.cycleId === cycleId)
                this.settled.delete(sessionId);
            return true;
        }
        this.settled.set(sessionId, {
            cycleId,
            stage: known.stage,
            outcome,
            ...(known.candidates === undefined ? {} : { candidates: known.candidates }),
            at: now,
        });
        return true;
    }
    /**
     * What one session has to show right now, with expired records pruned in place.
     * @param sessionId - the session to read.
     * @param now - wall clock used for both TTLs.
     */
    read(sessionId, now) {
        const active = this.active.get(sessionId);
        if (active !== undefined && now - active.startedAt >= ACTIVITY_ACTIVE_TTL_MS)
            this.active.delete(sessionId);
        const settled = this.settled.get(sessionId);
        if (settled !== undefined && now - settled.at >= ACTIVITY_SETTLED_TTL_MS)
            this.settled.delete(sessionId);
        const currentActive = this.active.get(sessionId);
        const currentSettled = this.settled.get(sessionId);
        return {
            ...(currentActive === undefined ? {} : { active: currentActive }),
            ...(currentSettled === undefined ? {} : { settled: currentSettled }),
        };
    }
    /** Forget one session entirely (settings changed, task replaced, agent disposed). */
    clear(sessionId) {
        this.active.delete(sessionId);
        this.settled.delete(sessionId);
    }
    /** Forget every session (settings change, shutdown). */
    clearAll() {
        this.active.clear();
        this.settled.clear();
    }
}
//# sourceMappingURL=verifier-activity.js.map