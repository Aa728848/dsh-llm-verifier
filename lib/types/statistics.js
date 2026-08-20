import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const VERIFIER_TOOL_NAMES = ['verifier_compare', 'verifier_select', 'verifier_track', 'verifier_current_session'];
function finite(value) { return Number.isFinite(value) ? value : 0; }
function ratio(numerator, denominator) { return denominator > 0 ? numerator / denominator : 0; }
function tokens(stats) { return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens; }
function cleanError(value) { return value === undefined ? undefined : value.slice(0, 500); }
function blankTotals() {
    return { invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, cacheHitRate: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 };
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
    return target;
}
function localDate(time, timezoneOffsetMinutes) {
    return new Date(time - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
function isRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.id === 'string' && VERIFIER_TOOL_NAMES.includes(row.toolName) && typeof row.startedAt === 'number' && typeof row.finishedAt === 'number' && typeof row.durationMs === 'number' && typeof row.success === 'boolean' && typeof row.provider === 'string' && typeof row.model === 'string' && typeof row.stats === 'object' && row.stats !== null;
}
export function resolveStatisticsFile(cacheFile) {
    return join(dirname(cacheFile), 'statistics-v1.json');
}
export class StatisticsStore {
    file;
    maxEntries;
    loaded = false;
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
        this.loaded = true;
        try {
            const document = JSON.parse(await readFile(this.file, 'utf8'));
            if (document.version === 1 && Array.isArray(document.records))
                this.records = document.records.filter(isRecord).slice(-this.maxEntries);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
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