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
export declare function analyzeStructuredRoute(events: readonly SessionEvent[], maxCandidates?: number, maxItemChars?: number): RouteDecision | undefined;
export declare function semanticRouteHint(events: readonly SessionEvent[]): boolean;
export declare function buildSemanticRoutePrompt(problem: string, events: readonly SessionEvent[], maxCandidates: number, maxItemChars?: number): string;
export declare function parseSemanticRoute(text: string, maxCandidates?: number): SemanticRouteOutput | undefined;
export declare function semanticDecision(output: SemanticRouteOutput, events: readonly SessionEvent[], maxItemChars?: number): RouteDecision | undefined;
export declare function boundDecision(decision: RouteDecision | undefined, policy: RouterPolicy): RouteDecision | undefined;
export declare class AutoVerifierRouter {
    private readonly states;
    private serial;
    private state;
    reserve(agent: RoutedAgent, phase: RoutePhase, fingerprint: string, expectedCalls: number, policy: RouterPolicy): Reservation | undefined;
    commit(agent: RoutedAgent, reservation: Reservation, evidenceSeq?: number): boolean;
    fail(agent: RoutedAgent, reservation: Reservation, strict: boolean): void;
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