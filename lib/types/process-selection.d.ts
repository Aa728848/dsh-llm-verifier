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
import { type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type UsageStats } from './caller.ts';
import { type Criterion } from './core.ts';
import { type CompareResult, type RunStats } from './engine.ts';
import { type AutoVerifierRouter, type RouterPolicy } from './router.ts';
import type { RouteObservation } from './statistics.ts';
/**
 * Buffered characters allowed per candidate stream.
 *
 * The plan fixes the first version at 1 MiB. It is a hard boundary in BOTH directions: the
 * original stream overrunning it abandons selection and continues streaming untouched, and the
 * alternative overrunning it is discarded in favour of the complete original reply.
 */
export declare const PROCESS_CANDIDATE_CAP_CHARS = 1048576;
/** How long a registered intent may wait for its request before it is considered stale. */
export declare const PROCESS_INTENT_TTL_MS = 120000;
/**
 * Comparison rounds for the process cycle.
 *
 * Even on purpose: \`VerifierEngine.compare\` only swaps the A/B slots on odd repeats, and the
 * whole point of this cycle is deciding which of two replies the host should execute.
 */
export declare const PROCESS_REPEATS = 2;
/** Records kept in the durable per-topic cycle log. */
export declare const PROCESS_MAX_RECORDS = 200;
/** One registered intent: a request that MAY still be selected, identified by session and task. */
export interface ProcessIntent {
    sessionId: string;
    /**
     * The live host agent the intent was registered for.
     *
     * In-memory only (never persisted): it is the plugin's handle for the topic, the router state
     * and the statistics row. Typed \`unknown\` so this module does not depend on the host's Agent
     * shape; the caller narrows it.
     */
    agent: unknown;
    taskStartSeq: number;
    /** Recovery signature this intent was registered for; the cycle consumes exactly it. */
    signal: string;
    /**
     * Bounded, redacted digest of the two failing runs the intent was registered for.
     *
     * Handed to the ALTERNATIVE's generation request so the extra candidate is a differently
     * informed attempt rather than a resample of a reply already shown to fail. Absent when the
     * setting is off or the digest could not be built; the cycle then behaves exactly as before.
     */
    failureContext?: string;
    registeredAt: number;
    /** Newest session event seq seen at registration; the final gate is armed from here. */
    lastSeq: number;
}
/** A fully buffered candidate reply. */
export interface BufferedCandidate {
    chunks: StreamChunk[];
    /** Prose of the reply (reasoning deltas excluded: they are not the deliverable). */
    text: string;
    /** Tool calls in block order, rendered as \`name(arguments)\`. */
    actions: string[];
    chars: number;
    /** The stream reached a finish the host can consume (\`stop\` or \`tool-calls\`). */
    complete: boolean;
    usage: UsageStats;
}
/** Settings snapshot the selector acts on; read fresh on every decision point. */
export interface ProcessSelectionSettings {
    /** Master switch AND \`enabled\`. */
    active: boolean;
    /** Only smart mode enters this path in the first version. */
    smart: boolean;
    timeoutMs: number;
    maxItemChars: number;
    maxInputChars: number;
    /**
     * `provider/model` for the alternative reply; empty or absent means the request's own route.
     *
     * Optional so a settings producer that predates the knob cannot abort a cycle: an absent value
     * simply mirrors the original request, which is what the plugin did before the override existed.
     */
    alternativeModel?: string;
}
/**
 * Parse the configured alternative-model override.
 * @param value - raw `provider/model` setting (empty allowed).
 * @returns The route to generate the alternative with, or undefined to mirror the original.
 */
