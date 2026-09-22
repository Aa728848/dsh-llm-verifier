/**
 * Read one session's event log.
 *
 * DSH 0.1.5 replaced the `events` array with `snapshotEvents()`; older hosts expose the array
 * directly. Both shapes are accepted so the plugin keeps working across the versions it declares
 * support for.
 *
 * DSH 0.1.6 deprecated `snapshotEvents()`: existing logic may stay unmigrated, but new calls are
 * prohibited, and so are wrappers that expose the same synchronous history — this function is such
 * a wrapper and is kept deliberately. The replacement the host offers, `SessionController.page()`,
 * is filtered to `user/message` and `assistant/message`, so `tool/call`, `tool/result` and the PTC
 * dispatches this plugin scores on do not come back through it; the host's own `auto-review`
 * carries the same waiver for the same reason. The migration is to maintain the evidence these
 * readers need through a registered Session projection instead of looking back through the log;
 * `AGENTS.md` records the decision and what would force it.
 * @param session - Agent session, or any object exposing one of the two shapes.
 * @returns The session's events in log order, or an empty array.
 */
export function sessionEvents(session) {
    const candidate = session;
    if (typeof candidate?.snapshotEvents === 'function')
        return candidate.snapshotEvents();
    return candidate?.events ?? [];
}
/**
 * Inner blocks of a pre-0.1.7 nested `tool-result` block.
 *
 * DSH 0.1.6 and earlier modelled a tool result as a `tool-result` content block wrapping the
 * result's own blocks inside the answering message. DSH 0.1.7 deleted that block type: the tool
 * result is now a tool-role message whose `content` IS those blocks. Both shapes are still read,
 * because the plugin declares support for hosts on either side of the change.
 * @param block - one content block, possibly the legacy wrapper.
 * @returns The wrapped blocks, or undefined when this is not a legacy wrapper.
 */
export function toolResultBlocks(block) {
    if (block.type !== 'tool-result')
        return undefined;
    const inner = block.content;
    return Array.isArray(inner) ? inner : undefined;
}
/**
 * Whether one tool result reports a failed invocation.
 *
 * DSH 0.1.7 moved the flag from the nested `tool-result` block onto the tool-role message itself
 * (`isError`); earlier hosts carry it on the block. Both are read so a failure is never scored as
 * a success on either host.
 * @param message - the `tool/result` event's message.
 * @returns True when either host's shape marks the invocation as failed.
 */
