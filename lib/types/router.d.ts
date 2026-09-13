import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { AutoVerifyMode } from './auto.ts';
/**
 * A unique id for a diagnostic route row that never got a reservation (evidence dropped by the
 * caps, a delivery-phase skip). Cross-reload safe for the same reason a reservation id is:
 * without it two plugin incarnations both produce `diagnostic-1` and merge in the summary.
 */
export declare function nextDiagnosticCycleId(): string;
/** One durable todo entry carried by `todo/write` snapshots (DSH 0.1.5 dropped the exported type). */
export interface TodoItem {
    content: string;
    status: string;
}
/** The agent surface this router needs: an id and whatever the host exposes as its session. */
interface RoutedAgent {
    id: unknown;
    session: unknown;
}
export type RoutedVerifierKind = 'compare' | 'select' | 'track';
export type RoutePhase = 'semantic' | RoutedVerifierKind | 'final' | 'plan_review' | 'team_task';
export interface CandidateArtifact {
    id: string;
    groupId: string;
    label: string;
    content: string;
    /**
     * Redacted, UNTRUNCATED content used only for explicit-review de-duplication. `content`
     * is capped for the prompt, so two explicit calls that passed the full text verbatim
     * would otherwise never match the truncated candidate and the same input would be
     * bought again.
     */
    identity: string;
    callId: string;
    fromSeq: number;
    toSeq: number;
}
interface RouteBase {
    source: 'structured' | 'semantic';
    confidence: number;
    reason: string;
    fingerprint: string;
}
export interface CompareRouteDecision extends RouteBase {
    kind: 'compare';
    candidates: [CandidateArtifact, CandidateArtifact];
}
export interface SelectRouteDecision extends RouteBase {
    kind: 'select';
    candidates: CandidateArtifact[];
}
export interface TrackRouteDecision extends RouteBase {
    kind: 'track';
    steps: string[];
    checkpoints: number[];
    evidenceSeqs: number[];
}
export type RouteDecision = CompareRouteDecision | SelectRouteDecision | TrackRouteDecision;
export interface SemanticRouteOutput {
    kind: 'none' | RoutedVerifierKind;
    confidence: number;
    reason: string;
    candidateCallIds: string[];
    checkpointSeqs: number[];
}
export interface RouterPolicy {
    mode: AutoVerifyMode;
    minConfidence: number;
    maxCandidates: number;
    /**
     * Automatic route attempts (semantic classification, plan pre-review, team-task gate and
     * compare/select/track) allowed within one task and one session.
     *
     * Routing and the final acceptance are metered by SEPARATE counters on purpose. They used
     * to share one, which let routing spend the final gate's share: the gate is mandatory once
     * armed (finalRequiredFromSeq), so a busy task could exhaust the shared counter on routes
     * and then close the turn with the gate never having run.
     */
    maxRoutePerTask: number;
    maxRoutePerSession: number;
    /** Attempts reserved for the final acceptance; routing can never spend these. */
    maxFinalPerTask: number;
    maxFinalPerSession: number;
    maxModelCallsPerTask: number;
    maxModelCallsPerSession: number;
    maxInputChars: number;
    maxItemChars: number;
    /**
     * Model calls that must stay affordable for at least one final acceptance
     * (criteria × final repeats × judges). Routing reservations are refused when they
     * would spend into this floor: the gate is mandatory once armed, so a route that
     * consumes its budget leaves a turn that can never be closed. Optional so callers
     * that only exercise the counter logic need not supply it (treated as 0).
     */
    minFinalModelCalls?: number;
}
/**
 * One granted routing cycle.
 *
 * A cycle is the unit the route-attempt counter meters, not a model call: a semantic
 * classification that resolves to a decision is promoted on the SAME reservation and
 * still consumes exactly one attempt. The reservation therefore keeps its id across the
 * promotion, and {@link Reservation.expectedCalls} grows with the execution budget the
 * promotion reserved.
 */
export interface Reservation {
    id: string;
    phase: RoutePhase;
    fingerprint: string;
    taskStartSeq: number;
    /**
     * Conservative model-call count reserved for this cycle so far. A classification cycle
     * starts at 1 and gains the decision's planned calls when it is promoted.
     */
    expectedCalls: number;
    /** 1-based attempt ordinal this cycle consumed on its task/session counter. */
    attempt: number;
}
/**
 * Sequence number of the message that opened the current task.
 *
 * Team messages count as well: an Agent Teams teammate is handed its task by a team
 * message, and without this the router would see no task boundary in that session and
 * silently refuse every reservation — including team task gating. This helper is the
 * single definition shared with {@link analyzeAutoTask}.
 * @param events - Session event log.
 * @returns The seq of the newest task-assigning message, or undefined.
 */
