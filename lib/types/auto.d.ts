import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
export type AutoVerifyMode = 'manual' | 'smart' | 'strict';
export interface AutoVerifyPolicy {
    mode: AutoVerifyMode;
    minToolCalls: number;
    maxPerTask: number;
    maxPerSession: number;
}
export interface AutoTaskEvidence {
    taskStartSeq: number;
    toolCalls: number;
    completedToolResults: number;
    consequentialToolCalls: number;
    hasManualSessionVerification: boolean;
    eligible: boolean;
    reason: string;
}
/**
 * Whether an agent session is a delegated child rather than the operator's own
 * topic. Child sessions are seeded with a real user message, so they look like
 * a fresh task to {@link analyzeAutoTask}; gate them only when asked.
 * @param agent - Agent (or any object exposing its session).
 * @returns True for subagent and forked-child sessions.
 */
export declare function isSubagentSession(agent: {
    session?: unknown;
} | undefined): boolean;
export declare function analyzeAutoTask(events: readonly SessionEvent[], policy: AutoVerifyPolicy): AutoTaskEvidence;
/**
 * Session/task acceptance budget.
 *
 * The automatic verifier enforces its per-task and per-session budget through
 * {@link AutoVerifierRouter} reservations, which also count the routing phases;
 * this standalone counter is kept as a public utility for orchestrators that
 * need the same accounting outside the router.
 */
export declare class AutoVerificationBudget {
    private readonly states;
    claim(agent: Agent, evidence: AutoTaskEvidence, policy: AutoVerifyPolicy): boolean;
    release(agent: Agent): void;
}
export declare function automaticFeedback(score: number, baselineScore: number, winner: 'A' | 'B' | 'tie', threshold: number): string;
//# sourceMappingURL=auto.d.ts.map