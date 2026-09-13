import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sanitizeVerifierText } from "./session.js";
/** Upper bound on captured calls per invocation; a session acceptance makes six. */
const MAX_CALLS = 12;
const MAX_PROMPT_CHARS = 8000;
const MAX_OUTPUT_CHARS = 4000;
/** Upper bound on one record's captured text, so a wide select cannot fill the file. */
const MAX_RECORD_CHARS = 30000;
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
 * judge itself never saw, and drops calls past the per-record budget instead of writing
 * an unbounded file. Text uses {@link boundCaptureText}, which keeps both ends: a
 * session-acceptance prompt runs past 100k characters, and head-only truncation kept the
 * instructions while dropping the trajectory tail the judge actually graded.
 * @param calls - captured calls, oldest first.
 * @returns The bounded calls; empty when nothing was captured.
 */
export function boundDecisionCalls(calls) {
    const bounded = [];
    let used = 0;
    for (const call of calls.slice(0, MAX_CALLS)) {
        const value = {
            label: call.label.slice(0, 200),
            channel: call.channel.slice(0, 40),
            prompt: boundCaptureText(call.prompt, MAX_PROMPT_CHARS),
            output: boundCaptureText(call.output, MAX_OUTPUT_CHARS),
            ...(typeof call.score === 'number' && Number.isFinite(call.score) ? { score: call.score } : {}),
        };
        const cost = value.label.length + value.channel.length + value.prompt.length + value.output.length;
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
            id: randomUUID(),
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