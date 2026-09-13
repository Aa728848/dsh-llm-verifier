/**
 * In-memory view of the process-selection (P06) cycles that are in flight, for the chat chip.
 *
 * WHY THIS EXISTS
 * ---------------
 * A cycle buffers the main reply before anything is replayed, so while it runs the chat shows no
 * streaming text at all — indistinguishable from a hang. The harness renders such an indicator from
 * a *session event* pair (`compaction/start` → `compaction/end` is how "Compacting context…" works),
 * and that route is closed to an out-of-repo plugin: the persistence read path
 * (`validateStoredEvents` in `@deepseek-ai/dsh-session-persistence`) refuses to interpret a log
 * containing an event type outside the repository-generated `KNOWN_SESSION_EVENT_TYPES` unless the
 * stored envelope carries `ignorable: true`, and `Session.append` cannot set that marker — only a
 * seed/restore envelope can. Appending our own type would therefore make the topic unloadable.
 *
 * So the indicator is deliberately host-only state: the selector publishes what it is doing into
 * this registry, the plugin's existing RPC answers a read of it, and the client polls that read
 * only while a turn runs. Nothing here is durable (a reload shows nothing, which is correct: the
 * cycle it described is gone) and nothing here touches the model history or the statistics.
 *
 * Pure bookkeeping: no I/O, no clock of its own (callers pass `now`), so it is directly testable.
 */
/**
 * How long a settled cycle keeps explaining itself.
 *
 * Long enough to be read after the reply lands (the chat scrolls as soon as the winner replays),
 * short enough that a stale line never becomes part of the transcript.
 */
export const PROCESS_ACTIVITY_SETTLED_TTL_MS = 20_000;
/**
 * Map one finished cycle onto the outcome the chip distinguishes.
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
 * Per-session activity table. One active cycle per session, because the selector owns one phase
 * controller per session; a settled cycle replaces the previous settled one (the chip is a status
 * line, not a history — the statistics sidecar is the history).
 */
export class ProcessActivities {
    active = new Map();
    settled = new Map();
    /**
     * Publish one cycle as in flight. Called once per bought cycle, after the reservation and the
     * cycle log are in place and immediately before the alternative is dispatched.
     */
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
    phase(sessionId, cycleId, phase) {
        const current = this.active.get(sessionId);
        if (current === undefined || current.cycleId !== cycleId)
            return false;
        this.active.set(sessionId, { ...current, phase });
        return true;
    }
    /**
     * Retire one cycle and report how it resolved.
     *
     * A cycle nobody observed (the purchase itself failed, so `begin` never ran) leaves nothing
     * behind: the chip must not claim a cycle that never started. A cycle that WAS observed stays
     * correctable while its own settled record is the current one, which is what the selector's
     * late "the winner was not delivered" correction needs.
     * @returns whether the cycle was known and the outcome recorded.
     */
    finish(sessionId, cycleId, outcome, replayed, now) {
        const current = this.active.get(sessionId);
        const known = current?.cycleId === cycleId
            ? current
            : this.settled.get(sessionId)?.cycleId === cycleId
                ? this.settled.get(sessionId)
                : undefined;
        if (known === undefined)
            return false;
        if (current?.cycleId === cycleId)
            this.active.delete(sessionId);
        this.settled.set(sessionId, {
            cycleId,
            outcome: classifyProcessOutcome(outcome, replayed),
            candidates: known.candidates,
            at: now,
        });
        return true;
    }
    /**
     * What one session has to show right now, with expired settled records pruned in place.
     * @param sessionId - the session to read.
     * @param now - wall clock used for the settled TTL.
     */
    read(sessionId, now) {
        const settled = this.settled.get(sessionId);
        if (settled !== undefined && now - settled.at >= PROCESS_ACTIVITY_SETTLED_TTL_MS) {
            this.settled.delete(sessionId);
        }
        const active = this.active.get(sessionId);
        const current = this.settled.get(sessionId);
        return {
            ...(active === undefined ? {} : { active }),
            ...(current === undefined ? {} : { settled: current }),
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
//# sourceMappingURL=process-activity.js.map