export function toolResultFailed(message) {
    if (message.isError === true)
        return true;
    return message.content.some(block => block.isError === true);
}
function textOf(blocks) {
    const parts = [];
    for (const block of blocks) {
        const blockType = block.type;
        if (blockType === 'text')
            parts.push(block.text);
        else if (blockType === 'reasoning')
            parts.push('[Reasoning] ' + block.text);
        else if (blockType === 'tool-call')
            parts.push('[Tool Call] ' + block.name + ' ' + block.arguments);
        else if (blockType === 'tool-result') {
            const nested = toolResultBlocks(block);
            if (nested)
                parts.push('[Tool Result] ' + textOf(nested));
        }
        else if (blockType === 'file') {
            const fileData = block;
            parts.push('[File] ' + (fileData.path ?? fileData.filename ?? fileData.title ?? 'attachment'));
        }
    }
    return parts.join('\n');
}
export const DEFAULT_REDACT_PATTERNS = [
    'Bearer\\s+[A-Za-z0-9._~+\\/=-]+',
    "(?:api[_-]?key|token|password|secret)\\s*[=:]\\s*[\"']?[^\\s,\"';}]+",
];
function validateRedactPattern(pattern) {
    if (pattern.length === 0 || pattern.length > 500)
        throw new Error('llm-verifier: redact patterns must contain 1-500 characters');
    // Reject common nested/unbounded constructs that can cause catastrophic backtracking.
    if (/\([^)]*[+*][^)]*\)[+*{]|\.\*[+*{]|\.\+[+*{]/u.test(pattern))
        throw new Error('llm-verifier: unsafe redact pattern');
}
export function redactText(text, patterns = DEFAULT_REDACT_PATTERNS) {
    let result = text;
    for (const pattern of patterns) {
        validateRedactPattern(pattern);
        let regex;
        try {
            regex = new RegExp(pattern, 'giu');
        }
        catch {
            throw new Error('llm-verifier: invalid redact pattern: ' + pattern);
        }
        result = result.replace(regex, '[REDACTED]');
    }
    return result;
}
export function sanitizeVerifierText(text, maxChars, patterns = DEFAULT_REDACT_PATTERNS) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1)
        throw new Error('llm-verifier: sanitizer maxChars must be a positive integer');
    const redacted = redactText(text, patterns).trim();
    if (redacted.length <= maxChars)
        return redacted;
    // The truncation notice is part of the returned value, so it must fit inside
    // the same budget. Callers such as boundDecision() treat maxChars as a hard
    // cap, so appending the notice past the cap would reject the whole decision
    // instead of using the truncated text.
    const notice = '\n[Truncated ' + (redacted.length - maxChars) + ' characters]';
    if (notice.length >= maxChars)
        return redacted.slice(0, maxChars);
    return redacted.slice(0, maxChars - notice.length) + notice;
}
export async function extractSession(agent, loadImage, options = {}) {
    const all = sessionEvents(agent.session);
    const from = options.fromSeq ?? 0;
    const to = options.toSeq ?? Number.MAX_SAFE_INTEGER;
    const events = all.filter(event => event.seq >= from && event.seq <= to);
    const patterns = [...DEFAULT_REDACT_PATTERNS, ...(options.redactPatterns ?? [])];
    let problem = '';
    const trace = [];
    const images = [];
    for (const rawEvent of events) {
        const event = rawEvent;
        if (event.type === 'user/message') {
            const sourceKind = event.data?.source?.kind;
            if (sourceKind !== 'user' && sourceKind !== 'team-message')
                continue;
            const text = textOf(event.data.content);
            // The window's FIRST user or team message is the task statement. `latestDirectUserSeq`
            // already treats a team-message as the task boundary, so extracting the problem only
            // from `user` left a teammate-only window with an empty problem and verifySession
            // rejected it as "no direct user task found" instead of verifying the assignment.
            if (!problem && (sourceKind === 'user' || sourceKind === 'team-message') && text.trim())
                problem = text.trim();
            for (const block of event.data.content)
                if (block.type === 'image')
                    images.push(await loadImage(block.attachment));
            const tag = sourceKind === 'team-message' ? 'Team Message' : 'User';
            trace.push('--- ' + tag + ' seq ' + event.seq + ' ---\n' + text);
        }
        else if (event.type === 'assistant/message' && options.includeAssistantText !== false) {
            trace.push('--- Assistant turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n' + textOf(event.data.message.content));
        }
        else if (event.type === 'tool/call') {
            trace.push('--- Tool Call turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Command] ' + event.data.name + ' ' + event.data.arguments);
        }
        else if (event.type === 'tool/result') {
            trace.push('--- Tool Result turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Output] ' + textOf(event.data.message.content));
        }
        else if (event.type === 'tool/ptc-dispatch' || event.type === 'tool/code-dispatch') {
            const data = event.data;
            const status = data.isError ? ' [Error]' : '';
            const args = data.arguments !== undefined ? ' ' + (typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments)) : '';
            const content = Array.isArray(data.content) ? textOf(data.content) : '';
            if (Array.isArray(data.content)) {
                for (const block of data.content) {
                    if (block.type === 'image')
                        images.push(await loadImage(block.attachment));
                }
            }
            const label = event.type === 'tool/ptc-dispatch' ? 'PTC Dispatch ' : 'Code Dispatch ';
            trace.push('--- ' + label + data.name + status + ' seq ' + event.seq + ' ---\n[Command] ' + data.name + args + '\n[Output] ' + content);
        }
        else if (event.type === 'team/message/queued') {
            const data = event.data;
            const sender = data?.message?.senderName ?? 'Teammate';
            const content = Array.isArray(data?.message?.content) ? textOf(data.message.content) : '';
            trace.push('--- Team Message Queued from ' + sender + ' seq ' + event.seq + ' ---\n' + content);
        }
    }
    const raw = redactText(trace.join('\n\n'), patterns);
    const maxChars = options.maxChars ?? 200000;
    if (!Number.isSafeInteger(maxChars) || maxChars < 1)
        throw new Error('llm-verifier: extractSession maxChars must be a positive integer');
    const omittedCharacters = Math.max(0, raw.length - maxChars);
    // The truncation notice is part of the returned value, so it has to fit inside the
    // same budget: callers treat maxChars as a hard cap (see sanitizeVerifierText). The
    // newest trace text is what the judge needs, so the head is what gets dropped.
    const notice = '[Earlier trace truncated: ' + omittedCharacters + ' characters omitted]\n';
    const bounded = omittedCharacters === 0
        ? raw
        : notice.length >= maxChars ? raw.slice(-maxChars) : notice + raw.slice(-(maxChars - notice.length));
    return { problem: redactText(problem, patterns), trace: bounded, images, sessionId: String(agent.id), fromSeq: events[0]?.seq ?? from, toSeq: events.at(-1)?.seq ?? from, omittedCharacters };
}
//# sourceMappingURL=session.js.map