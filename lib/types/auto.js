// Shared with the router so both agree on what opens a task; imported (type-only in the
// other direction) rather than duplicated, because a drift here silently disables gating.
import { inspectDeliveryPhase, latestDirectUserSeq } from "./router.js";
import { renderDiagnostics } from "./core.js";
import { sanitizeVerifierText, toolResultFailed } from "./session.js";
const PASSIVE_TOOLS = new Set([
    'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'ssh_list', 'job_list',
    'job_output', 'list_agents', 'list_subagent_models', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
    'get_goal', 'skill', 'mcp__codegraph__codegraph_explore', 'ask_user_question',
    'todo_write', 'present', 'run_code',
]);
const VERIFIER_TOOLS = new Set([
    'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_best_of_n', 'verifier_current_session',
]);
const CONSEQUENTIAL_TOOLS = new Set([
    'edit', 'write', 'pwsh', 'bash', 'codex_image_generate',
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
const VERIFIER_SESSION_TOOL = 'verifier_current_session';
/** Concatenate the text of a rendered content-block list (tool result or dispatch payload). */
function blockText(value) {
    if (typeof value === 'string')
        return value;
    if (!Array.isArray(value))
        return '';
    const parts = [];
    for (const block of value) {
        if (block?.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
        else if (block?.type === 'tool-result')
            parts.push(blockText(block.content));
    }
    return parts.join('\n');
}
/**
 * Verdict carried by a completed `verifier_current_session` result.
 *
 * The tool renders its result as JSON, so the verdict is recovered from the emitted
 * text. An unreadable payload returns undefined and the manual review simply does
 * not count: a review that cannot be parsed must never be treated as a pass.
 *
 * The per-criterion field is `score` (the acceptance-facing shape `verifySession`
 * returns), NOT compare's `scoreA`. Reading `scoreA` here silently dropped every
 * criterion and let a verdict with a failed requirement disarm the gate; the raw
 * entry count is kept alongside the parsed rows so a payload whose criteria are
 * missing or malformed fails closed instead of defaulting to "all passed".
 * @param value - Result content blocks (or a raw string).
 * @returns The parsed verdict fields, or undefined.
 */
function parseSessionVerdict(value) {
    const text = blockText(value);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return undefined;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        const row = parsed;
        const entries = Array.isArray(row.criteria) ? row.criteria : [];
        const criteria = [];
        for (const entry of entries) {
            const item = typeof entry === 'object' && entry !== null ? entry : {};
            if (typeof item.id !== 'string' || typeof item.score !== 'number' || !Number.isFinite(item.score))
                continue;
            criteria.push({ id: item.id, ...(typeof item.name === 'string' ? { name: item.name } : {}), score: item.score });
        }
        return { winner: row.winner, score: row.score, criteria, criteriaCount: entries.length, sessionId: row.sessionId, fromSeq: row.fromSeq, toSeq: row.toSeq };
    }
    catch {
        return undefined;
    }
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
const SUBAGENT_TOOLS = new Set(['subagent', 'subagent_fork']);
const CONTINUABLE_SUBAGENT_START = /^\s*started subagent\s+([^\s`]+)/imu;
const BACKGROUND_SUBAGENT_JOB_START = /^\s*started background subagent job\s+([^\s`]+)/imu;
const GENERAL_SUBAGENT_START = /^\s*started (?:background )?subagent\b/imu;
/**
 * Whether background subagents started during the current task remain in flight.
 *
 * A background subagent returns immediately with a start receipt (`started subagent <id>`
 * or `started background subagent job <id>`) and settles later via a runtime-injected notice
 * (`source.kind === 'subagent-settled'` or a job settlement notice). Performing session
 * acceptance while subagents are in flight will always fail and steer prematurely because the
 * delegated work has not reported back yet.
 * @param events - session events.
 * @param taskStartSeq - sequence number of the current direct user task statement.
 * @returns True when at least one background subagent remains unsettled.
 */
export function hasPendingSubagents(events, taskStartSeq) {
    const relevant = events.filter(event => event.seq >= taskStartSeq);
    const pendingContinuable = new Map();
    const pendingJobs = new Map();
    let anonymousPendingCount = 0;
    const calls = new Map();
    for (const event of relevant) {
        if (event.type === 'tool/call')
            calls.set(String(event.data.callId), event);
    }
    for (const event of relevant) {
        if (event.type === 'tool/result') {
            const call = calls.get(String(event.data.message.source.callId));
            if (call && SUBAGENT_TOOLS.has(call.data.name) && event.data.error === undefined) {
                if (!toolResultFailed(event.data.message)) {
                    const text = blockText(event.data.message.content);
                    const contMatch = text.match(CONTINUABLE_SUBAGENT_START);
                    const jobMatch = text.match(BACKGROUND_SUBAGENT_JOB_START);
                    if (contMatch) {
                        pendingContinuable.set(contMatch[1], event.seq);
                    }
                    else if (jobMatch) {
                        pendingJobs.set(jobMatch[1], event.seq);
                    }
                    else if (GENERAL_SUBAGENT_START.test(text)) {
                        anonymousPendingCount += 1;
                    }
                }
            }
        }
        else if (CODE_DISPATCH_TYPES.has(event.type)) {
            const data = event.data;
            if (data && SUBAGENT_TOOLS.has(data.name) && isSuccessfulCodeDispatch(data)) {
                const text = blockText(data.content);
                const contMatch = text.match(CONTINUABLE_SUBAGENT_START);
                const jobMatch = text.match(BACKGROUND_SUBAGENT_JOB_START);
                if (contMatch) {
                    pendingContinuable.set(contMatch[1], event.seq);
                }
                else if (jobMatch) {
                    pendingJobs.set(jobMatch[1], event.seq);
                }
                else if (GENERAL_SUBAGENT_START.test(text)) {
                    anonymousPendingCount += 1;
                }
            }
        }
        if (event.type === 'user/message') {
            const source = event.data?.source;
            const text = blockText(event.data?.content);
            if (source?.kind === 'subagent-settled') {
                const senderId = typeof source.senderSessionId === 'string' ? source.senderSessionId : undefined;
                if (senderId && pendingContinuable.has(senderId)) {
                    pendingContinuable.delete(senderId);
                }
                else {
                    let found = false;
                    for (const [id] of pendingContinuable) {
                        if (text.includes(id)) {
                            pendingContinuable.delete(id);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        if (pendingContinuable.size > 0) {
                            const oldest = pendingContinuable.keys().next().value;
                            if (oldest !== undefined)
                                pendingContinuable.delete(oldest);
                        }
                        else if (anonymousPendingCount > 0) {
                            anonymousPendingCount -= 1;
                        }
                    }
                }
            }
            else if (source?.plugin === 'tool-jobs' || /background job\b.*finished/iu.test(text)) {
                for (const [jobId] of pendingJobs) {
                    if (text.includes(jobId)) {
                        pendingJobs.delete(jobId);
                        break;
                    }
                }
            }
        }
        if (event.type === 'tool/call') {
            const name = event.data.name;
            const argsText = event.data.arguments;
            let parsedArgs = {};
            if (typeof argsText === 'string') {
                try {
                    parsedArgs = JSON.parse(argsText);
                }
                catch { }
            }
            else if (typeof argsText === 'object' && argsText !== null) {
                parsedArgs = argsText;
            }
            if (name === 'interrupt_agent') {
                const target = String(parsedArgs.target ?? parsedArgs.agent_id ?? '');
                if (target && pendingContinuable.has(target))
                    pendingContinuable.delete(target);
            }
            else if (name === 'job_kill') {
                const jobId = String(parsedArgs.job_id ?? '');
                if (jobId && pendingJobs.has(jobId))
                    pendingJobs.delete(jobId);
            }
        }
        else if (CODE_DISPATCH_TYPES.has(event.type)) {
            const data = event.data;
            if (data) {
                const name = data.name;
                let parsedArgs = {};
                if (typeof data.arguments === 'string') {
                    try {
                        parsedArgs = JSON.parse(data.arguments);
                    }
                    catch { }
                }
                else if (typeof data.arguments === 'object' && data.arguments !== null) {
                    parsedArgs = data.arguments;
                }
                if (name === 'interrupt_agent') {
                    const target = String(parsedArgs.target ?? parsedArgs.agent_id ?? '');
                    if (target && pendingContinuable.has(target))
                        pendingContinuable.delete(target);
                }
                else if (name === 'job_kill') {
                    const jobId = String(parsedArgs.job_id ?? '');
                    if (jobId && pendingJobs.has(jobId))
                        pendingJobs.delete(jobId);
                }
            }
        }
    }
    return pendingContinuable.size > 0 || pendingJobs.size > 0 || anonymousPendingCount > 0;
}
function parseArgumentsObject(value) {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return typeof value === 'object' && value !== null ? value : {};
}
const USER_QUESTION_PATTERNS = [
    /[?？]\s*["'）)』」]*\s*$/u,
    /(?:请|麻烦您?)(?:告知|确认|指示|选择|提供|决定|回复)/u,
    /(?:等待|静待|等)(?:您的|你的|您|你|用户)?(?:确认|指示|回复|决定|指令|反馈|选择|输入)/u,
    /(?:如果您?|如|若)(?:希望|需要|想)(?:继续|执行).*(?:请|告诉我|告知)/u,
    /(?:是否|要不要|可否)(?:需要我?|继续|同意|允许|采用).*[？?]?/u,
    /(?:暂时|先|已)?暂停(?:工作|执行|后续).*(?:等|指示|确认|决定|用户)/u,
    /\b(?:please\s+(?:confirm|let\s+me\s+know|advise|choose|select|provide|indicate|tell\s+me|reply))\b/iu,
    /\b(?:waiting\s+for|awaiting)\s+(?:your\s+|user\s+)?(?:input|instructions?|reply|response|confirmation|decision|guidance|feedback)\b/iu,
    /\b(?:would\s+you\s+like|should\s+i|do\s+you\s+want\s+me\s+to|how\s+would\s+you\s+like|which\s+(?:option|approach|strategy)\s+do\s+you\s+prefer)\b/iu,
    /\b(?:let\s+me\s+know\s+(?:how|what|if|whether|when))\b/iu,
    /\b(?:paused?\s+(?:work|execution|here|for\s+now)|stopping\s+here)\b/iu,
];
export function isAwaitingUserText(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return false;
    const lastLine = trimmed.split('\n').filter(l => l.trim()).at(-1) ?? '';
    return USER_QUESTION_PATTERNS.some(p => p.test(lastLine) || p.test(trimmed));
}
function narrativeText(blocks) {
    if (typeof blocks === 'string')
        return blocks.trim();
    if (!Array.isArray(blocks))
        return '';
    const parts = [];
    for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
        else if (block?.type === 'tool-result')
            parts.push(blockText(block.content));
    }
    return parts.join('\n').trim();
}
/**
 * Whether the agent has paused to ask the user a question, obtain confirmation, or await user instructions.
 *
 * During task execution, an agent may legitimately pause to ask the operator a question
 * (e.g. calling `ask_user_question`, pausing/blocking a goal, or concluding a turn with prose
 * awaiting user guidance). Gating or steering in this state forces the model to keep executing,
 * overriding the user interaction boundary and locking the user out of providing guidance.
 *
 * Returns undefined when the work has already reached its delivery phase (all todos completed
 * with verification evidence), because in that state the agent is delivering the task rather than
 * pausing for input.
 */
export function inspectUserInteractionPause(events, taskStartSeq, currentTurn) {
    const delivery = inspectDeliveryPhase(events);
    if (delivery?.todosComplete && delivery.verification !== undefined) {
        return undefined;
    }
    let turnEvents = events;
    if (currentTurn !== undefined) {
        const turnStartIndex = events.findLastIndex(e => e.type === 'turn/start' && e.data.turn === currentTurn);
        if (turnStartIndex >= 0) {
            turnEvents = events.slice(turnStartIndex);
        }
        else {
            const byTurn = events.filter(e => e.data?.turn === currentTurn);
            if (byTurn.length > 0)
                turnEvents = byTurn;
        }
    }
    else {
        const lastTurnStart = events.findLastIndex(e => e.type === 'turn/start');
        if (lastTurnStart >= 0) {
            turnEvents = events.slice(lastTurnStart);
        }
    }
    let lastAskUserSeq = -1;
    for (const event of turnEvents) {
        if (event.type === 'tool/call') {
            const call = event;
            if (call.data.name === 'ask_user_question') {
                lastAskUserSeq = Math.max(lastAskUserSeq, event.seq);
            }
        }
        else if (CODE_DISPATCH_TYPES.has(event.type)) {
            const data = event.data;
            if (data?.name === 'ask_user_question') {
                lastAskUserSeq = Math.max(lastAskUserSeq, event.seq);
            }
        }
    }
    if (lastAskUserSeq >= 0) {
        const hasConsequentialAfter = turnEvents.some(event => {
            if (event.seq <= lastAskUserSeq)
                return false;
            if (event.type === 'tool/call') {
                return isConsequential(event.data.name);
            }
            if (CODE_DISPATCH_TYPES.has(event.type)) {
                const data = event.data;
                return data ? isConsequential(data.name) : false;
            }
            return false;
        });
        if (!hasConsequentialAfter) {
            return { paused: true, reason: 'ask_user_question in current turn' };
        }
    }
    const taskEvents = events.filter(e => e.seq >= taskStartSeq);
    let goalPhase;
    for (const event of taskEvents) {
        if (event.type === 'tool/call') {
            const call = event;
            if (call.data.name === 'update_goal') {
                const args = parseArgumentsObject(call.data.arguments);
                if (args.action === 'pause')
                    goalPhase = 'paused';
                else if (args.action === 'blocked')
                    goalPhase = 'blocked';
                else if (args.action === 'resume')
                    goalPhase = 'active';
                else if (args.action === 'complete')
                    goalPhase = 'complete';
            }
        }
        else if (CODE_DISPATCH_TYPES.has(event.type)) {
            const data = event.data;
            if (data?.name === 'update_goal') {
                const args = parseArgumentsObject(data.arguments);
                if (args.action === 'pause')
                    goalPhase = 'paused';
                else if (args.action === 'blocked')
                    goalPhase = 'blocked';
                else if (args.action === 'resume')
                    goalPhase = 'active';
                else if (args.action === 'complete')
                    goalPhase = 'complete';
            }
        }
    }
    if (goalPhase === 'paused' || goalPhase === 'blocked') {
        return { paused: true, reason: 'goal is ' + goalPhase };
    }
    const assistantMsgs = turnEvents.filter(e => e.type === 'assistant/message');
    const lastAssistant = assistantMsgs.at(-1);
    if (lastAssistant && lastAssistant.type === 'assistant/message') {
        const data = lastAssistant.data;
        const content = data.message?.content ?? [];
        const hasToolCalls = content.some(b => b.type === 'tool-call');
        if (!hasToolCalls) {
            const text = narrativeText(content);
            if (text && isAwaitingUserText(text)) {
                return { paused: true, reason: 'assistant awaiting user instructions' };
            }
        }
    }
    return undefined;
}
/**
 * Whether the session is currently in plan mode.
 *
 * The host logs one `plan/mode` event per committed transition and folds the log as
 * "empty log → inactive, last event wins" (its own projection does exactly this). Hosts
 * without plan mode never log the event, so nothing changes there. While planning, the
 * agent is expected to research and PROPOSE: any automatic route or acceptance verdict at
 * the turn-stopping boundary can only fail against the missing implementation and steer
 * "actually implement it" — commanding execution the human has not approved yet. The
 * `exit_plan_mode` pre-review is the one gate that still runs in this state.
 * @param events - Session event log (the whole log is folded; the mode may predate the task).
 * @returns True when the newest `plan/mode` event activated plan mode.
 */
export function planModeActive(events) {
    let active = false;
    for (const event of events) {
        if (event.type !== 'plan/mode')
            continue;
        active = event.data?.active === true;
    }
    return active;
}
export function analyzeAutoTask(events, policy, sessionId) {
    const taskStartSeq = latestDirectUserSeq(events);
    if (taskStartSeq === undefined)
        return { taskStartSeq: 0, toolCalls: 0, completedToolResults: 0, consequentialToolCalls: 0, hasManualSessionVerification: false, manualVerificationAccepted: false, pendingSubagents: false, pendingUserInteraction: false, planMode: planModeActive(events), eligible: false, reason: 'no-direct-user-task' };
    const relevant = events.filter(event => event.seq >= taskStartSeq);
    const calls = relevant.filter((event) => event.type === 'tool/call');
    const results = new Map();
    // Every settled result, successful or not: freshness has to see a FAILED command as work
    // too. A post-verdict run that edits a file and then fails its test still changed the
    // session state, so the earlier verdict no longer covers it.
    const allResults = new Map();
    for (const event of relevant) {
        if (event.type !== 'tool/result')
            continue;
        allResults.set(String(event.data.message.source.callId), event);
        if (event.data.error !== undefined)
            continue;
        if (toolResultFailed(event.data.message))
            continue;
        results.set(String(event.data.message.source.callId), event);
    }
    const pairedCalls = calls.filter(event => results.has(String(event.data.callId)));
    // Both names exist in the wild: 0.1.5 emits tool/ptc-dispatch, older hosts tool/code-dispatch.
    const dispatches = relevant
        .filter(event => CODE_DISPATCH_TYPES.has(event.type))
        .map(event => ({ seq: event.seq, data: event.data }));
    const successfulDispatches = dispatches.filter(entry => isSuccessfulCodeDispatch(entry.data));
    const toolCalls = calls.filter(event => !VERIFIER_TOOLS.has(event.data.name)).length + dispatches.filter(entry => !VERIFIER_TOOLS.has(entry.data.name)).length;
    const completedToolResults = pairedCalls.length + successfulDispatches.length;
    const consequentialToolCalls = pairedCalls.filter(event => isConsequential(event.data.name)).length + successfulDispatches.filter(entry => isConsequential(entry.data.name)).length;
    // A manual session verification only stands in for the automatic gate when it actually
    // passed the configured threshold AND the reviewed interval still covers everything that
    // settled afterwards. Staleness is measured against the verdict's own `toSeq` (what it
    // actually read), not the sequence of its result, and it counts EVERY settled result —
    // including failed ones. A review that only read up to seq 2 must not stand in for work
    // completed at seq 6 while it was running, and a failed post-pass command must not leave
    // the earlier pass valid either.
    const completedWork = [
        ...calls.filter(event => allResults.has(String(event.data.callId))).map(event => ({ seq: allResults.get(String(event.data.callId)).seq, name: event.data.name })),
        ...dispatches.map(entry => ({ seq: entry.seq, name: entry.data.name })),
    ];
    const stale = (coveredTo) => completedWork.some(entry => entry.seq > coveredTo && isConsequential(entry.name));
    // One entry per completed call, unreadable payloads included: "did the agent try an
    // explicit review" is a separate fact from "did that review pass".
    const manualVerdicts = [];
    for (const event of pairedCalls) {
        if (event.data.name !== VERIFIER_SESSION_TOOL)
            continue;
        const result = results.get(String(event.data.callId));
        if (result === undefined)
            continue;
        manualVerdicts.push(parseSessionVerdict(result.data.message.content));
    }
    for (const entry of successfulDispatches) {
        if (entry.data.name !== VERIFIER_SESSION_TOOL)
            continue;
        manualVerdicts.push(parseSessionVerdict(entry.data.content));
    }
    const hasManualSessionVerification = manualVerdicts.length > 0;
    // Same acceptance rule as the automatic gate, including the per-criterion floor, and
    // strictly fail-closed on anything the payload did not actually establish: a verdict
    // whose criteria are missing or malformed, whose interval does not start inside the
    // current task, whose toSeq predates later consequential work, or that belongs to a
    // different session must never disarm the gate.
    const manualVerificationAccepted = manualVerdicts.some(verdict => {
        if (verdict === undefined)
            return false;
        if (verdict.criteriaCount === 0 || verdict.criteria.length !== verdict.criteriaCount)
            return false;
        if (typeof verdict.fromSeq !== 'number' || !Number.isSafeInteger(verdict.fromSeq))
            return false;
        if (typeof verdict.toSeq !== 'number' || !Number.isSafeInteger(verdict.toSeq))
            return false;
        if (verdict.fromSeq > taskStartSeq)
            return false;
        if (sessionId !== undefined && verdict.sessionId !== sessionId)
            return false;
        if (verdict.winner !== 'A' || typeof verdict.score !== 'number' || !Number.isFinite(verdict.score))
            return false;
        return sessionAccepted({ score: verdict.score, winner: 'A', criteria: verdict.criteria }, policy.threshold) && !stale(verdict.toSeq);
    });
    const pendingSubagents = hasPendingSubagents(events, taskStartSeq);
    const userPause = inspectUserInteractionPause(events, taskStartSeq);
    const pendingUserInteraction = userPause !== undefined;
    const planMode = planModeActive(events);
    if (policy.mode === 'manual')
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: false, reason: 'manual-mode' };
    // Planning is the operator's review boundary, checked before every other suppression: an
    // acceptance verdict here could only fail against the missing implementation and command
    // execution the human has not approved yet.
    if (planMode)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode: true, eligible: false, reason: 'plan-mode-active' };
    if (manualVerificationAccepted)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: false, reason: 'already-verified' };
    if (pendingSubagents)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents: true, pendingUserInteraction, planMode, eligible: false, reason: 'pending-subagents' };
    if (pendingUserInteraction)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction: true, planMode, eligible: false, reason: 'user-interaction-paused' };
    if (consequentialToolCalls === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: false, reason: 'no-consequential-work' };
    if (completedToolResults === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: false, reason: 'no-completed-evidence' };
    if (policy.mode === 'smart' && toolCalls < policy.minToolCalls)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: false, reason: 'insufficient-tool-evidence' };
    return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, pendingSubagents, pendingUserInteraction, planMode, eligible: true, reason: policy.mode + '-eligible' };
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
export function failedAcceptanceCriteria(criteria, threshold) {
    return (criteria ?? []).filter(criterion => !(criterion.score >= threshold));
}
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
export function sessionAccepted(evidence, threshold) {
    if (evidence.winner !== 'A' || !(evidence.score >= threshold))
        return false;
    return failedAcceptanceCriteria(evidence.criteria, threshold).length === 0;
}
export function automaticFeedback(score, baselineScore, winner, threshold, failedCriteria = [], locator, reportedCriteria, diagnostics = []) {
    const percent = (value) => (value * 100).toFixed(1) + '%';
    // P04: located findings beat a generic "inspect the output yourself" — and when the judge reported
    // none, saying so is better than inventing a cause the judge never named.
    const located = renderDiagnostics(diagnostics, 1600);
    const diagnosticLines = located === ''
        ? failedCriteria.length > 0
            ? ['The judge did not report any located finding for the failing criteria, so there is no specific cause to act on. The criteria named above are the only locator available: re-read each one against the observed output yourself.']
            : []
        : [located];
    return [
        '[Automatic verifier gate]',
        `The independent verifier did not clear this task for completion: evidence score ${percent(score)}, baseline ${percent(baselineScore)}, verdict ${winner}, required ${percent(threshold)}.`,
        ...(failedCriteria.length > 0
            ? ['Criteria below the threshold: ' + failedCriteria.map(criterion => (criterion.name ?? criterion.id) + ' ' + percent(criterion.score)).join('; ') + '.']
            // "No criterion failed" and "the judge reported no criteria at all" are different
            // situations: claiming a missing breakdown when every criterion passed and only the
            // verdict was a tie tells the agent to look for evidence that is right there.
            : reportedCriteria === 0
                ? ['The judge reported no per-criterion breakdown for this review, so there is no per-requirement locator to act on; the score and verdict above are the only evidence returned.']
                : []),
        ...diagnosticLines,
        ...(winner !== 'A' ? ['The verdict did not favour the session over the empty-work baseline.'] : []),
        ...(locator === undefined
            ? []
            : ['Reviewed range: ' + (locator.sessionId === undefined ? 'this session' : 'session ' + locator.sessionId) + ' seq ' + (locator.fromSeq ?? 0) + '-' + (locator.toSeq ?? 0) + '.']),
        ...(locator?.omittedCharacters !== undefined && locator.omittedCharacters > 0
            ? [locator.omittedCharacters + ' characters of earlier evidence were omitted by the length bound, so a requirement met only there may not have been visible to the judge.']
            : []),
        'Re-open the task requirements, inspect the actual tool outputs for unresolved errors or missing proof, make any necessary corrections, and run a directly relevant verification command before concluding. Do not merely restate that the task is complete.',
    ].join('\n');
}
/** One automatic feedback message may not exceed this many characters, fixed wording included. */
export const MAX_ROUTE_FEEDBACK_CHARS = 4000;
function percent(value) {
    return (Number.isFinite(value) ? value * 100 : 0).toFixed(1) + '%';
}
/**
 * Render one candidate locator within a character budget.
 *
 * Deliberately a label plus an identity/event position rather than the candidate's text:
 * the feedback must let the agent find the object it is being told about, and copying the
 * candidate into the message would pay the evidence budget twice.
 */
