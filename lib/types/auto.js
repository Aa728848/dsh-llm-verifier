import { sessionEvents } from "./session.js";
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
/**
 * Whether an agent session is a delegated child rather than the operator's own
 * topic. Child sessions are seeded with a real user message, so they look like
 * a fresh task to {@link analyzeAutoTask}; gate them only when asked.
 * @param agent - Agent (or any object exposing its session).
 * @returns True for subagent and forked-child sessions.
 */
export function isSubagentSession(agent) {
    const header = agent?.session?.header;
    return header?.origin === 'subagent' || header?.parentSession !== undefined;
}
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
/** Event names that carry one settled PTC/code dispatch, across the hosts the plugin supports. */
const CODE_DISPATCH_TYPES = new Set(['tool/code-dispatch', 'tool/ptc-dispatch']);
function isSuccessfulCodeDispatch(data) {
    if (data.isError === true)
        return false;
    if (Array.isArray(data.content) && data.content.some(b => b.isError === true))
        return false;
    return true;
}
export function analyzeAutoTask(events, policy) {
    const taskStartSeq = latestDirectUserSeq(events);
    if (taskStartSeq === undefined)
        return { taskStartSeq: 0, toolCalls: 0, completedToolResults: 0, consequentialToolCalls: 0, hasManualSessionVerification: false, eligible: false, reason: 'no-direct-user-task' };
    const relevant = events.filter(event => event.seq >= taskStartSeq);
    const calls = relevant.filter((event) => event.type === 'tool/call');
    const successfulResults = new Set(relevant.filter((event) => event.type === 'tool/result' && event.data.error === undefined && event.data.message.content.every(block => block.isError !== true)).map(event => String(event.data.message.source.callId)));
    const pairedCalls = calls.filter(event => successfulResults.has(String(event.data.callId)));
    // Both names exist in the wild: 0.1.5 emits tool/ptc-dispatch, older hosts tool/code-dispatch.
    const codeDispatches = relevant
        .filter(event => CODE_DISPATCH_TYPES.has(event.type))
        .map(event => event.data);
    const successfulDispatches = codeDispatches.filter(isSuccessfulCodeDispatch);
    const toolCalls = calls.filter(event => !VERIFIER_TOOLS.has(event.data.name)).length + codeDispatches.filter(d => !VERIFIER_TOOLS.has(d.name)).length;
    const completedToolResults = pairedCalls.length + successfulDispatches.length;
    const consequentialToolCalls = pairedCalls.filter(event => isConsequential(event.data.name)).length + successfulDispatches.filter(d => isConsequential(d.name)).length;
    const hasManualSessionVerification = pairedCalls.some(event => event.data.name === 'verifier_current_session') || successfulDispatches.some(d => d.name === 'verifier_current_session');
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
/**
 * Session/task acceptance budget.
 *
 * The automatic verifier enforces its per-task and per-session budget through
 * {@link AutoVerifierRouter} reservations, which also count the routing phases;
 * this standalone counter is kept as a public utility for orchestrators that
 * need the same accounting outside the router.
 */
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
        const lastSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1;
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