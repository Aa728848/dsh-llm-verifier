import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const VERIFIER_TOOL_NAMES = ['verifier_route_classify', 'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_best_of_n', 'verifier_current_session'];
/** Upper bound on the stored checkpoint progression; one explicit call can legitimately carry 32 steps. */
const MAX_VERDICT_SCORES = 64;
/** Upper bound on the stored per-criterion breakdown; the default rubric has three criteria. */
const MAX_VERDICT_CRITERIA = 16;
/**
 * Compact summary of what the judges decided, stored beside the call counters so
 * the dashboard can answer "why did this fail?" instead of only "how much did it cost".
 *
 * Pure on purpose: this mapping used to live inside the plugin closure, where the two
 * bugs it carried (a track verdict reported as the historical minimum, a comparison
 * reported as the loser's score under a threshold it never used) could not be tested.
 * @param toolName - the verifier tool that produced the value.
 * @param value - its rendered result.
 * @param phase - which stage produced it (explicit | compare | select | track | final | ...).
 * @param thresholds - resolved acceptance thresholds.
 * @returns A verdict summary; score fields are omitted when the tool has none.
 */
export function summarizeVerdict(toolName, value, phase, thresholds) {
    const row = typeof value === 'object' && value !== null ? value : {};
    const numberAt = (key) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : undefined);
    const scores = Array.isArray(row.scores) ? row.scores.filter((entry) => typeof entry === 'number' && Number.isFinite(entry)) : [];
    const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'tie' ? row.winner : undefined;
    if (toolName === 'verifier_route_classify')
        return { phase, outcome: 'classified' };
    // The stage and the rubric that actually scored are part of the verdict: "which object was
    // judged, and against what" cannot be recovered from a score alone.
    const framing = {
        ...(typeof row.reviewStage === 'string' ? { reviewStage: row.reviewStage } : {}),
        ...(typeof row.criteriaSource === 'string' ? { criteriaSource: row.criteriaSource } : {}),
    };
    if (toolName === 'verifier_select') {
        if (row.identical === true)
            return { phase, outcome: 'identical-candidates', ...framing };
        const index = numberAt('index');
        const best = index === undefined ? undefined : scores[index];
        return { phase, outcome: 'ranked', ...(best !== undefined ? { score: best } : {}), ...framing };
    }
    if (toolName === 'verifier_track') {
        // The verdict reports the newest checkpoint (the one the continuation decision
        // uses) plus the whole progression. Reporting only Math.min() made every routed
        // track look like a 0% failure on the dashboard, because the first checkpoint of
        // a task is always the untouched plan.
        const latest = scores.length > 0 ? scores[scores.length - 1] : undefined;
        const threshold = thresholds.autoTrackCompletionThreshold;
        return {
            phase,
            outcome: latest !== undefined && latest >= threshold ? 'passed' : 'below-threshold',
            ...(latest !== undefined ? { score: latest } : {}),
            ...(scores.length > 1 ? { scores: [...scores] } : {}),
            threshold,
        };
    }
    if (toolName === 'verifier_compare') {
        // A comparison has no threshold, so "below-threshold" used to describe the loser's
        // score as a failure of the call itself. Report the winning side and keep both.
        const scoreA = numberAt('score') ?? numberAt('scoreA');
        const scoreB = numberAt('scoreB');
        const score = winner === 'B' ? scoreB : scoreA;
        return {
            phase,
            outcome: row.identical === true ? 'identical' : winner === 'tie' ? 'tie' : 'compared',
            ...(score !== undefined ? { score } : {}),
            ...(scoreB !== undefined ? { scoreB } : {}),
            ...(winner !== undefined ? { winner } : {}),
            ...framing,
        };
    }
    // The remaining tools are both measured against the fixed empty-work baseline. A best-of-N
    // verdict is rendered with the GATE's shape, not the select tool's: the tournament shares it
    // also returns are relative preferences (wins/counts) and mean nothing against
    // `autoVerifyThreshold`, while its `score`/`baselineScore`/`winner` come from the very same
    // empty-work comparison the final gate runs. The dashboard reads it exactly like an acceptance.
    return acceptanceVerdict(row, phase, thresholds);
}
/**
 * Verdict of a run that was measured against the fixed empty-work baseline.
 *
 * Shared by the automatic session acceptance and by `verifier_best_of_n`: both answer
 * "is this good enough to conclude", and both are decided by the same three conditions.
 * @param row - the rendered result.
 * @param phase - which stage produced it.
 * @param thresholds - resolved acceptance thresholds.
 * @returns A gate-shaped verdict summary.
 */
