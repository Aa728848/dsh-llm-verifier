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
            this.entries = new Map(Object.entries(document.entries).map(([key, value]) => [key, { ...value, scoringMode: value.scoringMode ?? 'explicit-tag' }]));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    async getOrCreate(key, create) {
        await this.load();
        const cached = this.entries.get(key);
        if (cached !== undefined)
            return { value: cached, hit: true };
        const existing = this.inflight.get(key);
        if (existing !== undefined)
            return { value: await existing, hit: true };
        const pending = create();
        this.inflight.set(key, pending);
        try {
            const value = await pending;
            this.entries.set(key, value);
            this.trim();
            await this.persist();
            return { value, hit: false };
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
        this.writing = this.writing.then(async () => {
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