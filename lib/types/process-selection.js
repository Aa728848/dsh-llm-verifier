/**
 * P06: default-off request-level selection over the host's \`llm/stream\` waterfall.
 *
 * The one place in the plugin that can shape the NEXT assistant reply instead of reviewing
 * something already produced. It is deliberately narrow:
 *
 * - off unless \`autoProcessSelection\` is on AND the mode is smart;
 * - N=2 (the original reply and exactly one generated alternative), one cycle per task;
 * - it fires only when the two most recent completed verification runs BOTH failed
 *   ({@link inspectRecoverySignal}), and only for the next real main-loop request;
 * - the winning stream is replayed chunk by chunk, so tool-call identity, \`finish\` metadata and
 *   provider replay state reach the host untouched;
 * - a selection is never an acceptance: the cycle arms the ordinary final gate.
 *
 * Nothing is exposed to the host before the decision, so a declined cycle costs the added
 * generation (and possibly one comparison) but never half a reply.
 */
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { addUsage, emptyUsage } from "./caller.js";
import { stableHash } from "./cache.js";
import { PROPOSAL_CRITERIA } from "./core.js";
import { mergeRunStats } from "./engine.js";
/**
 * Buffered characters allowed per candidate stream.
 *
 * The plan fixes the first version at 1 MiB. It is a hard boundary in BOTH directions: the
 * original stream overrunning it abandons selection and continues streaming untouched, and the
 * alternative overrunning it is discarded in favour of the complete original reply.
 */
export const PROCESS_CANDIDATE_CAP_CHARS = 1_048_576;
/** How long a registered intent may wait for its request before it is considered stale. */
export const PROCESS_INTENT_TTL_MS = 120_000;
/**
 * Comparison rounds for the process cycle.
 *
 * Even on purpose: \`VerifierEngine.compare\` only swaps the A/B slots on odd repeats, and the
 * whole point of this cycle is deciding which of two replies the host should execute.
 */
export const PROCESS_REPEATS = 2;
/** Records kept in the durable per-topic cycle log. */
export const PROCESS_MAX_RECORDS = 200;
/**
 * Durable cycle log beside the score cache of one topic.
 *
 * Shares the topic directory on purpose: deleting the conversation removes the record of its
 * purchases with it, exactly like the score cache and the statistics log.
 * @param cacheFile - resolved \`scores-v1.json\` of the topic.
 * @returns Path of the process-selection log.
 */
export function resolveProcessFile(cacheFile) {
    return join(dirname(cacheFile), 'process-selection-v1.json');
}
/** Characters one chunk contributes to the buffer cap. */
export function measureChunk(chunk) {
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')
        return chunk.text.length;
    if (chunk.type === 'tool-call-delta')
        return chunk.argumentsDelta.length;
    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call')
        return chunk.block.arguments.length;
    return 0;
}
/**
 * Prose and actions of one buffered reply.
 *
 * Transport-level fields (call ids, usage, indices, replay state) are deliberately dropped: two
 * replies that differ only in a fresh \`callId\` are the same plan, and treating them as different
 * candidates would buy a comparison that cannot distinguish anything.
 */
export function renderCandidate(chunks) {
    const text = [];
    const actions = [];
    for (const chunk of chunks) {
        if (chunk.type === 'text-delta')
            text.push(chunk.text);
        else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call')
            actions.push(chunk.block.name + '(' + chunk.block.arguments + ')');
    }
    return { text: text.join('').trim(), actions };
}
/** Stage-and-content identity of one candidate, ignoring every transport-level field. */
export function candidateIdentity(candidate) {
    return stableHash({ text: candidate.text, actions: [...candidate.actions] });
}
/** Whether a buffered stream ended in a finish the host can act on. */
export function finishKind(chunks) {
    let kind;
    for (const chunk of chunks)
        if (chunk.type === 'finish')
            kind = chunk.reason.kind;
    return kind;
}
/** Usage reported by the LAST \`usage\` chunk of one dispatched stream. */
export function usageFromChunks(chunks) {
    let tokens;
    for (const chunk of chunks)
        if (chunk.type === 'usage')
            tokens = chunk.usage;
    if (tokens === undefined) {
        // One dispatch really happened; only its token counts are unknown.
        const unknown = emptyUsage();
        unknown.calls = 1;
        unknown.attempts = 1;
        unknown.usageIncomplete = true;
        return unknown;
    }
    return {
        calls: 1,
        attempts: 1,
        retries: 0,
        inputTokens: tokens.inputTokens ?? 0,
        cachedInputTokens: (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0),
        outputTokens: tokens.outputTokens ?? 0,
        reasoningTokens: tokens.reasoningTokens ?? 0,
    };
}
/**
 * Build the alternative reply's request from the frozen original.
 *
 * Copying only the effective call configuration keeps the same model and sampling while giving
 * the alternative its own lifecycle; the process-local "this is an agent-loop request" marker is
 * deliberately NOT copied, and neither is \`sessionId\`, so the alternative can never be mistaken
 * for (or recurse into) a main-loop request.
 */