function locate(ref, budget, ordinal) {
    const limit = Math.max(10, Math.floor(budget));
    const position = '[' + ordinal + ']';
    const at = ref.fromSeq === undefined ? '' : ' @seq ' + ref.fromSeq + (ref.toSeq !== undefined && ref.toSeq !== ref.fromSeq ? '-' + ref.toSeq : '');
    const id = ref.id === undefined || ref.id === ref.label ? '' : ' (#' + ref.id + ')';
    // The ordinal is allocated FIRST and always survives, then the event position, and only then
    // the label: truncating label + id + seq together used to delete the distinguishing part of a
    // long id AND the position, leaving same-named candidates impossible to locate. The id is
    // included only when it fits; the ordinal is the locator of last resort.
    const fixed = position + at;
    if (fixed.length >= limit)
        return sanitizeVerifierText(fixed, limit);
    const withId = fixed.length + id.length + 2 < limit ? id : '';
    const labelBudget = Math.max(1, limit - fixed.length - withId.length - 1);
    const label = ref.label.length > labelBudget ? ref.label.slice(0, Math.max(1, labelBudget - 1)) + '…' : ref.label;
    return sanitizeVerifierText(position + ' ' + label + withId + at, limit);
}
/**
 * Indices sharing the highest score.
 *
 * The engine breaks ties by index, so "the first entry of the ranking" is a stable sort
 * artefact — exactly what S04 forbids presenting as a unique winner.
 * @param scores - candidate scores in candidate order.
 * @returns The tied-for-top indices, empty when no score is finite.
 */
