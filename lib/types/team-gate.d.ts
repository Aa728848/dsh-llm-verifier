import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TeamTaskItem } from './router.ts';
export interface TeamTaskInspection {
    latestCompletedTask?: TeamTaskItem;
    completedSeq?: number;
    activeTasks: TeamTaskItem[];
    hasRecentCompletedTask: boolean;
}
export declare function inspectTeamTasks(events: readonly SessionEvent[], fromSeq?: number): TeamTaskInspection;
export declare function buildTeamTaskVerificationPrompt(task: TeamTaskItem, executionTrace: string, maxChars?: number): string;
//# sourceMappingURL=team-gate.d.ts.map