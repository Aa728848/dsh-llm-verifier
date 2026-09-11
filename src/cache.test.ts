import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { ScoreCache, resolveCacheFile, stableHash, type CachedPairScore } from './cache.ts'

const readTracker = {
  calls: [] as string[],
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      readTracker.calls.push(String(args[0]))
      return actual.readFile(...args)
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
