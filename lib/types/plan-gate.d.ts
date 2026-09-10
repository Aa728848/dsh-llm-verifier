import type { SessionEvent } from '@deepseek-ai/dsh-session';
export interface PlanModeDetection {
    hasExitPlanMode: boolean;
    callSeq?: number;
    planText?: string;
}
export declare function detectPlanExit(events: readonly SessionEvent[], fromSeq?: number): PlanModeDetection;
export declare function buildPlanPreReviewPrompt(problem: string, planText: string, maxChars?: number): string;
export declare function parsePlanReviewVerdict(text: string): {
    verdict: string;
    score: number;
    feedback: string;
};
//# sourceMappingURL=plan-gate.d.ts.map