export function topScoreIndices(scores) {
    const finite = scores.filter(score => Number.isFinite(score));
    if (finite.length === 0)
        return [];
    const best = Math.max(...finite);
    return scores.map((score, index) => ({ score, index })).filter(row => Number.isFinite(row.score) && row.score === best).map(row => row.index);
}
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
export function compareRouteFeedbackDetail(candidates, result, maxChars = MAX_ROUTE_FEEDBACK_CHARS, stage = 'artifact') {
    const perItem = Math.max(48, Math.floor(maxChars / 6));
    const located = [locate(candidates[0], perItem, 1), locate(candidates[1], perItem, 2)];
    const bound = (text) => sanitizeVerifierText(text, maxChars);
    if (result.identical === true) {
        return bound([
            'The two candidates are byte-identical, so the judge performed NO quality comparison (both sides read as 0.5). Do not buy this comparison again: produce genuinely different options, or proceed with the shared content.',
            'Candidate A: ' + located[0],
            'Candidate B: ' + located[1],
        ].join('\n'));
    }
    if (result.winner === 'tie') {
        return bound([
            'The judge scored both candidates identically (' + percent(result.scoreA) + ' / ' + percent(result.scoreB) + '), so there is NO unique winner. Do not treat the first-listed candidate as the winner.',
            'Choose between them on grounds the judge cannot see (fit, risk, cost), or make the options genuinely distinguishable, then implement and verify the required work.',
            'Tied candidates:',
            '- ' + located[0],
            '- ' + located[1],
        ].join('\n'));
    }
    const winnerIndex = result.winner === 'A' ? 0 : 1;
    const winning = result.winner === 'A' ? result.scoreA : result.scoreB;
    const losing = result.winner === 'A' ? result.scoreB : result.scoreA;
    return bound([
        'Winner: ' + located[winnerIndex] + ' (' + percent(winning) + ' vs ' + percent(losing) + ').',
        // A proposal comparison ranks PLANS: the higher score says "more promising", never "already done".
        ...(stage === 'proposal' ? [PROPOSAL_FEEDBACK_NOTE] : []),
        'Implement the winning candidate and verify the required work before concluding.',
    ].join('\n'));
}
/**
 * What a proposal verdict does and does not mean.
 *
 * The two stages produce the same numbers from different questions, and reading a proposal win as
 * evidence that the work is done is exactly the confusion the stage split exists to prevent.
 */