export declare function resolveAlternativeTarget(value: string | undefined): {
    provider: string;
    model: string;
} | undefined;
/** Everything the selector reports back for the statistics sidecar. */
export interface ProcessCycleReport {
    agent: unknown;
    cycleId: string;
    /** False when the cycle never reached a reservation (intent only, budget refusal, ...). */
    purchased: boolean;
    /** Wall clock the cycle began at, for the statistics row's duration. */
    startedAt: number;
    outcome: string;
    replayed: 'original' | 'candidate' | 'none';
    generatedCalls: number;
    judgeCalls: number;
    sameCandidate: boolean;
    usage: RunStats;
    observation: RouteObservation;
    compare?: CompareResult;
    error?: string;
}
export interface ProcessCompareRequest {
    /** Agent owning the topic the comparison runs under. */
    agent: unknown;
    problem: string;
    /** Bounded reference context (constraints, recent failure evidence, tool definitions). */
    context?: string;
    candidateA: string;
    candidateB: string;
    criteria: readonly Criterion[];
    repeats: number;
    signal: AbortSignal;
}
/**
 * One correction of an already-recorded cycle, because its DELIVERY changed after the row was written.
 *
 * `replayed` is defined by what the host actually received, so a cycle whose winner was withheld
 * must not stay recorded as a replacement.
 */
export interface ProcessDeliveryCorrection {
    agent: unknown;
    cycleId: string;
    outcome: string;
    replayed: 'original' | 'candidate';
}
/** What the judge is told about the task: the statement plus the evidence behind the failure. */
export interface ProcessTaskEvidence {
    problem: string;
    /** Bounded, redacted trace of the task so far, including the failed verification runs. */
    evidence?: string;
}
export interface ProcessSelectorDeps {
    settings(): ProcessSelectionSettings;
    /**
     * Redact and bound one piece of untrusted text.
     *
     * The SAME sanitizer every other judge input goes through, and applied before the view is
     * measured: a candidate reply is untrusted input like any other and may contain a credential the
     * configured patterns mask.
     */
    sanitize(text: string, maxChars: number): string;
    /** The routing policy in force, including the final-acceptance floor and the process allowance. */
    policy(): Promise<RouterPolicy>;
    router(): AutoVerifierRouter;
    /** Durable cycle log of one topic. */
    store(agent: unknown): ProcessCycleStore;
    /** Newest session state, used for staleness and for the comparison's task evidence. */
    taskStatement(agent: unknown, fromSeq: number, signal: AbortSignal): Promise<ProcessTaskEvidence>;
    /** Whether the intent's task is still the session's current task. */
    current(intent: ProcessIntent): boolean;
    /** Independent dispatch for the alternative reply (a fresh request object). */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    compare(request: ProcessCompareRequest): Promise<CompareResult>;
    record(report: ProcessCycleReport): Promise<void>;
    /**
     * Rewrite the STATISTICS row of one already-recorded cycle because its delivery changed.
     *
     * The row is written before the winner is handed over (a row must never be lost to a crash), so
     * this is the only way "which stream did the host actually get" stays true when the switch flips in
     * that last window. The durable sidecar is corrected by the selector itself, which owns it.
     */
    correctDelivery(correction: ProcessDeliveryCorrection): Promise<void>;
    judges(): number;
    logger: {
        warn(message: string): void;
    };
    now(): number;
    diagnosticCycleId(): string;
}
/**
 * Durable cycle log beside the score cache of one topic.
 *
 * Shares the topic directory on purpose: deleting the conversation removes the record of its
 * purchases with it, exactly like the score cache and the statistics log.
 * @param cacheFile - resolved \`scores-v1.json\` of the topic.
 * @returns Path of the process-selection log.
 */
export declare function resolveProcessFile(cacheFile: string): string;
/** Characters one chunk contributes to the buffer cap. */
export declare function measureChunk(chunk: StreamChunk): number;
/**
 * Prose and actions of one buffered reply.
 *
 * Transport-level fields (call ids, usage, indices, replay state) are deliberately dropped: two
 * replies that differ only in a fresh \`callId\` are the same plan, and treating them as different
 * candidates would buy a comparison that cannot distinguish anything.
 */
