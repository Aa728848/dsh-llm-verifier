import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type Diagnostic, type ReviewStage } from './core.ts';
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
export declare function analyzeAutoTask(events: readonly SessionEvent[], policy: AutoVerifyPolicy, sessionId?: string): AutoTaskEvidence;
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
export declare function automaticFeedback(score: number, baselineScore: number, winner: 'A' | 'B' | 'tie', threshold: number, failedCriteria?: readonly AcceptanceCriterion[], locator?: {
    sessionId?: string;
    fromSeq?: number;
    toSeq?: number;
    omittedCharacters?: number;
}, reportedCriteria?: number, diagnostics?: readonly Diagnostic[]): string;
/** One automatic feedback message may not exceed this many characters, fixed wording included. */
export declare const MAX_ROUTE_FEEDBACK_CHARS = 4000;
/** Locator for one routed candidate: a label plus the identity/event position it can be found by. */
export interface RoutedCandidateRef {
    label: string;
    /** Envelope id or callId; omitted from the locator when it equals the label. */
    id?: string;
    fromSeq?: number;
    toSeq?: number;
}
/**
 * Indices sharing the highest score.
 *
 * The engine breaks ties by index, so "the first entry of the ranking" is a stable sort
 * artefact — exactly what S04 forbids presenting as a unique winner.
 * @param scores - candidate scores in candidate order.
 * @returns The tied-for-top indices, empty when no score is finite.
 */
export declare function topScoreIndices(scores: readonly number[]): number[];
/**
 * Deterministic automatic feedback for one routed comparison.
 *
 * Announces a winner only when the judge really named one; a tie or a byte-identical pair
 * is described as such, with locators instead of copied text. Pure so the wording is
 * testable without a model or a hook.
 * @param candidates - the two candidates, in slot order (A then B).
 * @param result - the engine's comparison result.
 * @param maxChars - message budget.
 * @returns The feedback body (the caller wraps and bounds it).
 */
export declare function compareRouteFeedbackDetail(candidates: readonly [RoutedCandidateRef, RoutedCandidateRef], result: {
    winner: 'A' | 'B' | 'tie';
    scoreA: number;
    scoreB: number;
    identical?: boolean;
}, maxChars?: number, stage?: ReviewStage): string;
/**
 * What a proposal verdict does and does not mean.
 *
 * The two stages produce the same numbers from different questions, and reading a proposal win as
 * evidence that the work is done is exactly the confusion the stage split exists to prevent.
 */
export declare const PROPOSAL_FEEDBACK_NOTE = "This was a PROPOSAL review: neither side has been executed, so the score compares plans, not results. A higher score means more promising, NOT more reliable or already done \u2014 implement it and verify the required work before treating anything as complete.";
/**
 * Deterministic automatic feedback for one routed selection.
 *
 * A selection reports relative preference shares only, so this never invents an absolute
 * quality score or a per-criterion explanation. A shared top score is reported as a tie
 * set, and an all-identical field is reported as "no ranking happened" rather than as a
 * confident pick.
 * @param candidates - candidates in candidate order.
 * @param result - the engine's selection result.
 * @param maxChars - message budget.
 * @returns The feedback body (the caller wraps and bounds it).
 */
export declare function selectRouteFeedbackDetail(candidates: readonly RoutedCandidateRef[], result: {
    index: number;
    ranking: readonly number[];
    scores: readonly number[];
    identical?: boolean;
}, maxChars?: number, stage?: ReviewStage): string;
//# sourceMappingURL=auto.d.ts.map