export const PROPOSAL_FEEDBACK_NOTE = 'This was a PROPOSAL review: neither side has been executed, so the score compares plans, not results. A higher score means more promising, NOT more reliable or already done — implement it and verify the required work before treating anything as complete.';
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
export function selectRouteFeedbackDetail(candidates, result, maxChars = MAX_ROUTE_FEEDBACK_CHARS, stage = 'artifact') {
    const perItem = Math.max(32, Math.floor(maxChars / Math.max(2, candidates.length + 3)));
    const located = candidates.map((candidate, index) => locate(candidate, perItem, index + 1));
    const bound = (text) => sanitizeVerifierText(text, maxChars);
    if (result.identical === true) {
        return bound([
            'All ' + candidates.length + ' candidates are byte-identical, so NO ranking was computed (every score is 0.5). Do not buy this comparison again: produce genuinely different options, or proceed with the shared content.',
            ...candidates.map((_, index) => '- ' + located[index]),
        ].join('\n'));
    }
    const top = topScoreIndices(result.scores);
    if (top.length === 0) {
        return 'The judge returned no usable candidate scores for this selection, so there is NO result to act on. Re-run it with real candidates, or continue the work without treating any option as chosen.';
    }
    if (top.length > 1) {
        return bound([
            'The top score is shared by ' + top.length + ' candidates (' + top.map(index => percent(result.scores[index] ?? 0)).join(' / ') + '), so there is NO unique best. The engine listing is a stable sort, not a verdict.',
            'Choose among them on grounds the judge cannot see (fit, risk, cost), or make the candidates genuinely distinguishable, then implement and verify the required work.',
            'Tied candidates:',
            ...top.map(index => '- ' + located[index] + ' (' + percent(result.scores[index] ?? 0) + ')'),
        ].join('\n'));
    }
    const best = top[0];
    const order = result.ranking.length > 0 ? [...result.ranking] : candidates.map((_, index) => index);
    return bound([
        ...(stage === 'proposal' ? [PROPOSAL_FEEDBACK_NOTE] : []),
        'Ranking (shares are relative preferences, not an absolute quality score, and a selection has no per-criterion breakdown):',
        ...order.map((index, rank) => (rank + 1) + '. ' + located[index] + ' (' + percent(result.scores[index] ?? 0) + ')'),
        'Proceed with ' + located[best] + ', implement it, and verify the required work before concluding.',
    ].join('\n'));
}
//# sourceMappingURL=auto.js.map