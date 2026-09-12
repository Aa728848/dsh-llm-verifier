import type { SessionEvent } from '@deepseek-ai/dsh-session';
export type AutoVerifyMode = 'manual' | 'smart' | 'strict';
export interface AutoVerifyPolicy {
    mode: AutoVerifyMode;
    minToolCalls: number;
    /**
     * Attempt caps. {@link analyzeAutoTask} deliberately ignores them: it only
     * answers "is this task eligible", while the caps are enforced by
     * {@link AutoVerificationBudget} and by the router's reservation state.
     */
    maxPerTask: number;
    maxPerSession: number;
    /** Acceptance threshold a manual `verifier_current_session` result must reach to count. */
    threshold: number;
}
export interface AutoTaskEvidence {
    taskStartSeq: number;
    toolCalls: number;
    completedToolResults: number;
    consequentialToolCalls: number;
    /** A completed `verifier_current_session` call exists (whatever its verdict). */
    hasManualSessionVerification: boolean;
    /** That verification passed the threshold and no consequential work happened since. */
    manualVerificationAccepted: boolean;
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
/** One criterion's outcome from a session acceptance (candidate A is the session). */
export interface AcceptanceCriterion {
    id: string;
    name?: string;
    score: number;
}
/**
 * Criteria that do not clear the acceptance threshold.
 *
 * The acceptance score is the MEAN over criteria, so a session with one requirement at
 * zero and the others perfect averaged ~0.67 and cleared the 0.65 default: a single
 * failed requirement was arithmetically invisible. The gate therefore also requires
 * every criterion to clear the threshold on its own.
 * @param criteria - per-criterion A-side scores, when the judge reported them.
 * @param threshold - acceptance threshold.
 * @returns The failing criteria, in report order.
 */
export declare function failedAcceptanceCriteria(criteria: readonly AcceptanceCriterion[] | undefined, threshold: number): AcceptanceCriterion[];
/**
 * Whether a session acceptance clears the gate.
 *
 * The empty-work baseline is a fixed sentence that always scores 0, so the comparison
 * itself is decorative; what actually decides is the session's own score, the winner
 * against that baseline, and (since the mean could hide a failed requirement) every
 * criterion clearing the threshold.
 * @param evidence - session acceptance result (score, winner and per-criterion scores).
 * @param threshold - acceptance threshold.
 * @returns True only when the session may conclude.
 */
export declare function sessionAccepted(evidence: {
    score: number;
    winner: 'A' | 'B' | 'tie';
    criteria?: readonly AcceptanceCriterion[];
}, threshold: number): boolean;
export declare function automaticFeedback(score: number, baselineScore: number, winner: 'A' | 'B' | 'tie', threshold: number, failedCriteria?: readonly AcceptanceCriterion[]): string;
//# sourceMappingURL=auto.d.ts.map