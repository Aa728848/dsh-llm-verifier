import { tFormat } from "./client-i18n.js";
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
export function buildProcessCycles(rows, t) {
    const copy = (key) => t[key] ?? key;
    const fill = (key, params) => tFormat(copy(key), params);
    const groups = new Map();
    for (const row of rows ?? []) {
        const route = row?.route;
        if (!route || route.destination !== 'process')
            continue;
        const cycleId = typeof route.cycleId === 'string' ? route.cycleId : '';
        if (cycleId === '')
            continue;
        const group = groups.get(cycleId);
        if (group === undefined)
            groups.set(cycleId, [row]);
        else
            group.push(row);
    }
    const cycles = [];
    for (const [cycleId, group] of groups) {
        let startedAt = 0;
        let recordId;
        let attempt;
        let reservedCalls;
        let generatedCalls = 0;
        let judgeCalls = 0;
        let alternativeModel = '';
        let alternativeAugmented = false;
        let sameCandidate = false;
        let canceled = false;
        let skipReason;
        let replayed = 'none';
        // A cycle is a purchase as soon as it holds a reservation (attempt/reservedCalls), whatever it
        // later did with it; the skip rows of the every-step arm carry neither and stay unbought.
        let purchased = false;
        for (const row of group) {
            const route = row.route;
            if (typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) && row.startedAt >= startedAt) {
                startedAt = row.startedAt;
                if (typeof row.id === 'string')
                    recordId = row.id;
            }
            else if (recordId === undefined && typeof row.id === 'string')
                recordId = row.id;
            if (attempt === undefined && typeof route.attempt === 'number')
                attempt = route.attempt;
            if (reservedCalls === undefined && typeof route.reservedCalls === 'number')
                reservedCalls = route.reservedCalls;
            if (typeof route.generatedCalls === 'number')
                generatedCalls = Math.max(generatedCalls, route.generatedCalls);
            if (typeof route.judgeCalls === 'number')
                judgeCalls = Math.max(judgeCalls, route.judgeCalls);
            if (typeof route.alternativeModel === 'string' && route.alternativeModel !== '')
                alternativeModel = route.alternativeModel;
            if (route.alternativeAugmented === true)
                alternativeAugmented = true;
            if (route.sameCandidate === true)
                sameCandidate = true;
            if (route.canceled === true)
                canceled = true;
            if (typeof route.skipReason === 'string' && route.skipReason !== '')
                skipReason = route.skipReason;
            if (route.replayed === 'candidate')
                replayed = 'candidate';
            else if (route.replayed === 'original' && replayed !== 'candidate')
                replayed = 'original';
            if (route.replayed === 'original' || route.replayed === 'candidate' || typeof route.attempt === 'number' || typeof route.reservedCalls === 'number')
                purchased = true;
        }
        const alternativeModels = [];
        for (const entry of alternativeModel.split(',')) {
            const model = entry.trim();
            if (model !== '' && !alternativeModels.includes(model))
                alternativeModels.push(model);
        }
        const stages = [];
        // 1. Purchase: a cycle with no reservation never bought anything.
        if (canceled)
            stages.push({ stage: 'purchase', tone: 'warn', text: copy('processCycles.stage.cpCanceled') });
        else if (!purchased)
            stages.push({ stage: 'purchase', tone: skipReason === undefined ? 'neutral' : 'warn', text: copy('processCycles.stage.cpNotPurchased') });
        else if (typeof attempt === 'number' && typeof reservedCalls === 'number')
            stages.push({ stage: 'purchase', tone: 'pass', text: fill('processCycles.stage.cpPurchased', { attempt, reserved: reservedCalls }) });
        else
            stages.push({ stage: 'purchase', tone: 'pass', text: copy('processCycles.stage.cpPurchasedPlain') });
        // 2. Generation: what the cycle bought before any judging happened.
        if (generatedCalls > 0)
            stages.push({ stage: 'generate', tone: 'pass', text: alternativeModels.length === 0 ? fill('processCycles.stage.generate', { count: generatedCalls }) : fill('processCycles.stage.generateWithModels', { count: generatedCalls, models: alternativeModels.join(' / ') }) });
        else
            stages.push({ stage: 'generate', tone: 'neutral', text: copy('processCycles.stage.generateNone') });
        if (alternativeAugmented)
            stages.push({ stage: 'augment', tone: 'warn', text: copy('processCycles.stage.augmented') });
        // 3. Judging: an identical candidate short-circuits the judge, and saying "0 judges" there would
        // read as a failed judge instead of the short-circuit it is.
        if (sameCandidate)
            stages.push({ stage: 'judge', tone: 'warn', text: copy('processCycles.stage.judgeSame') });
        else if (judgeCalls > 0)
            stages.push({ stage: 'judge', tone: 'pass', text: fill('processCycles.stage.judge', { count: judgeCalls }) });
        else
            stages.push({ stage: 'judge', tone: 'neutral', text: copy('processCycles.stage.judgeNone') });
        // 4. Replay: what the host actually received. `none` is only a warning when a purchase raised
        // the expectation; a cycle that was never bought has simply not arrived there yet.
        if (replayed === 'candidate')
            stages.push({ stage: 'replay', tone: 'pass', text: copy('processCycles.stage.replayCandidate') });
        else if (replayed === 'original')
            stages.push({ stage: 'replay', tone: 'neutral', text: copy('processCycles.stage.replayOriginal') });
        else
            stages.push({ stage: 'replay', tone: purchased ? 'warn' : 'neutral', text: copy('processCycles.stage.replayNone') });
        if (canceled)
            stages.push({ stage: 'canceled', tone: 'error', text: copy('processCycles.stage.canceled') });
        if (skipReason !== undefined)
            stages.push({ stage: 'skip', tone: 'warn', text: fill('processCycles.stage.skip', { reason: skipReason }) });
        cycles.push({ cycleId, ...(recordId === undefined ? {} : { recordId }), startedAt, rows: group.length, purchased, ...(attempt === undefined ? {} : { attempt }), ...(reservedCalls === undefined ? {} : { reservedCalls }), generatedCalls, judgeCalls, alternativeModels, alternativeAugmented, sameCandidate, canceled, ...(skipReason === undefined ? {} : { skipReason }), replayed, stages });
    }
    // Newest first; the sort is stable, so two cycles stamped in the same millisecond keep the order
    // the recent list already gave them.
    return cycles.sort((a, b) => b.startedAt - a.startedAt);
}
//# sourceMappingURL=client-process-cycles.js.map