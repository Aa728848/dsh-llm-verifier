import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TeamTaskItem } from './router.ts'
import { sanitizeVerifierText } from './session.ts'

export interface TeamTaskInspection {
  latestCompletedTask?: TeamTaskItem
  completedSeq?: number
  activeTasks: TeamTaskItem[]
  hasRecentCompletedTask: boolean
}

export function inspectTeamTasks(events: readonly SessionEvent[], fromSeq = 0): TeamTaskInspection {
  let latestCompletedTask: TeamTaskItem | undefined
  let completedSeq: number | undefined
  const taskMap = new Map<string, TeamTaskItem>()

  for (const rawEvent of events) {
    const event = rawEvent as unknown as { type: string; seq: number; data: any }
    if (event.type === 'team/task') {
      const data = event.data as { task?: TeamTaskItem }
      if (data?.task) {
        taskMap.set(data.task.id, { ...data.task })
        if (event.seq >= fromSeq && data.task.status === 'completed') {
          latestCompletedTask = { ...data.task }
          completedSeq = event.seq
        }
      }
    }
  }

  return {
    latestCompletedTask,
    completedSeq,
    activeTasks: [...taskMap.values()].filter(t => t.status !== 'deleted'),
    hasRecentCompletedTask: latestCompletedTask !== undefined,
  }
}

export function buildTeamTaskVerificationPrompt(task: TeamTaskItem, executionTrace: string, maxChars = 20000): string {
  return [
    'You are an expert independent technical verifier reviewing a completed Agent Teams task.',
    'Verify if the task goal has been satisfied by concrete evidence (code edits, test runs, successful commands).',
    'Task Details:',
    'ID: ' + task.id,
    'Subject: ' + task.subject,
    task.description ? 'Description: ' + task.description : '',
    '',
    'Execution Evidence & Trace:',
    sanitizeVerifierText(executionTrace, maxChars),
    '',
    'Evaluate whether the task is genuinely completed with verified proof.',
    'Scoring criteria:',
    'A: Completely fulfilled with solid execution/test evidence.',
    'B-J: Mostly complete, minor gaps or edge cases not fully asserted.',
    'K-S: Incomplete, missing key requirements or untested.',
    'T: Unfulfilled, failed, or contradictory evidence.',
    '',
    'Output format:',
    'Line 1: Verdict: <Single uppercase letter A-T>',
    'Line 2: Summary: <One sentence evaluation of task fulfillment>',
    'Line 3+: Remaining gaps or next steps for the team.',
  ].filter(Boolean).join('\n\n')
}