export declare function renderCandidate(chunks: readonly StreamChunk[]): {
    text: string;
    actions: string[];
};
/** Stage-and-content identity of one candidate, ignoring every transport-level field. */
export declare function candidateIdentity(candidate: {
    text: string;
    actions: readonly string[];
}): string;
/** Whether a buffered stream ended in a finish the host can act on. */
export declare function finishKind(chunks: readonly StreamChunk[]): string | undefined;
/** Usage reported by the LAST \`usage\` chunk of one dispatched stream. */
export declare function usageFromChunks(chunks: readonly StreamChunk[]): UsageStats;
/**
 * The plugin message that hands the alternative the failure its cycle was triggered by.
 *
 * The alternative used to be a byte-identical re-dispatch of the original request, so the only thing
 * that made it different was sampling noise: the judge then chose between two replies written with
 * the same information, one of which the session had already shown failing twice. This is the
 * equivalent of the upstream plugin's context refinement, but it uses the deterministic evidence the
 * trigger is already built from instead of paying another model to rewrite the prompt, and it is
 * sanitized and bounded by the caller before it is built.
 *
 * It is a USER message from this plugin, delivered the way the host delivers a steering notice. The
 * quoted output stays framed as data: it is output the model itself produced, never an instruction,
 * and the note says so.
 * @param context - bounded, redacted digest of the failing runs.
 * @returns The message appended to the alternative's request.
 */
export declare function buildFailureNotice(context: string): Message;
/**
 * Build the alternative reply's request from the frozen original.
 *
 * Copying only the effective call configuration keeps the same model while giving the alternative
 * its own lifecycle, with two deliberate differences added after the P06 review:
 *
 * - the temperature is raised to at least GENERATION_TEMPERATURE. A host configured for
 *   near-deterministic sampling would otherwise return a copy of the original reply and the cycle
 *   would pay a generation to learn nothing (best-of-N raises it for exactly the same reason);
 * - failureContext, when present, is appended as a plugin message so the extra candidate is written
 *   with the failure evidence the cycle exists for.
 * the process-local "this is an agent-loop request" marker is
 * deliberately NOT copied, and neither is \`sessionId\`, so the alternative can never be mistaken
 * for (or recurse into) a main-loop request.
 */
export declare function buildAlternativeRequest(options: GenerateOptions, signal: AbortSignal, failureContext?: string, target?: {
    provider: string;
    model: string;
}): GenerateOptions;
/**
 * Render one bounded candidate view for the judge, or refuse when its actions cannot fit.
 *
 * The tool calls are ATOMIC: a truncated call is not a shorter action, it is a different one, and
 * scoring it would grade the original reply against something the host will never execute — only
 * the winning reply's buffered chunks are replayed verbatim. So when the action block does not fit
 * the candidate's budget the whole view is refused and the caller falls back to the original reply,
 * recording the length reason. Only the PROSE (which is not executed) is truncated, with a visible
 * marker.
 * @param candidate - prose and actions of one reply.
 * @param budget - characters this candidate may occupy.
 * @returns The rendered block body, or undefined when its actions cannot be shown in full.
 */
export declare function renderCandidateView(candidate: {
    text: string;
    actions: readonly string[];
}, budget: number): string | undefined;
/**
 * Everything the judge needs about the task besides the two replies.
 *
 * The judge has to answer "does this next step address the REAL failure?", which needs the task,
 * the constraints the request was made under and the execution evidence behind the failure — not
 * just the user's question. Every piece is bounded and redacted by {@link buildProcessView}.
 */
