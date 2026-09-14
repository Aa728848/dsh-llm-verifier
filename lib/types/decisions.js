import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sanitizeVerifierText } from "./session.js";
/**
 * Upper bound on captured calls per invocation.
 *
 * A session acceptance makes six; an explicit best-of-N makes about 27 (N drafts, the
 * tournament, and the winner-vs-baseline comparison). Keeping the old 12 would have dropped
 * the drafts from the snapshot entirely — judge labels sort before `draft N` — so the one
 * record that explains "which draft won and why" could not show the drafts at all. The
 * per-record character budget is unchanged and shared equally, so the extra calls shrink each
 * window instead of growing the file. 32 is the ceiling the equal-share floor allows:
 * 32 x (512 prompt + 256 output) still fits in {@link MAX_RECORD_CHARS}.
 */
const MAX_CALLS = 32;
const MAX_PROMPT_CHARS = 8000;
const MAX_OUTPUT_CHARS = 4000;
/** Upper bound on one record's captured text, so a wide select cannot fill the file. */
const MAX_RECORD_CHARS = 30000;
/** Smallest window worth storing; at MAX_CALLS the equal share stays above this floor. */
const MIN_PROMPT_CHARS = 512;
const MIN_OUTPUT_CHARS = 256;
export function resolveDecisionsFile(cacheFile) {
    return join(dirname(cacheFile), 'decisions-v1.json');
}
/**
 * Redact and bound captured calls.
 *
 * Runs the same sanitizer the prompts do, so a snapshot can never persist a secret the
 * judge itself never saw, and drops calls past the per-record budget instead of writing
 * an unbounded file.
 * @param calls - captured calls, oldest first.
 * @returns The bounded calls; empty when nothing was captured.
 */
export function boundCaptureText(text, maxChars) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1)
        throw new Error('llm-verifier: decision capture cap must be a positive integer');
    const clean = sanitizeVerifierText(text, Math.max(1, text.length));
    if (clean.length <= maxChars || maxChars < 256)
        return sanitizeVerifierText(text, maxChars);
    const head = Math.floor(maxChars / 2);
    const tail = maxChars - head;
    const omitted = Math.max(0, clean.length - head - tail);
    const marker = '\n[… ' + omitted + ' characters omitted …]\n';
    // The marker is charged to the tail's share, so the sum can never exceed the cap.
    const keepTail = Math.max(0, tail - marker.length);
    return clean.slice(0, head) + marker + (keepTail === 0 ? '' : clean.slice(-keepTail));
}
/**
 * Redact and bound captured calls.
 *
 * Runs the same sanitizer the prompts do, so a snapshot can never persist a secret the
 * judge itself never saw. The record is bounded twice: at {@link MAX_CALLS} calls, and at
 * {@link MAX_RECORD_CHARS} characters shared EQUALLY between the calls it keeps — a six-call
 * session acceptance must not shrink to its first three calls, and which three survived must not
 * depend on completion order. Text uses {@link boundCaptureText}, which keeps both ends: a
 * session-acceptance prompt runs past 100k characters, and head-only truncation kept the
 * instructions while dropping the trajectory tail the judge actually graded.
 * @param calls - captured calls; callers sort them by label so the bounded set is deterministic.
 * @returns The bounded calls; empty when nothing was captured.
 */