export declare function latestDirectUserSeq(events: readonly SessionEvent[]): number | undefined;
export interface EvidenceCall {
    name: string;
    callSeq: number;
    resultSeq: number;
    text: string;
    /**
     * Whether the result settled successfully. A failed result is still REAL evidence of
     * the session's state ("the test run failed") and must reach the progress checkpoints;
     * it is never a selectable candidate.
     */
    ok: boolean;
    /** Raw call arguments, kept so explicit verifier reviews can be bound to their input. */
    args?: string;
}
export interface TeamTaskItem {
    id: string;
    revision: number;
    subject: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'deleted';
    ownerId?: string;
}
interface EvidenceIndex {
    problemSeq: number;
    calls: Map<string, EvidenceCall>;
    todos: Map<number, TodoItem[]>;
    teamTasks: Map<number, TeamTaskItem[]>;
    /** Newest assistant prose in the task; attached to the current checkpoint as a claim, never as evidence. */
    narration?: {
        seq: number;
        text: string;
    };
}
export declare function buildEvidenceIndex(events: readonly SessionEvent[]): EvidenceIndex | undefined;
/** What the delivery-phase shortcut needs to know about one task. */
export interface DeliveryPhase {
    /** The task's newest durable todo snapshot is non-empty and every entry is completed. */
    todosComplete: boolean;
    /** The newest verification-shaped run in the task, with the sequence its result settled at. */
    verification?: {
        seq: number;
        name: string;
        ok: boolean;
    };
    /**
     * Deterministic identity of the completion signal.
     *
     * Changes only when the todo snapshot or the newest verification run changes, so the
     * stop boundary can tell "the same finished state was already sent to the gate" from
     * "new work or a new verification run reactivated the completion signal".
     */
    signature: string;
}
/**
 * Whether a task has reached its delivery phase: every todo is done AND a real verification
 * run exists.
 *
 * This decides ONLY whether the final acceptance is worth running right now; it never decides
 * whether the task passes, and it deliberately does not look at the verification's success —
 * a failing run is exactly what the judge must be shown. Todos completing without any
 * verification evidence is not a delivery phase, because the judge would have nothing to
 * grade.
 * @param events - session event log.
 * @returns The delivery-phase facts, or undefined when the task has no evidence index.
 */
export declare function inspectDeliveryPhase(events: readonly SessionEvent[]): DeliveryPhase | undefined;
/**
 * Upper bound on the checkpoints rendered into one routed track decision.
 *
 * boundDecision() rejects the WHOLE decision once the rendered steps exceed
 * maxInputChars, while the number of durable snapshots is unbounded (every changed
 * todo/team snapshot becomes a checkpoint). A long task therefore used to lose
 * progress routing exactly when it needed it, so only the most recent checkpoints
 * are kept and the combined input budget is split across them.
 */
export declare const MAX_ROUTED_CHECKPOINTS = 6;
/** Optional state the caller can use to skip decisions the task has already run. */
export interface StructuredRouteOptions {
    /**
     * Whether an automatic decision with this fingerprint was already committed for the
     * task. Skipping it lets a NEWER, unprocessed candidate group be selected instead of
     * refusing the whole structured pass.
     */
    processed?: (fingerprint: string) => boolean;
}
export declare function analyzeStructuredRoute(events: readonly SessionEvent[], maxCandidates?: number, maxItemChars?: number, maxInputChars?: number, options?: StructuredRouteOptions): RouteDecision | undefined;
/**
 * Whether a smart-mode stop boundary is worth a semantic classification call.
 *
 * The semantic phase only runs when the structured pass produced nothing, so this
 * answers "is there material the structured pass never consumes?" — never "are there
 * todo/team snapshots?", which the structured pass would have used already.
 * @param events - Session event log.
 * @returns True when a subagent/workflow/plan artifact exists.
 */
export declare function semanticRouteHint(events: readonly SessionEvent[]): boolean;
/**
 * The bounded, redacted evidence a semantic classification call may see.
 *
 * {@link SemanticRouteVisibility} is returned alongside the prompt because the classifier
 * may only cite what was actually rendered: with a budget, artifacts and checkpoints get
 * dropped, and a citation of a dropped id is an invalid reference rather than a decision.
 * Rendering and reference validation therefore share this one result instead of each
 * re-deriving its own idea of "what was offered".
 */
