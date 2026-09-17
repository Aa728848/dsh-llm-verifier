import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { ScoreCache, resolveCacheFile, stableHash, type CachedPairScore } from './cache.ts'

const readTracker = {
  calls: [] as string[],
}

/**
 * The replace is the one step a Windows scanner can refuse at random, so the fault is injected at
 * the mocked `rename` rather than around it: `renameEperm` counts down the failures still owed,
 * and `sources` records every temporary name the cache tried to land.
 */
const renameFaults = {
  eperm: 0,
  sources: [] as string[],
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      readTracker.calls.push(String(args[0]))
      return actual.readFile(...args)
    }),
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      renameFaults.sources.push(String(args[0]))
      if (renameFaults.eperm > 0) {
        renameFaults.eperm -= 1
        const error = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return actual.rename(...args)
    }),
  }
})

describe('ScoreCache', () => {
  it('guards cold-start hydration so concurrent operations see persisted entries and read file once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'scores-v1.json')
    const key = 'test-key'
    const entry = {
      scoreA: 0.8,
      scoreB: 0.2,
      scoringMode: 'explicit-tag' as const,
      createdAt: 1_000,
      usage: {
        calls: 1,
        attempts: 1,
        retries: 0,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
      },
    }

    await writeFile(file, JSON.stringify({
      version: 1,
      entries: { [key]: entry },
    }), 'utf8')

    readTracker.calls = []
    const cache = new ScoreCache(file, 100)
    let createCalls = 0
    const create = async () => {
      createCalls++
      return { ...entry, createdAt: 2_000 }
    }

    // Kick off two getOrCreate calls concurrently
    const [res1, res2] = await Promise.all([
      cache.getOrCreate(key, create),
      cache.getOrCreate(key, create),
    ])

    expect(res1.hit).toBe(true)
    expect(res2.hit).toBe(true)
    expect(res1.value.scoreA).toBe(0.8)
    expect(res2.value.scoreA).toBe(0.8)
    expect(createCalls).toBe(0)

    const fileReads = readTracker.calls.filter(p => p === file).length
    expect(fileReads).toBe(1)
  })

  it('starts empty when the cache file does not exist (ENOENT)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'non-existent.json')
    const cache = new ScoreCache(file, 100)

    await expect(cache.load()).resolves.toBeUndefined()
    let called = false
    const result = await cache.getOrCreate('k', async () => {
      called = true
      return {
        scoreA: 0.5,
        scoreB: 0.5,
        scoringMode: 'explicit-tag',
        createdAt: 100,
        usage: { calls: 1, attempts: 1, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      }
    })
    expect(result.hit).toBe(false)
    expect(called).toBe(true)
  })

  it('propagates non-ENOENT read errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'corrupted.json')
    await writeFile(file, '{ invalid json', 'utf8')
    const cache = new ScoreCache(file, 100)

    await expect(cache.load()).rejects.toThrow()
  })

  it('persists newly created scores and trims to maxEntries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'scores-v1.json')
    const cache = new ScoreCache(file, 2)

    const dummy = (createdAt: number): CachedPairScore => ({
      scoreA: 0.5,
      scoreB: 0.5,
      scoringMode: 'explicit-tag',
      createdAt,
      usage: { calls: 1, attempts: 1, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    })

    await cache.getOrCreate('k1', async () => dummy(100))
    await cache.getOrCreate('k2', async () => dummy(200))
    await cache.getOrCreate('k3', async () => dummy(300))

    const disk = JSON.parse(await readFile(file, 'utf8'))
    expect(Object.keys(disk.entries)).toHaveLength(2)
    expect(disk.entries.k1).toBeUndefined()
    expect(disk.entries.k2).toBeDefined()
    expect(disk.entries.k3).toBeDefined()
  })

  it('resolves cache file path correctly', () => {
    expect(resolveCacheFile('C:\\foo\\bar')).toBe('C:\\foo\\bar\\scores-v1.json')
  })

  it('computes stableHash deterministically', () => {
    expect(stableHash({ a: 1, b: '2' })).toBe(stableHash({ a: 1, b: '2' }))
  })
})

describe('ScoreCache persistence across a refused replace', () => {
  const entry = (createdAt: number): CachedPairScore => ({
    scoreA: 0.5,
    scoreB: 0.5,
    scoringMode: 'explicit-tag',
    createdAt,
    usage: { calls: 1, attempts: 1, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  })

  it('lands the snapshot after a transient replace failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'scores-v1.json')
    const cache = new ScoreCache(file, 100)
    renameFaults.eperm = 2
    renameFaults.sources = []

    await cache.getOrCreate('k', async () => entry(100))

    // Both injected refusals were consumed rather than skipped...
    expect(renameFaults.eperm).toBe(0)
    // ...and the snapshot landed, so the retry re-attempted the same temporary file.
    expect(renameFaults.sources.length).toBeGreaterThanOrEqual(3)
    expect(new Set(renameFaults.sources).size).toBe(1)
    const disk = JSON.parse(await readFile(file, 'utf8'))
    expect(disk.entries.k.createdAt).toBe(100)
  })

  it('still fails the write when the replace never succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'scores-v1.json')
    const cache = new ScoreCache(file, 100)
    renameFaults.eperm = Number.MAX_SAFE_INTEGER
    renameFaults.sources = []

    await expect(cache.getOrCreate('k', async () => entry(100))).rejects.toThrow(/EPERM/)
    expect(renameFaults.sources).toHaveLength(5)
  })

  it('gives each writer its own temporary name so two caches cannot collide on one file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    const file = join(root, 'scores-v1.json')
    const first = new ScoreCache(file, 100)
    const second = new ScoreCache(file, 100)
    renameFaults.eperm = 0
    renameFaults.sources = []

    await Promise.all([
      first.getOrCreate('k1', async () => entry(100)),
      second.getOrCreate('k2', async () => entry(200)),
    ])

    // A retry reuses its own writer's name, so the distinct-name count is the writer count: under
    // the pid-only name both writers would collapse into a single entry here.
    expect(new Set(renameFaults.sources).size).toBe(2)
    expect(renameFaults.sources.length).toBeGreaterThanOrEqual(2)
  })
})