export function boundDecisionCalls(calls) {
    if (calls.length === 0)
        return [];
    // Over the count cap, keep an EVEN SPREAD (first and last included) rather than a prefix.
    // A prefix is the wrong sample whenever the labels cluster: the engine labels its own calls
    // in sorted order, so an oversized best-of-N (n=4 makes ~46 calls: the baseline, then the
    // tournament, then `draft N` last) would lose every draft and keep only judge calls.
    const selected = calls.length <= MAX_CALLS
        ? [...calls]
        : Array.from({ length: MAX_CALLS }, (_, index) => calls[Math.round(index * (calls.length - 1) / (MAX_CALLS - 1))]);
    // Equal share per call, not first-come-first-served. A session acceptance makes six calls on
    // ~8k-char prompts; a fixed 8k + 4k per call let only the FIRST THREE through, and which three
    // survived depended on completion order, i.e. on the network — so the most expensive path in
    // the plugin stored a different (and partial) set of criteria every time. Every call now keeps
    // a smaller window: boundCaptureText keeps both ends, so the instruction head and the graded
    // trajectory tail still survive.
    const overhead = selected.reduce((sum, call) => sum + Math.min(call.label.length, 200) + Math.min(call.channel.length, 40), 0);
    const perCall = Math.max(MIN_PROMPT_CHARS + MIN_OUTPUT_CHARS, Math.floor((MAX_RECORD_CHARS - overhead) / selected.length));
    const bounded = [];
    let used = 0;
    for (const call of selected) {
        // The two windows must SUM to at most perCall, which the previous 80/20 split did not
        // guarantee: once perCall fell below ~1000 (a wide invocation), the output floor pushed the
        // pair over its share and the safety net below silently dropped the tail — the drafts.
        const promptChars = Math.min(MAX_PROMPT_CHARS, Math.max(MIN_PROMPT_CHARS, Math.min(Math.floor(perCall * 0.8), perCall - MIN_OUTPUT_CHARS)));
        const outputChars = Math.min(MAX_OUTPUT_CHARS, Math.max(MIN_OUTPUT_CHARS, perCall - promptChars));
        const value = {
            label: call.label.slice(0, 200),
            channel: call.channel.slice(0, 40),
            prompt: boundCaptureText(call.prompt, promptChars),
            output: boundCaptureText(call.output, outputChars),
            ...(typeof call.score === 'number' && Number.isFinite(call.score) ? { score: call.score } : {}),
        };
        const cost = value.label.length + value.channel.length + value.prompt.length + value.output.length;
        // Safety net only: the equal share already fits at MAX_CALLS, unless perCall is below the
        // two floors (unreachable for realistic label lengths).
        if (bounded.length > 0 && used + cost > MAX_RECORD_CHARS)
            break;
        bounded.push(value);
        used += cost;
    }
    return bounded;
}
/**
 * Per-topic ring buffer of decision snapshots.
 *
 * Mirrors {@link import('./statistics.ts').StatisticsStore}: one JSON file beside the
 * statistics of the same topic, atomic replace on write, a fixed number of records, so
 * the observable cost of "keep the evidence that explains a verdict" is bounded.
 */
export class DecisionStore {
    file;
    maxEntries;
    loaded = false;
    hydrating;
    records = [];
    writing = Promise.resolve();
    constructor(file, maxEntries = 40) {
        this.file = file;
        this.maxEntries = maxEntries;
        if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0)
            throw new Error('llm-verifier: decision maxEntries must be a positive integer');
    }
    async record(input) {
        const calls = boundDecisionCalls(input.calls);
        if (calls.length === 0)
            return undefined;
        const record = {
            id: idOf(input.id),
            toolName: input.toolName,
            phase: input.phase,
            startedAt: input.startedAt,
            provider: input.provider,
            model: input.model,
            calls,
        };
        const operation = async () => {
            await this.load();
            this.records.push(record);
            if (this.records.length > this.maxEntries)
                this.records.splice(0, this.records.length - this.maxEntries);
            await this.persist();
        };
        this.writing = this.writing.then(operation, operation);
        await this.writing;
        return record;
    }
    /** One snapshot by invocation id, or undefined when it was pruned or never captured. */
    async find(id) {
        await this.writing.catch(() => { });
        await this.load();
        return this.records.find(record => record.id === id);
    }
    async load() {
        if (this.loaded)
            return;
        this.hydrating ??= (async () => {
            try {
                const document = JSON.parse(await readFile(this.file, 'utf8'));
                if (document.version === 1 && Array.isArray(document.records)) {
                    this.records = document.records.filter(isDecisionRecord).slice(-this.maxEntries);
                }
                this.loaded = true;
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    this.loaded = true;
                    return;
                }
                throw error;
            }
            finally {
                this.hydrating = undefined;
            }
        })();
        await this.hydrating;
    }
    async persist() {
        const snapshot = { version: 1, records: this.records };
        await mkdir(dirname(this.file), { recursive: true });
        const temporary = this.file + '.tmp-' + process.pid + '-' + randomUUID();
        await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
        try {
            await rename(temporary, this.file);
        }
        catch (error) {
            await unlink(temporary).catch(() => { });
            throw error;
        }
    }
}
/**
 * The id a snapshot is filed under.
 *
 * A caller-supplied id is the statistics row's own id ({@link DecisionInput.id}), which is what
 * makes the dashboard's "one snapshot per row" lookup resolve; anything unusable falls back to a
 * fresh uuid so a malformed argument can never merge two invocations into one record.
 * @param candidate - id supplied by the caller, if any.
 * @returns The id to store the record under.
 */
function idOf(candidate) {
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : randomUUID();
}
/**
 * Loose validation, so a record written by a newer/older plugin still loads.
 * @param value - parsed JSON entry.
 * @returns True when the entry carries the fields the dashboard needs.
 */
function isDecisionRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.id === 'string'
        && typeof row.toolName === 'string'
        && typeof row.startedAt === 'number'
        && Array.isArray(row.calls)
        && row.calls.every(call => typeof call === 'object' && call !== null && typeof call.prompt === 'string' && typeof call.output === 'string');
}
//# sourceMappingURL=decisions.js.map