export interface SemanticRouteView {
    prompt: string;
    /** callIds rendered into the prompt: the only valid `candidateCallIds` values. */
    candidateCallIds: Set<string>;
    /** todo checkpoint sequence numbers rendered into the prompt: the only valid `checkpointSeqs`. */
    checkpointSeqs: Set<number>;
    /** How many evidence items were dropped for budget reasons. */
    omitted: number;
    /** Exact character length of the rendered evidence payload (task + kept blocks). */
    evidenceChars: number;
}
/** The subset of a view a reference check needs. */
export interface SemanticRouteVisibility {
    candidateCallIds: ReadonlySet<string>;
    checkpointSeqs: ReadonlySet<number>;
}
/**
 * Build the semantic router prompt plus the exact set of references it offered.
 *
 * Every piece of evidence is redacted, bounded per item and charged against ONE shared
 * character budget that also carries each block's framing cost. The previous pass
 * sanitized artifacts but appended the first todo snapshot unconditionally, so a single
 * long list could push the prompt past the cap (measured at ~10.8k characters against a
 * 1000-character budget) while still carrying the raw content into the model input.
 * @param problem - task statement; bounded separately because it is not untrusted evidence.
 * @param events - session event log.
 * @param maxCandidates - upper bound the prompt advertises for a `select`.
 * @param maxItemChars - hard per-item cap.
 * @param maxInputChars - hard combined cap for the rendered evidence.
 * @returns The prompt and the visibility set its references are validated against.
 */
export declare function buildSemanticRouteView(problem: string, events: readonly SessionEvent[], maxCandidates: number, maxItemChars?: number, maxInputChars?: number): SemanticRouteView;
/** Prompt-only wrapper kept for callers that do not validate references themselves. */
export declare function buildSemanticRoutePrompt(problem: string, events: readonly SessionEvent[], maxCandidates: number, maxItemChars?: number, maxInputChars?: number): string;
export declare function parseSemanticRoute(text: string, maxCandidates?: number): SemanticRouteOutput | undefined;
/**
 * Whether every reference in a classification was actually offered to it.
 *
 * The prompt only renders what fit the shared budget, so citing an omitted artifact or
 * checkpoint is an invalid reference (a rejected decision), never a decision about
 * evidence the classifier never saw.
 */
export declare function semanticReferencesVisible(output: SemanticRouteOutput, visible: SemanticRouteVisibility): boolean;
export declare function semanticDecision(output: SemanticRouteOutput, events: readonly SessionEvent[], maxItemChars?: number, maxInputChars?: number, visible?: SemanticRouteVisibility): RouteDecision | undefined;
/**
 * Estimated model calls for one routed decision.
 *
 * Uses the real tournament shape (ring edges + pivot-round edges x criteria x
 * repeats) instead of a flat per-candidate constant, which over-reserved by
 * roughly an order of magnitude and silently rejected legitimate selections.
 * @param decision - the routed decision about to run.
 * @param repeats - evaluation repeats per criterion.
 * @param criteriaCount - number of criteria evaluated per comparison.
 * @returns The planned model-call count, never below 1.
 */
/**
 * Scoring repeats a routed decision actually runs.
 *
 * `compare` judges ONE unordered pair, and `VerifierEngine.compare` only swaps the
 * candidates on odd repeat indices — with the shipped default of a single round the
 * first candidate therefore always sat in slot A, so the winner was partly decided by
 * listing order. Rounding its count up to an even number averages a swapped round and
 * cancels that.
 *
 * `select` does not need it: its ring is symmetric by construction and the pivot round
 * is oriented per pair by the engine, so one round is already unbiased. `track` has no
 * slots at all, but it has its own repeat count: without token logprobs one call yields
 * ONE sampled letter (5.3% of the scale per letter), so repeats are averaged to keep the
 * progress curve from flipping bands on sampling noise — the same reason the upstream
 * `n_evaluations` averages repeated verifications.
 * @param decision - the routed decision about to run.
 * @param configured - the configured auto-route repeat count.
 * @param trackRepeats - repeat count for a `track` route; defaults to `configured`.
 * @returns The repeat count to pass to the engine.
 */