export interface ProcessEvidencePack {
    /** Task statement of the current task. */
    task: string;
    /** Recent execution evidence (the trajectory, including the failed verification runs). */
    evidence?: string;
    /** The original request's system constraints, when it declared any. */
    constraints?: string;
    /** Digest of the tools the original request could call, when it declared any. */
    tools?: string;
}
export interface ProcessViewInput extends ProcessEvidencePack {
    original: {
        text: string;
        actions: readonly string[];
    };
    alternative: {
        text: string;
        actions: readonly string[];
    };
    maxItemChars: number;
    maxInputChars: number;
    /** Redact and bound one piece of untrusted text before it reaches a judge. */
    sanitize(text: string, maxChars: number): string;
}
/** A bounded, redacted comparison view, or the reason it could not be built. */
export type ProcessView = {
    ok: true;
    problem: string;
    context?: string;
    candidateA: string;
    candidateB: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Build the bounded, redacted comparison view of one process cycle.
 *
 * Three boundaries are enforced here, and exceeding any of them declines the cycle instead of
 * sending incomplete evidence:
 *
 * 1. every piece is redacted with the plugin's sanitizer BEFORE it is measured, so a secret that
 *    sanitizeVerifierText masks can never reach the judge prompt through a candidate reply;
 * 2. the task and its context must fit the combined input budget (a candidate scored against a
 *    truncated constraint set measures the truncation, not the candidate);
 * 3. the remaining budget is split across the two candidates with itemBudget, and a candidate whose
 *    actions cannot be shown in full is refused (see renderCandidateView).
 *
 * The TOTAL is measured on the rendered text, never estimated, so the view can never exceed
 * maxInputChars.
 * @param input - the evidence pack plus both replies and the live bounds.
 * @returns The view, or the specific length reason it was refused.
 */
export declare function buildProcessView(input: ProcessViewInput): ProcessView;
/**
 * One bounded digest of the tools the original request could call.
 *
 * The judge sees `[tool-call] name(arguments)` for every action; without the definitions it cannot
 * tell whether `pwsh({"command":"..."})` is the task's verification command or an unrelated probe.
 * Only names, parameter names and one-line descriptions are shown — full schemas would swamp the
 * evidence budget for no decision value.
 * @param tools - the original request's tool definitions, when it declared any.
 * @returns The digest, or undefined when there is nothing to show.
 */
export declare function renderToolDigest(tools: readonly unknown[] | undefined): string | undefined;
/** One durable purchase record; the sidecar exists so a plugin reload cannot buy the cycle twice. */
export interface ProcessCycleRecord {
    cycleId: string;
    sessionId: string;
    taskStartSeq: number;
    signal: string;
    startedAt: number;
    outcome?: string;
    replayed?: string;
}
/**
 * Durable per-topic log of purchased process cycles.
 *
 * A purchase must survive a plugin reload: the in-memory router counter cannot, and without the
 * sidecar a reload would let the same stuck task buy a second cycle. A failed read is treated as
 * "do not buy" rather than "probably fine" — see {@link lookup}.
 */
export declare class ProcessCycleStore {
    private readonly file;
    private readonly max;
    private loaded;
    private records;
    private writing;
    constructor(file: string, max?: number);
    private load;
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
    lookup(sessionId: string, taskStartSeq: number): Promise<{
        ok: boolean;
        purchased: boolean;
        reason?: string;
    }>;
    /**
     * Write the start record BEFORE any added model call.
     * @param record - the purchase to remember.
     * @returns False when the record could not be persisted; the caller must not buy.
     */
    begin(record: ProcessCycleRecord): Promise<boolean>;
    /** Attach the outcome of a purchased cycle to its record (best effort). */
    finish(cycleId: string, outcome: string, replayed: string): Promise<void>;
    private persist;
}
export declare class ProcessSelector {
    private readonly deps;
    private readonly intents;
    /** Requests this plugin dispatched itself (the alternative reply): never a selection subject. */
    private readonly internal;
    /**
     * Phase controllers of the cycles currently in flight, one per session.
     *
     * Holding them is what makes "turn the switch off / cancel / dispose" take effect on a cycle
     * that already started: aborting the phase stops the alternative dispatch, the comparison and
     * the replay, and the buffered original reply is handed back instead.
     */
    private readonly cycles;
    constructor(deps: ProcessSelectorDeps);
    /** Register (or replace) the pending intent of one session. */
    register(intent: ProcessIntent): void;
    /** Drop a session's pending intent and cancel its in-flight cycle (new task, disposal). */
    clear(sessionId: string): void;
    /** Drop every pending intent and cancel every in-flight cycle (settings change, shutdown). */
    clearAll(): void;
    /** Cancel one session's in-flight cycle; it replays the buffered original reply instead. */
    private abort;
    /** Whether the LIVE settings still permit the request-level path. */
    private live;
    /** Whether a session already has an intent waiting for its next request. */
    pending(sessionId: string): boolean;
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
    take(options: GenerateOptions): ProcessIntent | undefined;
    /**
     * Buy the cycle and dispatch the alternative WITHOUT waiting for the original reply.
     *
     * Everything here used to run after the original had been buffered, so the host waited for the
     * original, then for the alternative, then for the judge. The intent is registered before the
     * request is dispatched, so the decision to buy is already known when this runs: the added
     * generation now overlaps the original reply and only the comparison stays serial.
     *
     * The ordering rule is unchanged — policy, reservation and `store.begin()` all complete before the
     * first added model call — but the price of the rare declines changes: a purchase that is later
     * thrown away (original over the cap, incomplete, empty, or a cycle that went stale mid-stream) is
     * now a purchased row with one generation, where it used to skip without buying. That is the
     * honest count, because the dispatch really happened.
     * @param options - the matched main request.
     * @param intent - the consumed intent.
     * @param settings - settings snapshot taken when the request entered the waterfall.
     * @param startedAt - wall clock the cycle began at.
     * @returns The started cycle, or undefined when it was declined (its single row is already written).
     */
    private beginCycle;
    /**
     * Throw away whatever the cycle became, replaying the original.
     *
     * A cycle that was never bought owns no row of its own: `beginCycle` already wrote exactly one for
     * this request ("why was it declined"), and a second row would inflate the skip distribution. A
     * BOUGHT cycle does own one, and it is a purchased row: the dispatch really happened, so the usage
     * it already reported is booked rather than dropped.
     * @param cycle - the started cycle, or undefined when the buy was declined.
     * @param intent - the consumed intent.
     * @param startedAt - wall clock the cycle began at.
     * @param outcome - terminal outcome to record.
     * @param reason - human-readable reason for the log and the row.
     * @param error - error text to store instead of the reason, when there is one.
     */
    private abandon;
    /** Usage a discarded dispatch already reported, best effort, never zero when tokens were seen. */
    private settledUsage;
    /**
     * The waterfall body.
     *
     * \`next()\` is called exactly once. The original reply is buffered first; only after it is
     * complete and inside the cap is the alternative generated, and only a judge-selected winner is
     * replayed. Every decline replays the buffered original verbatim.
     *
     * The live state — the settings switch, the turn signal and the current task — is re-read before
     * every purchase, before the comparison and before the winner is committed, and a settings change
     * or a disposal aborts the cycle through {@link ProcessSelector.clearAll}.
     * @param options - the matched main request.
     * @param next - the downstream dispatch (called once).
     * @param intent - the consumed intent.
     * @returns The chunks the host will consume.
     */
    handle(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>, intent: ProcessIntent): AsyncGenerator<StreamChunk>;
    /**
     * Why the cycle must fall back to the buffered original reply RIGHT NOW.
     *
     * Re-read at every decision point instead of sampled once: the switch can be turned off, the turn
     * cancelled or the task replaced while a generation or a comparison is in flight, and a late
     * alternative must never reach the new task.
     * @param intent - the consumed intent of this cycle.
     * @param phase - the cycle's phase controller.
     * @returns The outcome to record, or undefined while the cycle is still current.
     */
    private staleReason;
    /** Record a cycle that never reached (or consumed) a reservation. */
    private skip;
    /** Record a purchased cycle and stamp its durable outcome. */
    private report;
}
//# sourceMappingURL=process-selection.d.ts.map