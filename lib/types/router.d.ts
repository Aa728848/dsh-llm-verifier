import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session';
import type { AutoVerifyMode } from './auto.ts';
export type RoutedVerifierKind = 'compare' | 'select' | 'track';
export type RoutePhase = 'semantic' | RoutedVerifierKind | 'final';
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
interface EvidenceIndex {
    problemSeq: number;
    calls: Map<string, {
        call: SessionEvent<'tool/call'>;
        result: SessionEvent<'tool/result'>;
        text: string;
    }>;
    todos: Map<number, TodoItem[]>;
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
    reserve(agent: {
        id: unknown;
        session: {
            events: readonly SessionEvent[];
        };
    }, phase: RoutePhase, fingerprint: string, expectedCalls: number, policy: RouterPolicy): Reservation | undefined;
    commit(agent: {
        id: unknown;
        session: {
            events: readonly SessionEvent[];
        };
    }, reservation: Reservation, evidenceSeq?: number): boolean;
    fail(agent: {
        id: unknown;
        session: {
            events: readonly SessionEvent[];
        };
    }, reservation: Reservation, strict: boolean): void;
    finalRequired(agent: {
        id: unknown;
        session: {
            events: readonly SessionEvent[];
        };
    }): number | undefined;
    strictBlocked(agent: {
        id: unknown;
        session: {
            events: readonly SessionEvent[];
        };
    }): boolean;
    release(agent: {
        id: unknown;
    }): void;
}
export {};
//# sourceMappingURL=router.d.ts.map