function acceptanceVerdict(row, phase, thresholds) {
    const numberAt = (key) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : undefined);
    const winner = row.winner === 'A' || row.winner === 'B' || row.winner === 'tie' ? row.winner : undefined;
    // `score` is the run's own score and `baselineScore` the empty-work baseline it has to beat.
    const score = numberAt('score') ?? numberAt('scoreA');
    const baselineScore = numberAt('baselineScore');
    const threshold = thresholds.autoVerifyThreshold;
    const criteria = Array.isArray(row.criteria)
        ? row.criteria
            .map(entry => (typeof entry === 'object' && entry !== null ? entry : {}))
            // `score` is the shape a session acceptance emits (AcceptanceCriterion); `scoreA` is the
            // shape a compare result uses. Reading only `scoreA` silently dropped EVERY per-criterion
            // score a session acceptance ever produced: 11 of 11 stored records on the author's topic
            // carry no criteria array at all, so the dashboard could never show which requirement
            // failed. Keep both, because the compare-shaped value is still a valid input here.
            .map(entry => ({ id: entry.id, score: typeof entry.score === 'number' ? entry.score : entry.scoreA }))
            .filter((entry) => typeof entry.id === 'string' && typeof entry.score === 'number' && Number.isFinite(entry.score))
            .slice(0, MAX_VERDICT_CRITERIA)
        : [];
    // A session does not pass on the mean alone: one criterion below the threshold fails
    // the record too, which is exactly what the live gate now enforces.
    const belowThreshold = criteria.filter(entry => !(entry.score >= threshold));
    const outcome = winner === 'tie'
        ? 'tie'
        : winner === 'A' && score !== undefined && score >= threshold && belowThreshold.length === 0 ? 'passed' : 'below-threshold';
    return {
        phase,
        outcome,
        ...(score !== undefined ? { score } : {}),
        ...(baselineScore !== undefined ? { baselineScore } : {}),
        ...(criteria.length > 0 ? { criteria } : {}),
        ...(winner !== undefined ? { winner } : {}),
        threshold,
        // best-of_n reports both phases; the gate-facing rubric is the baseline one, and the drafts
        // it ranked were proposals. A plain session acceptance carries neither field.
        ...(typeof row.rankingStage === 'string' ? { reviewStage: row.rankingStage } : {}),
        ...(typeof row.baselineCriteriaSource === 'string' ? { criteriaSource: row.baselineCriteriaSource } : {}),
    };
}
const ROUTE_TRIGGERS = new Set(['turn-stopping', 'plan', 'team', 'pre-step', 'llm-stream']);
const ROUTE_STAGES = new Set(['classification', 'execution', 'final', 'skipped', 'process']);
/**
 * Bound and validate an observation before it is persisted.
 *
 * Optional by design: a record without one is a first-class shape (every explicit call, and
 * every record written before this field existed). A malformed observation is DROPPED rather
 * than allowed to fail the invocation that produced it — the observation is diagnostics, and
 * losing it must never lose the call row it describes.
 * @param input - candidate observation.
 * @returns A bounded observation, or undefined when it is not usable.
 */
