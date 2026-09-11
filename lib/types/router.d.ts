import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { AutoVerifyMode } from './auto.ts';
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
    maxPerTask: number;
    maxPerSession: number;
    maxModelCallsPerTask: number;
    maxModelCallsPerSession: number;
    maxInputChars: number;
    maxItemChars: number;
}
interface Reservation {
    id: string;
    phase: RoutePhase;
    fingerprint: string;
    taskStartSeq: number;
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
}
export declare function buildEvidenceIndex(events: readonly SessionEvent[]): EvidenceIndex | undefined;
export declare function analyzeStructuredRoute(events: readonly SessionEvent[], maxCandidates?: number, maxItemChars?: number, maxInputChars?: number): RouteDecision | undefined;
export declare function semanticRouteHint(events: readonly SessionEvent[]): boolean;
export declare function buildSemanticRoutePrompt(problem: string, events: readonly SessionEvent[], maxCandidates: number, maxItemChars?: number, maxInputChars?: number): string;
export declare function parseSemanticRoute(text: string, maxCandidates?: number): SemanticRouteOutput | undefined;
export declare function semanticDecision(output: SemanticRouteOutput, events: readonly SessionEvent[], maxItemChars?: number, maxInputChars?: number): RouteDecision | undefined;
/**
 * Estimated model calls for one routed decision.
 *
 * Uses the real tournament shape (ring edges + pivot-round edges x criteria x
 * repeats) instead of a flat per-candidate constant, which over-reserved by
 * roughly an order of magnitude and silently rejected legitimate selections.
 *
 * The select branch counts the pairs `VerifierEngine.select` will actually judge by
 * calling the same {@link selectPairs} planner. Re-deriving that number here used to
 * over-count from 11 candidates onward: the pivot round lists a ring edge once per
 * pivot, and the pivot-pivot edge only repeats when the final round happens to draw
 * the two pivots next to each other, so the subtraction is not the constant the old
 * formula assumed. The router then reserved a few more calls than the run consumed
 * (harmless but wrong in the direction that rejects work) and the two estimators
 * disagreed with each other. A routed decision always uses the default seed and
 * pivot count, which is why the planner is called with its own defaults.
 * @param decision - the routed decision about to run.
 * @param repeats - evaluation repeats per criterion.
 * @param criteriaCount - number of criteria evaluated per comparison.
 * @returns The planned model-call count, never below 1.
 */
export declare function estimateRoutedCalls(decision: RouteDecision, repeats: number, criteriaCount: number): number;
export declare function boundDecision(decision: RouteDecision | undefined, policy: RouterPolicy): RouteDecision | undefined;
export declare class AutoVerifierRouter {
    private readonly states;
    /** Agent ids that already received this task's budget-exhaustion notice. */
    private readonly exhaustedNotices;
    private serial;
    private state;
    reserve(agent: RoutedAgent, phase: RoutePhase, fingerprint: string, expectedCalls: number, policy: RouterPolicy): Reservation | undefined;
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
    strictBlocked(agent: RoutedAgent): boolean;
    release(agent: {
        id: unknown;
    }): void;
}
export {};
//# sourceMappingURL=router.d.ts.map