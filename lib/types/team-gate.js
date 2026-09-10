import { sanitizeVerifierText } from "./session.js";
export function inspectTeamTasks(events, fromSeq = 0) {
    let latestCompletedTask;
    let completedSeq;
    const taskMap = new Map();
    for (const rawEvent of events) {
        const event = rawEvent;
        if (event.type === 'team/task') {
            const data = event.data;
            if (data?.task) {
                taskMap.set(data.task.id, { ...data.task });
                if (event.seq >= fromSeq && data.task.status === 'completed') {
                    latestCompletedTask = { ...data.task };
                    completedSeq = event.seq;
                }
            }
        }
    }
    return {
        latestCompletedTask,
        completedSeq,
        activeTasks: [...taskMap.values()].filter(t => t.status !== 'deleted'),
        hasRecentCompletedTask: latestCompletedTask !== undefined,
    };
}
export function buildTeamTaskVerificationPrompt(task, executionTrace, maxChars = 20000) {
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
    ].filter(Boolean).join('\n\n');
}
//# sourceMappingURL=team-gate.js.map