function cleanRoute(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return undefined;
    if (typeof input.cycleId !== 'string' || !input.cycleId || !ROUTE_TRIGGERS.has(input.trigger) || !ROUTE_STAGES.has(input.stage))
        return undefined;
    if (typeof input.destination !== 'string' || !input.destination)
        return undefined;
    const route = {
        cycleId: input.cycleId.slice(0, 120),
        trigger: input.trigger,
        stage: input.stage,
        destination: input.destination.slice(0, 60),
    };
    const counts = ['attempt', 'reservedCalls', 'evidenceKept', 'evidenceOmitted', 'evidenceChars', 'generatedCalls', 'judgeCalls'];
    for (const key of counts) {
        const value = input[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
            route[key] = Math.trunc(value);
    }
    if (typeof input.skipReason === 'string' && input.skipReason)
        route.skipReason = input.skipReason.slice(0, 120);
    if (input.usageIncomplete === true)
        route.usageIncomplete = true;
    if (input.canceled === true)
        route.canceled = true;
    // P06: which stream was replayed is the whole point of the observation, so it must survive.
    if (input.replayed === 'original' || input.replayed === 'candidate' || input.replayed === 'none')
        route.replayed = input.replayed;
    if (input.sameCandidate === true)
        route.sameCandidate = true;
    return route;
}
function cleanVerdict(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return undefined;
    const verdict = {};
    if (typeof input.phase === 'string')
        verdict.phase = input.phase;
    if (typeof input.outcome === 'string')
        verdict.outcome = input.outcome;
    if (typeof input.reviewStage === 'string' && input.reviewStage)
        verdict.reviewStage = input.reviewStage.slice(0, 40);
    if (typeof input.criteriaSource === 'string' && input.criteriaSource)
        verdict.criteriaSource = input.criteriaSource.slice(0, 60);
    if (typeof input.score === 'number' && Number.isFinite(input.score))
        verdict.score = input.score;
    if (Array.isArray(input.scores)) {
        const scores = input.scores.filter((entry) => typeof entry === 'number' && Number.isFinite(entry)).slice(0, MAX_VERDICT_SCORES);
        if (scores.length > 0)
            verdict.scores = scores;
    }
    if (typeof input.scoreB === 'number' && Number.isFinite(input.scoreB))
        verdict.scoreB = input.scoreB;
    if (Array.isArray(input.criteria)) {
        const criteria = input.criteria
            .filter((entry) => typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && typeof entry.score === 'number' && Number.isFinite(entry.score))
            .slice(0, MAX_VERDICT_CRITERIA)
            .map(entry => ({ id: entry.id, score: entry.score }));
        if (criteria.length > 0)
            verdict.criteria = criteria;
    }
    if (typeof input.baselineScore === 'number' && Number.isFinite(input.baselineScore))
        verdict.baselineScore = input.baselineScore;
    if (input.winner === 'A' || input.winner === 'B' || input.winner === 'tie')
        verdict.winner = input.winner;
    if (typeof input.threshold === 'number' && Number.isFinite(input.threshold))
        verdict.threshold = input.threshold;
    return verdict;
}
function finite(value) { return Number.isFinite(value) ? value : 0; }
function ratio(numerator, denominator) { return denominator > 0 ? numerator / denominator : 0; }
function tokens(stats) { return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens; }
function cleanError(value) { return value === undefined ? undefined : value.slice(0, 500); }
function blankTotals() {
    return { invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, cacheHitRate: 0, prefixCacheHitRate: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 };
}
function addRecord(target, record) {
    const stats = record.stats;
    target.invocations += 1;
    record.success ? target.successes += 1 : target.failures += 1;
    target.averageDurationMs += record.durationMs;
    target.calls += stats.calls;
    target.attempts += stats.attempts;
    target.retries += stats.retries;
    target.inputTokens += stats.inputTokens;
    target.cachedInputTokens += stats.cachedInputTokens;
    target.outputTokens += stats.outputTokens;
    target.reasoningTokens += stats.reasoningTokens;
    target.tokens += tokens(stats);
    target.cacheHits += stats.cacheHits;
    target.cacheMisses += stats.cacheMisses;
    target.estimatedCostUsd += stats.estimatedCostUsd;
    target.topLogprobScores += stats.topLogprobScores;
    target.explicitTagScores += stats.explicitTagScores;
}
function finishTotals(target) {
    target.averageDurationMs = target.invocations > 0 ? target.averageDurationMs / target.invocations : 0;
    target.successRate = ratio(target.successes, target.invocations);
    target.cacheHitRate = ratio(target.cacheHits, target.cacheHits + target.cacheMisses);
    target.prefixCacheHitRate = ratio(target.cachedInputTokens, target.inputTokens + target.cachedInputTokens);
    return target;
}
function localDate(time, timezoneOffsetMinutes) {
    return new Date(time - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
function isRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    if (typeof row.id !== 'string' ||
        !VERIFIER_TOOL_NAMES.includes(row.toolName) ||
        typeof row.startedAt !== 'number' ||
        typeof row.finishedAt !== 'number' ||
        typeof row.durationMs !== 'number' ||
        typeof row.success !== 'boolean' ||
        typeof row.provider !== 'string' ||
        typeof row.model !== 'string' ||
        typeof row.stats !== 'object' ||
        row.stats === null) {
        return false;
    }
    if (row.verdict !== undefined) {
        if (typeof row.verdict !== 'object' || row.verdict === null || Array.isArray(row.verdict)) {
            return false;
        }
    }
    // Optional and NOT validated field-by-field on load: records written before this field
    // existed (and every explicit invocation) have none, and a partially-shaped observation
    // must not make an otherwise readable cost row disappear.
    if (row.route !== undefined) {
        if (typeof row.route !== 'object' || row.route === null || Array.isArray(row.route)) {
            return false;
        }
    }
    return true;
}
export function parseStatisticsQuery(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { ok: false, message: 'statistics payload must be an object' };
    }
    const row = payload;
    const fromMs = row.fromMs;
    const toMs = row.toMs;
    if (typeof fromMs !== 'number' || !Number.isFinite(fromMs) || typeof toMs !== 'number' || !Number.isFinite(toMs) || fromMs >= toMs) {
        return { ok: false, message: 'statistics range must be finite and increasing' };
    }
    const timezoneOffsetMinutes = typeof row.timezoneOffsetMinutes === 'number' && Number.isFinite(row.timezoneOffsetMinutes)
        ? row.timezoneOffsetMinutes
        : 0;
    const recentLimit = typeof row.recentLimit === 'number' && Number.isFinite(row.recentLimit)
        ? row.recentLimit
        : 40;
    const query = {
        fromMs,
        toMs,
        timezoneOffsetMinutes,
        recentLimit,
    };
    if (typeof row.sessionId === 'string' && row.sessionId.length > 0) {
        query.sessionId = row.sessionId;
    }
    return { ok: true, query };
}
export function resolveStatisticsFile(cacheFile) {
    return join(dirname(cacheFile), 'statistics-v1.json');
}
/** Combine independently persisted topic summaries for the all-topics dashboard. */
export function mergeStatisticsOverviews(overviews, query) {
    const totals = blankTotals();
    const daily = new Map();
    const tools = new Map();
    const models = new Map();
    let weightedDuration = 0;
    for (const overview of overviews) {
        const source = overview.totals;
        weightedDuration += source.averageDurationMs * source.invocations;
        for (const key of ['invocations', 'successes', 'failures', 'calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd', 'topLogprobScores', 'explicitTagScores'])
            totals[key] += source[key];
        for (const row of overview.daily) {
            const target = daily.get(row.date) ?? { date: row.date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} };
            for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'estimatedCostUsd'])
                target[key] += row[key];
            for (const [tool, count] of Object.entries(row.byTool))
                target.byTool[tool] = (target.byTool[tool] ?? 0) + count;
            daily.set(row.date, target);
        }
        for (const row of overview.tools) {
            const target = tools.get(row.toolName) ?? { toolName: row.toolName, invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0 };
            target.averageDurationMs = (target.averageDurationMs * target.invocations + row.averageDurationMs * row.invocations) / (target.invocations + row.invocations || 1);
            for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd'])
                target[key] += row[key];
            target.successRate = ratio(target.successes, target.invocations);
            tools.set(row.toolName, target);
        }
        for (const row of overview.models) {
            const key = row.provider + '\u0000' + row.model;
            const target = models.get(key) ?? { provider: row.provider, model: row.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 };
            for (const field of ['invocations', 'calls', 'tokens', 'estimatedCostUsd'])
                target[field] += row[field];
            models.set(key, target);
        }
    }
    totals.averageDurationMs = ratio(weightedDuration, totals.invocations);
    totals.successRate = ratio(totals.successes, totals.invocations);
    totals.cacheHitRate = ratio(totals.cacheHits, totals.cacheHits + totals.cacheMisses);
    totals.prefixCacheHitRate = ratio(totals.cachedInputTokens, totals.inputTokens + totals.cachedInputTokens);
    const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)));
    return {
        generatedAt: Date.now(), fromMs: query.fromMs, toMs: query.toMs,
        ...(query.sessionId ? { sessionId: query.sessionId } : {}), totals,
        daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
        tools: [...tools.values()].sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName)),
        models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
        recent: overviews.flatMap(value => value.recent).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
    };
}
export class StatisticsStore {
    file;
    maxEntries;
    loaded = false;
    hydrating;
    records = [];
    writing = Promise.resolve();
    constructor(file, maxEntries = 50_000) {
        this.file = file;
        this.maxEntries = maxEntries;
        if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0)
            throw new Error('llm-verifier: statistics maxEntries must be a positive integer');
    }
    async record(input) {
        const finishedAt = input.finishedAt ?? Date.now();
        const verdict = cleanVerdict(input.verdict);
        const route = cleanRoute(input.route);
        const record = {
            id: randomUUID(),
            toolName: input.toolName,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            startedAt: input.startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - input.startedAt),
            success: input.success,
            ...(input.errorName ? { errorName: cleanError(input.errorName) } : {}),
            ...(input.errorMessage ? { errorMessage: cleanError(input.errorMessage) } : {}),
            provider: input.provider,
            model: input.model,
            stats: { ...input.stats },
            ...(verdict !== undefined ? { verdict } : {}),
            ...(route !== undefined ? { route } : {}),
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
    async overview(query) {
        if (!Number.isFinite(query.fromMs) || !Number.isFinite(query.toMs) || query.fromMs >= query.toMs)
            throw new Error('llm-verifier: statistics range must be finite and increasing');
        await this.writing.catch(() => { });
        await this.load();
        const offset = Number.isFinite(query.timezoneOffsetMinutes) ? Math.trunc(query.timezoneOffsetMinutes ?? 0) : 0;
        const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)));
        const selected = this.records.filter(record => record.startedAt >= query.fromMs && record.startedAt < query.toMs && (query.sessionId === undefined || record.sessionId === query.sessionId));
        const totals = blankTotals();
        const daily = new Map();
        const tools = new Map();
        const models = new Map();
        for (const record of selected) {
            addRecord(totals, record);
            const date = localDate(record.startedAt, offset);
            const day = daily.get(date) ?? { date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} };
            day.invocations += 1;
            record.success ? day.successes += 1 : day.failures += 1;
            day.calls += record.stats.calls;
            day.tokens += tokens(record.stats);
            day.estimatedCostUsd += record.stats.estimatedCostUsd;
            day.byTool[record.toolName] = (day.byTool[record.toolName] ?? 0) + 1;
            daily.set(date, day);
            const tool = tools.get(record.toolName) ?? { totals: blankTotals(), duration: 0 };
            addRecord(tool.totals, record);
            tool.duration += record.durationMs;
            tools.set(record.toolName, tool);
            const modelKey = record.provider + '\u0000' + record.model;
            const model = models.get(modelKey) ?? { provider: record.provider, model: record.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 };
            model.invocations += 1;
            model.calls += record.stats.calls;
            model.tokens += tokens(record.stats);
            model.estimatedCostUsd += record.stats.estimatedCostUsd;
            models.set(modelKey, model);
        }
        finishTotals(totals);
        const toolRows = [...tools.entries()].map(([toolName, value]) => {
            const summary = finishTotals(value.totals);
            return { toolName, invocations: summary.invocations, successes: summary.successes, failures: summary.failures, successRate: summary.successRate, averageDurationMs: summary.averageDurationMs, calls: summary.calls, tokens: summary.tokens, cacheHits: summary.cacheHits, cacheMisses: summary.cacheMisses, estimatedCostUsd: summary.estimatedCostUsd };
        }).sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName));
        return {
            generatedAt: Date.now(),
            fromMs: query.fromMs,
            toMs: query.toMs,
            ...(query.sessionId ? { sessionId: query.sessionId } : {}),
            totals,
            daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
            tools: toolRows,
            models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
            recent: [...selected].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
        };
    }
    async load() {
        if (this.loaded)
            return;
        this.hydrating ??= (async () => {
            try {
                const document = JSON.parse(await readFile(this.file, 'utf8'));
                if (document.version === 1 && Array.isArray(document.records)) {
                    this.records = document.records.filter(isRecord).slice(-this.maxEntries);
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
export function emptyRunStats() {
    return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 };
}
export function errorDetails(error) {
    if (error instanceof Error)
        return { errorName: error.name || 'Error', errorMessage: error.message || String(error) };
    return { errorName: 'Error', errorMessage: String(error) };
}
//# sourceMappingURL=statistics.js.map