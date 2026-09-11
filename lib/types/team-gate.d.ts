import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TeamTaskItem } from './router.ts';
export declare const MAX_TEAM_TASK_METADATA_CHARS = 4000;
/** One completed task and the sequence number of its completion. */
export interface CompletedTeamTask {
    task: TeamTaskItem;
    seq: number;
}
export interface TeamTaskInspection {
    /** Latest completion in the window; kept for callers that only need one. */
    latestCompletedTask?: TeamTaskItem;
    completedSeq?: number;
    /** Every task completed in the window, one entry per task id, oldest first. */
    completedTasks: CompletedTeamTask[];
    /** Known non-deleted tasks, including completed ones. */
    activeTasks: TeamTaskItem[];
    hasRecentCompletedTask: boolean;
}
export declare function inspectTeamTasks(events: readonly SessionEvent[], fromSeq?: number): TeamTaskInspection;
export declare function buildTeamTaskVerificationPrompt(task: TeamTaskItem, executionTrace: string, maxChars?: number): string;
//# sourceMappingURL=team-gate.d.ts.map