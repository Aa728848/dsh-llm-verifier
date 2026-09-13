/**
 * One model call captured inside an invocation.
 *
 * Everything the plugin decides is decided inside a prompt: "why did the progress
 * judge answer K again" is a question about the exact text that was sent and the raw
 * answer that came back. The statistics store answers "how much did it cost"; this one
 * answers "why did it say that".
 */
export interface DecisionCall {
    /** Which part of the invocation made the call (criterion, repeat, phase). */
    label: string;
    /** Scoring channel that answered (top-logprobs | explicit-tag). */
    channel: string;
    prompt: string;
    output: string;
    /** The score this call produced, when it produced one. */
    score?: number;
}
/** Sink the engine reports every REAL model call to (cache hits make no call). */
export type DecisionTrace = (call: DecisionCall) => void;
export interface DecisionRecord {
    id: string;
    toolName: string;
    phase: string;
    startedAt: number;
    provider: string;
    model: string;
    calls: DecisionCall[];
}
export declare function resolveDecisionsFile(cacheFile: string): string;
/**
 * Redact and bound captured calls.
 *
 * Runs the same sanitizer the prompts do, so a snapshot can never persist a secret the
 * judge itself never saw, and drops calls past the per-record budget instead of writing
 * an unbounded file.
 * @param calls - captured calls, oldest first.
 * @returns The bounded calls; empty when nothing was captured.
 */
export declare function boundDecisionCalls(calls: readonly DecisionCall[]): DecisionCall[];
export interface DecisionInput {
    toolName: string;
    phase: string;
    startedAt: number;
    provider: string;
    model: string;
    calls: readonly DecisionCall[];
}
/**
 * Per-topic ring buffer of decision snapshots.
 *
 * Mirrors {@link import('./statistics.ts').StatisticsStore}: one JSON file beside the
 * statistics of the same topic, atomic replace on write, a fixed number of records, so
 * the observable cost of "keep the evidence that explains a verdict" is bounded.
 */
export declare class DecisionStore {
    private readonly file;
    private readonly maxEntries;
    private loaded;
    private hydrating;
    private records;
    private writing;
    constructor(file: string, maxEntries?: number);
    record(input: DecisionInput): Promise<DecisionRecord | undefined>;
    /** One snapshot by invocation id, or undefined when it was pruned or never captured. */
    find(id: string): Promise<DecisionRecord | undefined>;
    load(): Promise<void>;
    private persist;
}
//# sourceMappingURL=decisions.d.ts.map