export function buildAlternativeRequest(options, signal) {
    return {
        provider: options.provider,
        model: options.model,
        messages: options.messages,
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
        ...(options.system === undefined ? {} : { system: options.system }),
        ...(options.tools === undefined ? {} : { tools: options.tools }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(options.stop === undefined ? {} : { stop: options.stop }),
        signal,
    };
}
/**
 * Render one bounded candidate view for the judge.
 *
 * The whole evidence budget is split across the two candidates, so the combined request can never
 * exceed it and \`boundDecision\`-style dropping cannot silently disable the comparison.
 * @param candidate - prose and actions of one reply.
 * @param budget - characters this candidate may occupy.
 * @returns The rendered block body.
 */
export function renderCandidateView(candidate, budget) {
    const actions = candidate.actions.length === 0 ? '(no tool calls)' : candidate.actions.map(action => '[tool-call] ' + action).join('\n');
    const actionBudget = Math.min(actions.length, Math.max(0, Math.floor(budget / 2)));
    const proseBudget = Math.max(0, budget - actionBudget);
    const prose = candidate.text.length > proseBudget ? candidate.text.slice(0, Math.max(0, proseBudget - 1)) + '…' : candidate.text;
    const clipped = actions.length > actionBudget ? actions.slice(0, Math.max(0, actionBudget - 1)) + '…' : actions;
    return ('Tool calls:\n' + clipped + '\n\nReply text:\n' + (prose || '(empty)')).slice(0, Math.max(1, budget));
}
function validRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.cycleId === 'string' && typeof row.sessionId === 'string'
        && typeof row.taskStartSeq === 'number' && Number.isSafeInteger(row.taskStartSeq)
        && typeof row.signal === 'string' && typeof row.startedAt === 'number' && Number.isFinite(row.startedAt);
}
/**
 * Durable per-topic log of purchased process cycles.
 *
 * A purchase must survive a plugin reload: the in-memory router counter cannot, and without the
 * sidecar a reload would let the same stuck task buy a second cycle. A failed read is treated as
 * "do not buy" rather than "probably fine" — see {@link lookup}.
 */
export class ProcessCycleStore {
    file;
    max;
    loaded = false;
    records = [];
    writing = Promise.resolve();
    constructor(file, max = PROCESS_MAX_RECORDS) {
        this.file = file;
        this.max = max;
    }
    async load() {
        if (this.loaded)
            return;
        try {
            const document = JSON.parse(await readFile(this.file, 'utf8'));
            this.records = document?.version === 1 && Array.isArray(document.records) ? document.records.filter(validRecord).slice(-this.max) : [];
            this.loaded = true;
        }
        catch (error) {
            // A missing log is the normal first-run state, not a failure: the topic simply never bought
            // a cycle. Anything else (a directory, bad permissions, invalid JSON) propagates so the
            // caller can refuse to buy.
            if (error.code !== 'ENOENT')
                throw error;
            this.records = [];
            this.loaded = true;
        }
    }
    /**
     * Whether this task already bought a process cycle.
     *
     * \`ok: false\` means the log could not be read, and the caller must NOT buy: an unreadable log
     * is indistinguishable from "already purchased", and the safe side of that ambiguity is to
     * keep the original path.
     * @param sessionId - session owning the cycle.
     * @param taskStartSeq - task boundary sequence of the cycle.
     * @returns Read status plus whether a record already exists.
     */
    async lookup(sessionId, taskStartSeq) {
        try {
            await this.load();
            return { ok: true, purchased: this.records.some(record => record.sessionId === sessionId && record.taskStartSeq === taskStartSeq) };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { ok: true, purchased: false };
            return { ok: false, purchased: false, reason: error instanceof Error ? error.message : String(error) };
        }
    }
    /**
     * Write the start record BEFORE any added model call.
     * @param record - the purchase to remember.
     * @returns False when the record could not be persisted; the caller must not buy.
     */
    async begin(record) {
        try {
            await this.load();
            this.records.push(record);
            if (this.records.length > this.max)
                this.records = this.records.slice(-this.max);
            await this.persist();
            return true;
        }
        catch {
            return false;
        }
    }
    /** Attach the outcome of a purchased cycle to its record (best effort). */
    async finish(cycleId, outcome, replayed) {
        try {
            await this.load();
            const record = this.records.find(entry => entry.cycleId === cycleId);
            if (record === undefined)
                return;
            record.outcome = outcome;
            record.replayed = replayed;
            await this.persist();
        }
        catch { /* the log is diagnostic; a failed update never changes a decision */ }
    }
    async persist() {
        const snapshot = { version: 1, records: this.records };
        this.writing = this.writing.catch(() => { }).then(async () => {
            await mkdir(dirname(this.file), { recursive: true });
            const temporary = this.file + '.tmp-' + process.pid;
            await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
            try {
                await rename(temporary, this.file);
            }
            catch (error) {
                await unlink(temporary).catch(() => { });
                throw error;
            }
        });
        await this.writing;
    }
}
/**
 * The selector itself: intent bookkeeping plus the \`llm/stream\` body.
 *
 * Kept as one class rather than free functions because the intent map and the request-local
 * re-entrancy guard are per-plugin-instance state; every decision point reads settings and budget
 * fresh, so a settings change or a spent budget is honoured without restarting anything.
 */
