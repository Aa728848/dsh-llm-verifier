import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { UsageStats } from './caller.ts'

export interface CachedPairScore {
  scoreA: number
  scoreB: number
  usage: UsageStats
  scoringMode: 'top-logprobs' | 'explicit-tag'
  createdAt: number
}

interface CacheDocument {
  version: 1
  entries: Record<string, CachedPairScore>
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function resolveCacheFile(cacheDir: string, cwd = process.cwd()): string {
  const root = isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir)
  return join(root, 'scores-v1.json')
}

export class ScoreCache {
  private readonly file: string
  private readonly maxEntries: number
  private loaded = false
  private entries = new Map<string, CachedPairScore>()
  private readonly inflight = new Map<string, Promise<CachedPairScore>>()
  private writing: Promise<void> = Promise.resolve()

  constructor(file: string, maxEntries: number) {
    this.file = file
    this.maxEntries = maxEntries
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const document = JSON.parse(await readFile(this.file, 'utf8')) as CacheDocument
      if (document.version !== 1 || typeof document.entries !== 'object' || document.entries === null) return
      this.entries = new Map(Object.entries(document.entries).map(([key, value]) => [key, { ...value, scoringMode: value.scoringMode ?? 'explicit-tag' }]))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async getOrCreate(key: string, create: () => Promise<CachedPairScore>): Promise<{ value: CachedPairScore; hit: boolean }> {
    await this.load()
    const cached = this.entries.get(key)
    if (cached !== undefined) return { value: cached, hit: true }
    const existing = this.inflight.get(key)
    if (existing !== undefined) return { value: await existing, hit: true }
    const pending = create()
    this.inflight.set(key, pending)
    try {
      const value = await pending
      this.entries.set(key, value)
      this.trim()
      await this.persist()
      return { value, hit: false }
    } finally {
      this.inflight.delete(key)
    }
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return
    const sorted = [...this.entries].sort((a, b) => a[1].createdAt - b[1].createdAt)
    for (let index = 0; index < sorted.length - this.maxEntries; index += 1) this.entries.delete(sorted[index]![0])
  }

  private async persist(): Promise<void> {
    const snapshot: CacheDocument = { version: 1, entries: Object.fromEntries(this.entries) }
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp-' + process.pid
      await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
      try { await rename(temporary, this.file) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
    })
    await this.writing
  }
}
