import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
export function stableHash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function resolveCacheFile(cacheDir, cwd = process.cwd()) {
    const root = isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir);
    return join(root, 'scores-v1.json');
}
function validUsage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && Number(row[key]) >= 0);
}
function validEntry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.scoreA === 'number' && Number.isFinite(row.scoreA) && row.scoreA >= 0 && row.scoreA <= 1 && typeof row.scoreB === 'number' && Number.isFinite(row.scoreB) && row.scoreB >= 0 && row.scoreB <= 1 && validUsage(row.usage) && (row.scoringMode === undefined || row.scoringMode === 'top-logprobs' || row.scoringMode === 'explicit-tag') && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) && row.createdAt >= 0;
}
/** Channel-independent single-flight: concurrent identical tasks share one promise; joiners are flagged so callers can avoid double-counting usage. */
export class SingleFlight {
    flights = new Map();
    async run(key, task) {
        const existing = this.flights.get(key);
        if (existing !== undefined)
            return { value: await existing, joined: true };
        // task() starts synchronously so the flight is registered before its first await.
        const flight = task().finally(() => { if (this.flights.get(key) === flight)
            this.flights.delete(key); });
        this.flights.set(key, flight);
        return { value: await flight, joined: false };
    }
}
export class ScoreCache {
    file;
    maxEntries;
    loaded = false;
    entries = new Map();
    inflight = new Map();
    writing = Promise.resolve();
    constructor(file, maxEntries) {
        this.file = file;
        this.maxEntries = maxEntries;
    }
    async load() {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const document = JSON.parse(await readFile(this.file, 'utf8'));
            if (document.version !== 1 || typeof document.entries !== 'object' || document.entries === null)
                return;
            this.entries = new Map(Object.entries(document.entries).filter((entry) => validEntry(entry[1])).map(([key, value]) => [key, { ...value, scoringMode: value.scoringMode ?? 'explicit-tag' }]));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    async getOrCreate(key, create, keyFor = () => key) {
        await this.load();
        const cached = this.entries.get(key);
        if (cached !== undefined)
            return { value: cached, hit: true };
        const existing = this.inflight.get(key);
        if (existing !== undefined)
            return { value: (await existing).value, hit: true };
        // The storage key may differ from the lookup key when the actual scoring mode
        // differs from the predicted one (first-call logprobs downgrade).
        const pending = create().then(value => ({ value, key: keyFor(value) }));
        this.inflight.set(key, pending);
        try {
            const landed = await pending;
            this.entries.set(landed.key, landed.value);
            this.trim();
            await this.persist();
            return { value: landed.value, hit: false };
        }
        finally {
            this.inflight.delete(key);
        }
    }
    trim() {
        if (this.entries.size <= this.maxEntries)
            return;
        const sorted = [...this.entries].sort((a, b) => a[1].createdAt - b[1].createdAt);
        for (let index = 0; index < sorted.length - this.maxEntries; index += 1)
            this.entries.delete(sorted[index][0]);
    }
    async persist() {
        const snapshot = { version: 1, entries: Object.fromEntries(this.entries) };
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
//# sourceMappingURL=cache.js.map