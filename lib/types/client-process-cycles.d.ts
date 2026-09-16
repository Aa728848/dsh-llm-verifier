/**
 * Locally declared copy of the client's status tones.
 *
 * The view model cannot import the tone type from `client.tsx`: the component imports THIS module,
 * so the dependency only points one way.
 */
export type ProcessCycleTone = 'pass' | 'warn' | 'error' | 'neutral';
/** Which rung of the request pipeline a chip describes. */
export type ProcessCycleStage = 'purchase' | 'generate' | 'augment' | 'judge' | 'replay' | 'canceled' | 'skip';
/** One chip of the rendered pipeline: a localized label plus the tone it paints in. */
export interface ProcessCycleStageView {
    stage: ProcessCycleStage;
    tone: ProcessCycleTone;
    /** Localized label, interpolated with the numbers read from the observations. */
    text: string;
}
/**
 * Grouped view of one P06 process-selection cycle, as the dashboard renders it.
 *
 * Every number is the cycle's own, never a sum over rows: the same reservation can produce more than
 * one statistics row (a skip row carries the reason, the purchase row carries the spend), and adding
 * them up would double-count the calls the cycle actually bought.
 */
export interface ProcessCycleView {
    /** Reservation id shared by every row of the cycle. */
    cycleId: string;
    /** Newest row of the group, used both as the link target and as the timestamp. */
    recordId?: string;
    /** Newest `startedAt` in the group (0 when no row carried one). */
    startedAt: number;
    /** How many statistics rows the group folded together. */
    rows: number;
    /** The cycle reached a reservation, so it spent (or could have spent) real calls. */
    purchased: boolean;
    attempt?: number;
    reservedCalls?: number;
    generatedCalls: number;
    judgeCalls: number;
    /** The alternative pool, split on the commas one model list is persisted with. */
    alternativeModels: string[];
    alternativeAugmented: boolean;
    sameCandidate: boolean;
    canceled: boolean;
    skipReason?: string;
    replayed: 'original' | 'candidate' | 'none';
    /** Ordered chips: purchase → generation → judging → replay. */
    stages: ProcessCycleStageView[];
}
/**
 * The subset of a statistics row the process-cycle grouping reads.
 *
 * Structural on purpose: `InvocationRecord` satisfies it as-is, so the dashboard passes its recent
 * list straight in and the pure function stays testable with plain objects.
 */
export interface ProcessCycleRouteInput {
    cycleId?: string;
    destination?: string;
    attempt?: number;
    reservedCalls?: number;
    skipReason?: string;
    canceled?: boolean;
    replayed?: string;
    generatedCalls?: number;
    judgeCalls?: number;
    sameCandidate?: boolean;
    alternativeAugmented?: boolean;
    alternativeModel?: string;
}
export interface ProcessCycleRowInput {
    id?: string;
    startedAt?: number;
    route?: ProcessCycleRouteInput | null;
}
/**
 * Fold the recent statistics rows into the process-selection cycles they describe.
 *
 * Only rows whose route destination is `process` take part — every other destination belongs to
 * the routing/final pipeline and is already covered by the recent list itself. Rows sharing a
 * {@link ProcessCycleRowInput.route.cycleId} form one cycle; cycles are returned newest first.
 *
 * The stage chips are built here (not in the component) because the interesting part is the
 * DECISION TREE — purchased vs skipped, judged vs short-circuited by an identical candidate,
 * replayed candidate vs original — and that tree is what the unit test pins. Labels come from the
 * passed dictionary so both languages render from the same function.
 * @param rows - recent invocation rows, in any order.
 * @param t - the active language dictionary (zh or en).
 * @returns One view model per process cycle, newest first.
 */
export declare function buildProcessCycles(rows: readonly ProcessCycleRowInput[] | null | undefined, t: Record<string, string>): ProcessCycleView[];
//# sourceMappingURL=client-process-cycles.d.ts.map