export class ProcessSelector {
    deps;
    intents = new Map();
    /** Requests this plugin dispatched itself (the alternative reply): never a selection subject. */
    internal = new WeakSet();
    constructor(deps) {
        this.deps = deps;
    }
    /** Register (or replace) the pending intent of one session. */
    register(intent) { this.intents.set(intent.sessionId, intent); }
    /** Drop a session's pending intent (new task, settings change, disposal). */
    clear(sessionId) { this.intents.delete(sessionId); }
    /** Drop every pending intent (settings change, host shutdown). */
    clearAll() { this.intents.clear(); }
    /** Whether a session already has an intent waiting for its next request. */
    pending(sessionId) { return this.intents.has(sessionId); }
    /**
     * Match and consume the intent for one real main request.
     *
     * The request must be a host-stamped agent-loop request with the registered session id; our own
     * auxiliary dispatches and every other plugin's calls therefore pass straight through. The
     * intent is consumed on a match — even when the cycle is then declined — so it can never leak
     * into a later request, and a mismatched session leaves it untouched.
     * @param options - the request entering the waterfall.
     * @returns The consumed intent, or undefined to delegate untouched.
     */
    take(options) {
        if (typeof options !== 'object' || options === null)
            return undefined;
        if (this.internal.has(options))
            return undefined;
        if (!isAgentLoopRequest(options))
            return undefined;
        const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId);
        if (sessionId === undefined)
            return undefined;
        const intent = this.intents.get(sessionId);
        if (intent === undefined)
            return undefined;
        this.intents.delete(sessionId);
        const settings = this.deps.settings();
        if (!settings.active || !settings.smart)
            return undefined;
        if (this.deps.now() - intent.registeredAt > PROCESS_INTENT_TTL_MS) {
            this.deps.logger.warn('llm-verifier process selection: the registered intent expired before its request arrived; passing the request through');
            return undefined;
        }
        if (!this.deps.current(intent)) {
            this.deps.logger.warn('llm-verifier process selection: the intent no longer belongs to the current task; passing the request through');
            return undefined;
        }
        return intent;
    }
    /**
     * The waterfall body.
     *
     * \`next()\` is called exactly once. The original reply is buffered first; only after it is
     * complete and inside the cap is the alternative generated, and only a judge-selected winner is
     * replayed. Every decline replays the buffered original verbatim.
     * @param options - the matched main request.
     * @param next - the downstream dispatch (called once).
     * @param intent - the consumed intent.
     * @returns The chunks the host will consume.
     */
    async *handle(options, next, intent) {
        const startedAt = this.deps.now();
        const settings = this.deps.settings();
        const original = [];
        let heldChars = 0;
        let overflow = false;
        for await (const chunk of next()) {
            if (overflow) {
                yield chunk;
                continue;
            }
            original.push(chunk);
            heldChars += measureChunk(chunk);
            if (heldChars > PROCESS_CANDIDATE_CAP_CHARS) {
                // Over the cap: stop selecting, flush what was held (in order) and pass the rest through.
                // The iterator is never abandoned, so the host still receives one complete reply.
                overflow = true;
                for (const held of original)
                    yield held;
                original.length = 0;
            }
        }
        if (overflow) {
            await this.skip(startedAt, intent, 'original-over-cap', 'the original reply exceeded the process-selection buffer cap');
            return;
        }
        const rendered = renderCandidate(original);
        const finish = finishKind(original);
        const upstreamUsage = usageFromChunks(original);
        if (finish !== 'stop' && finish !== 'tool-calls') {
            for (const chunk of original)
                yield chunk;
            await this.skip(startedAt, intent, 'original-incomplete', 'the original reply did not finish normally (' + String(finish) + ')');
            return;
        }
        if (!rendered.text && rendered.actions.length === 0 && upstreamUsage.calls === 0) {
            for (const chunk of original)
                yield chunk;
            await this.skip(startedAt, intent, 'original-empty', 'the original reply carried neither prose nor a tool call');
            return;
        }
        const policy = await this.deps.policy();
        const router = this.deps.router();
        const criteria = PROPOSAL_CRITERIA;
        const expected = 1 + criteria.length * PROCESS_REPEATS * Math.max(1, this.deps.judges());
        const fingerprint = stableHash({ phase: 'process', sessionId: intent.sessionId, taskStartSeq: intent.taskStartSeq, signal: intent.signal });
        const reservation = router.reserve(intent.agent, 'process', fingerprint, expected, policy);
        if (reservation === undefined) {
            for (const chunk of original)
                yield chunk;
            await this.skip(startedAt, intent, 'no-process-budget', 'the task/session budget or the one-per-task process allowance refused the cycle');
            return;
        }
        const observation = { cycleId: reservation.id, trigger: 'llm-stream', stage: 'process', destination: 'process', attempt: reservation.attempt, reservedCalls: reservation.expectedCalls, replayed: 'original', generatedCalls: 0, judgeCalls: 0, sameCandidate: false };
        const store = this.deps.store(intent.agent);
        const started = await store.begin({ cycleId: reservation.id, sessionId: intent.sessionId, taskStartSeq: intent.taskStartSeq, signal: intent.signal, startedAt: this.deps.now() });
        if (!started) {
            // The purchase record could not be written: buying anyway would make the cycle unaccountable.
            router.fail(intent.agent, reservation, false);
            for (const chunk of original)
                yield chunk;
            await this.report({ intent, reservation, observation, startedAt, outcome: 'store-unavailable', replayed: 'original', generatedCalls: 0, judgeCalls: 0, sameCandidate: false, usage: blankProcessStats(), error: 'the process cycle log could not be written' });
            return;
        }
        // One deadline for generation AND comparison. It never shortens the original request's own
        // timeout (that already elapsed), and a retry inside either phase cannot extend it.
        const phase = new AbortController();
        const timer = setTimeout(() => phase.abort(new Error('llm-verifier: process-selection phase timed out')), settings.timeoutMs);
        const linkAbort = () => phase.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', linkAbort, { once: true });
        try {
            let alternative;
            const request = buildAlternativeRequest(options, phase.signal);
            this.internal.add(request);
            try {
                alternative = await drainAlternative(this.deps.stream(request), PROCESS_CANDIDATE_CAP_CHARS);
            }
            catch (error) {
                router.fail(intent.agent, reservation, false);
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'generation-failed', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: blankProcessStats(), error: error instanceof Error ? error.message : String(error) });
                return;
            }
            observation.generatedCalls = 1;
            const generatedUsage = alternative.usage;
            if (!alternative.complete || (!alternative.text && alternative.actions.length === 0)) {
                router.fail(intent.agent, reservation, false);
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: alternative.complete ? 'alternative-empty' : 'alternative-incomplete', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage) });
                return;
            }
            if (candidateIdentity(alternative) === candidateIdentity(rendered)) {
                // Same plan expressed with a fresh call id: no judge call can separate them.
                router.commit(intent.agent, reservation, intent.lastSeq);
                observation.sameCandidate = true;
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'identical-candidate', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true, usage: statsWith(generatedUsage) });
                return;
            }
            let problem;
            try {
                problem = await this.deps.taskStatement(intent.agent, intent.taskStartSeq, phase.signal);
            }
            catch (error) {
                router.fail(intent.agent, reservation, false);
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'task-unreadable', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage), error: error instanceof Error ? error.message : String(error) });
                return;
            }
            const perCandidate = Math.max(64, Math.min(settings.maxItemChars, Math.floor(settings.maxInputChars / 2)));
            const task = problem.length > settings.maxItemChars ? problem.slice(0, settings.maxItemChars) : problem;
            const identicalAfterRender = renderCandidateView(rendered, perCandidate) === renderCandidateView(alternative, perCandidate);
            if (identicalAfterRender) {
                router.commit(intent.agent, reservation, intent.lastSeq);
                observation.sameCandidate = true;
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'identical-candidate', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true, usage: statsWith(generatedUsage) });
                return;
            }
            let compared;
            try {
                compared = await this.deps.compare({
                    agent: intent.agent,
                    problem,
                    candidateA: renderCandidateView(rendered, perCandidate),
                    candidateB: renderCandidateView(alternative, perCandidate),
                    criteria,
                    repeats: PROCESS_REPEATS,
                    signal: phase.signal,
                });
            }
            catch (error) {
                router.fail(intent.agent, reservation, false);
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'comparison-failed', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage), error: error instanceof Error ? error.message : String(error) });
                return;
            }
            observation.judgeCalls = compared.calls;
            const usage = statsWith(generatedUsage);
            mergeRunStats(usage, compared.stats);
            // The winner is only replayed while the phase is still current: an aborted phase or a task
            // that changed mid-flight must never hand a late alternative to the new task.
            if (phase.signal.aborted || !this.deps.current(intent)) {
                router.fail(intent.agent, reservation, false);
                for (const chunk of original)
                    yield chunk;
                await this.report({ intent, reservation, observation, startedAt, outcome: 'canceled', replayed: 'original', generatedCalls: 1, judgeCalls: compared.calls, sameCandidate: false, usage, compare: compared, ...(phase.signal.aborted ? { error: 'the process-selection phase was cancelled' } : {}) });
                return;
            }
            // A selection is never an acceptance: armed here, discharged only by the final gate.
            router.commit(intent.agent, reservation, intent.lastSeq);
            const replaced = compared.winner === 'B';
            observation.replayed = replaced ? 'candidate' : 'original';
            await this.report({ intent, reservation, observation, startedAt, outcome: replaced ? 'candidate-selected' : compared.winner === 'tie' ? 'tie' : 'original-selected', replayed: replaced ? 'candidate' : 'original', generatedCalls: 1, judgeCalls: compared.calls, sameCandidate: false, usage, compare: compared });
            if (replaced) {
                for (const chunk of alternative.chunks)
                    yield chunk;
                return;
            }
            for (const chunk of original)
                yield chunk;
        }
        finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', linkAbort);
        }
    }
    /** Record a cycle that never reached (or consumed) a reservation. */
    async skip(startedAt, intent, outcome, reason) {
        const cycleId = this.deps.diagnosticCycleId();
        await this.deps.record({
            agent: intent.agent,
            cycleId,
            purchased: false,
            startedAt,
            outcome,
            replayed: 'none',
            generatedCalls: 0,
            judgeCalls: 0,
            sameCandidate: false,
            usage: blankProcessStats(),
            observation: { cycleId, trigger: 'llm-stream', stage: 'skipped', destination: 'process', skipReason: outcome, replayed: 'none', generatedCalls: 0, judgeCalls: 0, sameCandidate: false },
        }).catch(() => { });
        this.deps.logger.warn('llm-verifier process selection skipped (' + outcome + '): ' + reason);
    }
    /** Record a purchased cycle and stamp its durable outcome. */
    async report(input) {
        await this.deps.store(input.intent.agent).finish(input.reservation.id, input.outcome, input.replayed);
        await this.deps.record({
            agent: input.intent.agent,
            cycleId: input.reservation.id,
            purchased: true,
            startedAt: input.startedAt,
            outcome: input.outcome,
            replayed: input.replayed,
            generatedCalls: input.generatedCalls,
            judgeCalls: input.judgeCalls,
            sameCandidate: input.sameCandidate,
            usage: input.usage,
            observation: input.observation,
            ...(input.compare === undefined ? {} : { compare: input.compare }),
            ...(input.error === undefined ? {} : { error: input.error }),
        }).catch(() => { });
    }
}
/** Drain the alternative reply, stopping at the cap (the alternative is discarded wholesale). */
async function drainAlternative(source, cap) {
    const chunks = [];
    let chars = 0;
    let overflow = false;
    for await (const chunk of source) {
        chunks.push(chunk);
        chars += measureChunk(chunk);
        if (chars > cap) {
            overflow = true;
            break;
        }
    }
    const rendered = renderCandidate(chunks);
    const finish = finishKind(chunks);
    return {
        chunks,
        text: rendered.text,
        actions: rendered.actions,
        chars,
        complete: !overflow && (finish === 'stop' || finish === 'tool-calls'),
        usage: usageFromChunks(chunks),
    };
}
function blankProcessStats() {
    return { ...emptyUsage(), cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 };
}
function statsWith(usage) {
    const stats = blankProcessStats();
    addUsage(stats, usage);
    if (usage.usageIncomplete)
        stats.usageIncomplete = true;
    return stats;
}
//# sourceMappingURL=process-selection.js.map