export declare function routedRepeats(decision: RouteDecision, configured: number, trackRepeats?: number): number;
export declare function estimateRoutedCalls(decision: RouteDecision, repeats: number, criteriaCount: number): number;
export declare function boundDecision(decision: RouteDecision | undefined, policy: RouterPolicy): RouteDecision | undefined;
export declare class AutoVerifierRouter {
    private readonly states;
    /** Agent ids that already received this task's budget-exhaustion notice. */
    private readonly exhaustedNotices;
    private serial;
    /** Namespace for this router's cycle ids; unique per router and per process incarnation. */
    private readonly instance;
    private state;
    reserve(agent: RoutedAgent, phase: RoutePhase, fingerprint: string, expectedCalls: number, policy: RouterPolicy): Reservation | undefined;
    /**
     * Continue an in-flight classification cycle as the decision that classification resolved.
     *
     * A semantic cycle used to commit its classification reservation (releasing the lock) and
     * then call {@link reserve} again for compare/select/track. The two reservations spent TWO
     * route attempts for one logical cycle, so the shipped default of 2 attempts made
     * "plan pre-review → classify → compare" impossible: the classification itself consumed
     * the second attempt and the execution it produced could never be admitted.
     *
     * Promotion is the cycle's own reservation gaining the execution phase. It deliberately
     * does NOT touch the attempt counters — that is the whole point — and it re-checks the
     * budget for the extra calls atomically, so a cycle that can classify but not afford the
     * scoring is refused here instead of after the model was already paid for.
     *
     * The classification fingerprint is recorded as completed on success: it was really spent,
     * and re-classifying the same snapshot would be a duplicate purchase.
     * @param agent - Agent whose classification reservation is in flight.
     * @param reservation - the reservation returned by {@link reserve} for this cycle.
     * @param phase - the decision phase the cycle now executes.
     * @param fingerprint - the resolved decision's fingerprint (replaces the classification one).
     * @param expectedCalls - model calls the execution adds on top of the classification call.
     * @param policy - resolved routing policy.
     * @returns True when the same reservation now owns the execution phase.
     */
    promote(agent: RoutedAgent, reservation: Reservation, phase: RoutePhase, fingerprint: string, expectedCalls: number, policy: RouterPolicy): boolean;
    commit(agent: RoutedAgent, reservation: Reservation, evidenceSeq?: number): boolean;
    fail(agent: RoutedAgent, reservation: Reservation, strict: boolean): void;
    /**
     * Claim this task's single budget-exhaustion notice.
     *
     * Once the task/session budget is spent no reservation can ever be granted
     * again, so the states that demand strict verification (strictBlocked,
     * finalRequiredFromSeq) can never be cleared by a commit. Steering on every
     * stop boundary would then hold the turn open forever — the harness has no
     * turn budget — so the notice is emitted at most once per task and the
     * remaining stop boundaries close normally.
     * @param agent - Agent whose task is out of budget.
     * @returns True when the caller should steer the notice now.
     */
    claimExhaustedNotice(agent: RoutedAgent): boolean;
    /** Whether the task or session budget cannot cover one more routed decision. */
    budgetExhausted(agent: RoutedAgent, expectedCalls: number, policy: RouterPolicy): boolean;
    /** Whether this exact fingerprint already passed within the current task. */
    completedFingerprint(agent: RoutedAgent, fingerprint: string): boolean;
    finalRequired(agent: RoutedAgent): number | undefined;
    /**
     * Arm "run the final gate next": a track route already cleared the completion threshold,
     * so the next stop boundary must not buy another route first.
     * @param agent - Agent whose track route cleared the threshold.
     */
    preferFinal(agent: RoutedAgent): void;
    /**
     * Discharge the mandatory final gate with a current, passing manual verification.
     *
     * `analyzeAutoTask` has already established that the verdict covered the whole task
     * up to its last consequential work and cleared every criterion; refusing to clear
     * `finalRequiredFromSeq` here would run the same acceptance a second time.
     * @param agent - Agent whose task was explicitly verified as accepted.
     */
    acceptManual(agent: RoutedAgent): void;
    /** Whether the next stop boundary must skip routing and run the final gate. */
    finalPreferred(agent: RoutedAgent): boolean;
    /**
     * Whether this exact delivery-phase signal was already sent to the final acceptance.
     * @param agent - Agent whose task is being inspected.
     * @param signature - signature returned by inspectDeliveryPhase.
     */
    deliveryConsumed(agent: RoutedAgent, signature: string): boolean;
    /** Mark the delivery-phase signal as spent, so the same finished state stops skipping routing. */
    consumeDelivery(agent: RoutedAgent, signature: string): void;
    strictBlocked(agent: RoutedAgent): boolean;
    release(agent: {
        id: unknown;
    }): void;
}
export {};
//# sourceMappingURL=router.d.ts.map