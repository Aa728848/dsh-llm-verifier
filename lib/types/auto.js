// Shared with the router so both agree on what opens a task; imported (type-only in the
// other direction) rather than duplicated, because a drift here silently disables gating.
import { latestDirectUserSeq } from "./router.js";
import { sanitizeVerifierText } from "./session.js";
const PASSIVE_TOOLS = new Set([
    'read', 'read_image', 'glob', 'grep', 'web_search', 'ssh_list', 'job_list',
    'job_output', 'list_agents', 'get_goal', 'skill', 'mcp__codegraph__codegraph_explore',
]);
const VERIFIER_TOOLS = new Set([
    'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_best_of_n', 'verifier_current_session',
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
export function analyzeAutoTask(events, policy, sessionId) {
    const taskStartSeq = latestDirectUserSeq(events);
    if (taskStartSeq === undefined)
        return { taskStartSeq: 0, toolCalls: 0, completedToolResults: 0, consequentialToolCalls: 0, hasManualSessionVerification: false, manualVerificationAccepted: false, eligible: false, reason: 'no-direct-user-task' };
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
        if (!event.data.message.content.every(block => block.isError !== true))
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
    if (policy.mode === 'manual')
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'manual-mode' };
    if (manualVerificationAccepted)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'already-verified' };
    if (consequentialToolCalls === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'no-consequential-work' };
    if (completedToolResults === 0)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'no-completed-evidence' };
    if (policy.mode === 'smart' && toolCalls < policy.minToolCalls)
        return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'insufficient-tool-evidence' };
    return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: true, reason: policy.mode + '-eligible' };
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
export function automaticFeedback(score, baselineScore, winner, threshold, failedCriteria = [], locator) {
    const percent = (value) => (value * 100).toFixed(1) + '%';
    return [
        '[Automatic verifier gate]',
        `The independent verifier did not clear this task for completion: evidence score ${percent(score)}, baseline ${percent(baselineScore)}, verdict ${winner}, required ${percent(threshold)}.`,
        ...(failedCriteria.length > 0
            ? ['Criteria below the threshold: ' + failedCriteria.map(criterion => (criterion.name ?? criterion.id) + ' ' + percent(criterion.score)).join('; ') + '.']
            : ['The judge reported no per-criterion breakdown for this review, so there is no per-requirement locator to act on; the score and verdict above are the only evidence returned.']),
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
function locate(ref, budget) {
    const at = ref.fromSeq === undefined ? '' : ' @seq ' + ref.fromSeq + (ref.toSeq !== undefined && ref.toSeq !== ref.fromSeq ? '-' + ref.toSeq : '');
    const id = ref.id === undefined || ref.id === ref.label ? '' : ' (#' + ref.id + ')';
    return sanitizeVerifierText(ref.label + id + at, Math.max(8, Math.floor(budget)));
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
export function compareRouteFeedbackDetail(candidates, result, maxChars = MAX_ROUTE_FEEDBACK_CHARS) {
    const perItem = Math.max(48, Math.floor(maxChars / 6));
    const located = [locate(candidates[0], perItem), locate(candidates[1], perItem)];
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
        'Implement the winning candidate and verify the required work before concluding.',
    ].join('\n'));
}
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
export function selectRouteFeedbackDetail(candidates, result, maxChars = MAX_ROUTE_FEEDBACK_CHARS) {
    const perItem = Math.max(32, Math.floor(maxChars / Math.max(2, candidates.length + 3)));
    const located = candidates.map(candidate => locate(candidate, perItem));
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
        'Ranking (shares are relative preferences, not an absolute quality score, and a selection has no per-criterion breakdown):',
        ...order.map((index, rank) => (rank + 1) + '. ' + located[index] + ' (' + percent(result.scores[index] ?? 0) + ')'),
        'Proceed with ' + located[best] + ', implement it, and verify the required work before concluding.',
    ].join('\n'));
}
//# sourceMappingURL=auto.js.map