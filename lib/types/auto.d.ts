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
export declare function analyzeAutoTask(events: readonly SessionEvent[], policy: AutoVerifyPolicy): AutoTaskEvidence;
export declare class AutoVerificationBudget {
    private readonly states;
    claim(agent: Agent, evidence: AutoTaskEvidence, policy: AutoVerifyPolicy): boolean;
    release(agent: Agent): void;
}
export declare function automaticFeedback(score: number, baselineScore: number, winner: 'A' | 'B' | 'tie', threshold: number): string;
//# sourceMappingURL=auto.d.ts.map