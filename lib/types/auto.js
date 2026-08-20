const PASSIVE_TOOLS = new Set([
    'read', 'read_image', 'glob', 'grep', 'web_search', 'ssh_list', 'job_list',
    'job_output', 'list_agents', 'get_goal', 'skill', 'mcp__codegraph__codegraph_explore',
]);
const VERIFIER_TOOLS = new Set([
    'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_current_session',
]);
const CONSEQUENTIAL_TOOLS = new Set([
    'edit', 'write', 'pwsh', 'bash', 'run_code', 'codex_image_generate',
    'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_tunnel', 'ssh_cluster',
    'job_kill', 'workbench_session_delete', 'create_goal', 'update_goal',
]);
function latestDirectUserSeq(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'user/message' && event.data.source.kind === 'user')
            return event.seq;
    }
    return undefined;
}
function isConsequential(name) {
    if (CONSEQUENTIAL_TOOLS.has(name))
        return true;
    if (PASSIVE_TOOLS.has(name) || VERIFIER_TOOLS.has(name))
        return false;
    return /(?:edit|write|patch|apply|deploy|upload|delete|remove|kill|exec|shell|command|migration|database|tunnel|cluster)/iu.test(name);
}
export function analyzeAutoTask(events, policy) {
    const taskStartSeq = latestDirectUserSeq(events);
    if (taskStartSeq === undefined)
        return { taskStartSeq: 0, toolCalls: 0, completedToolResults: 0, consequentialToolCalls: 0, hasManualSessionVerification: false, eligible: false, reason: 'no-direct-user-task' };
    const relevant = events.filter(event => event.seq >= taskStartSeq);
    const calls = relevant.filter((event) => event.type === 'tool/call');
    const successfulResults = new Set(relevant.filter((event) => event.type === 'tool/result' && event.data.error === undefined && event.data.message.content.every(block => block.isError !== true)).map(event => String(event.data.message.source.callId)));
    const pairedCalls = calls.filter(event => successfulResults.has(String(event.data.callId)));
    const toolCalls = calls.filter(event => !VERIFIER_TOOLS.has(event.data.name)).length;
    const completedToolResults = pairedCalls.length;
    const consequentialToolCalls = pairedCalls.filter(event => isConsequential(event.data.name)).length;
    const hasManualSessionVerification = pairedCalls.some(event => event.data.name === 'verifier_current_session');
    if (policy.mode === 'manual')
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: false, reason: 'manual-mode' };
    if (hasManualSessionVerification)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: false, reason: 'already-verified' };
    if (consequentialToolCalls === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: false, reason: 'no-consequential-work' };
    if (completedToolResults === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: false, reason: 'no-completed-evidence' };
    if (policy.mode === 'smart' && toolCalls < policy.minToolCalls)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: false, reason: 'insufficient-tool-evidence' };
    return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, eligible: true, reason: policy.mode + '-eligible' };
}
export class AutoVerificationBudget {
    states = new Map();
    claim(agent, evidence, policy) {
        if (!evidence.eligible)
            return false;
        const id = String(agent.id);
        const previous = this.states.get(id);
        const state = previous ?? { taskStartSeq: evidence.taskStartSeq, taskAttempts: 0, sessionAttempts: 0, lastEvaluatedSeq: -1 };
        if (state.taskStartSeq !== evidence.taskStartSeq) {
            state.taskStartSeq = evidence.taskStartSeq;
            state.taskAttempts = 0;
            state.lastEvaluatedSeq = -1;
        }
        const lastSeq = agent.session.events.at(-1)?.seq ?? -1;
        if (lastSeq <= state.lastEvaluatedSeq || state.taskAttempts >= policy.maxPerTask || state.sessionAttempts >= policy.maxPerSession) {
            this.states.set(id, state);
            return false;
        }
        state.taskAttempts += 1;
        state.sessionAttempts += 1;
        state.lastEvaluatedSeq = lastSeq;
        this.states.set(id, state);
        return true;
    }
    release(agent) {
        this.states.delete(String(agent.id));
    }
}
export function automaticFeedback(score, baselineScore, winner, threshold) {
    const percent = (value) => (value * 100).toFixed(1) + '%';
    return [
        '[Automatic verifier gate]',
        `The independent verifier did not clear this task for completion: evidence score ${percent(score)}, baseline ${percent(baselineScore)}, verdict ${winner}, required ${percent(threshold)}.`,
        'Re-open the task requirements, inspect the actual tool outputs for unresolved errors or missing proof, make any necessary corrections, and run a directly relevant verification command before concluding. Do not merely restate that the task is complete.',
    ].join('\n');
}
//# sourceMappingURL=auto.js.map