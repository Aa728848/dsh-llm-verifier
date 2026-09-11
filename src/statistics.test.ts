import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  StatisticsStore,
  emptyRunStats,
  mergeStatisticsOverviews,
  parseStatisticsQuery,
} from './statistics.ts'

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

function stats(overrides: Partial<ReturnType<typeof emptyRunStats>> = {}) {
  return { ...emptyRunStats(), ...overrides }
}

describe('StatisticsStore', () => {
  it('records and aggregates invocations by day, tool, model, and session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    const store = new StatisticsStore(file, 100)
    const first = Date.UTC(2026, 7, 19, 23, 30)
    const second = Date.UTC(2026, 7, 20, 1, 30)
    await store.record({ toolName: 'verifier_compare', sessionId: 'one', startedAt: first, finishedAt: first + 250, success: true, provider: 'p', model: 'm', stats: stats({ calls: 2, attempts: 2, inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, cacheHits: 1, cacheMisses: 1, estimatedCostUsd: 0.12, topLogprobScores: 2 }) })
    await store.record({ toolName: 'verifier_track', sessionId: 'two', startedAt: second, finishedAt: second + 750, success: false, errorName: 'Error', errorMessage: 'failed', provider: 'p', model: 'm2', stats: stats({ calls: 1, attempts: 2, retries: 1, inputTokens: 50, outputTokens: 5, cacheMisses: 1, explicitTagScores: 1 }) })

    const all = await store.overview({ fromMs: first - 1, toMs: second + 10_000, timezoneOffsetMinutes: -120 })
    expect(all.totals).toMatchObject({ invocations: 2, successes: 1, failures: 1, calls: 3, attempts: 4, retries: 1, tokens: 185, cacheHits: 1, cacheMisses: 2 })
    expect(all.totals.successRate).toBe(0.5)
    expect(all.totals.averageDurationMs).toBe(500)
    expect(all.daily).toHaveLength(1)
    expect(all.daily[0]).toMatchObject({ date: '2026-08-20', invocations: 2, calls: 3, tokens: 185 })
    expect(all.tools.map(row => [row.toolName, row.invocations])).toEqual([['verifier_compare', 1], ['verifier_track', 1]])
    expect(all.models.map(row => row.model)).toEqual(['m', 'm2'])

    const one = await store.overview({ fromMs: first - 1, toMs: second + 10_000, sessionId: 'one' })
    expect(one.totals.invocations).toBe(1)
    expect(one.recent[0]?.sessionId).toBe('one')
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
  })

  it('serializes concurrent writes and keeps only the configured tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const store = new StatisticsStore(join(root, 'statistics.json'), 2)
    await Promise.all([0, 1, 2].map(index => store.record({ toolName: 'verifier_select', startedAt: 1_000 + index, success: true, provider: 'p', model: 'm', stats: stats() })))
    const result = await store.overview({ fromMs: 0, toMs: 10_000 })
    expect(result.totals.invocations).toBe(2)
    expect(result.recent.map(record => record.startedAt)).toEqual([1_002, 1_001])
  })

  it('merges independently persisted topic summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const first = new StatisticsStore(join(root, 'one.json'))
    const second = new StatisticsStore(join(root, 'two.json'))
    await first.record({ toolName: 'verifier_compare', sessionId: 'one', startedAt: 1, finishedAt: 11, success: true, provider: 'p', model: 'm', stats: stats() })
    await second.record({ toolName: 'verifier_track', sessionId: 'two', startedAt: 2, finishedAt: 22, success: false, provider: 'p', model: 'm', stats: stats() })
    const query = { fromMs: 0, toMs: 100, recentLimit: 10 }
    const merged = mergeStatisticsOverviews(await Promise.all([first.overview(query), second.overview(query)]), query)
    expect(merged.totals.invocations).toBe(2)
    expect(merged.totals.successes).toBe(1)
    expect(merged.totals.averageDurationMs).toBe(15)
    expect(merged.tools.map(row => row.toolName)).toEqual(['verifier_compare', 'verifier_track'])
    expect(merged.models).toHaveLength(1)
    expect(merged.recent.map(row => row.sessionId)).toEqual(['two', 'one'])
  })

  it('bounds persisted error messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const store = new StatisticsStore(join(root, 'statistics.json'))
    await store.record({ toolName: 'verifier_current_session', startedAt: 1, success: false, errorName: 'Failure', errorMessage: 'x'.repeat(1_000), provider: 'p', model: 'm', stats: stats() })
    const result = await store.overview({ fromMs: 0, toMs: 10 })
    expect(result.recent[0]?.errorMessage).toHaveLength(500)
  })

  it('normalizes legacy and modern sessionPersistence.list output formats', () => {
    const legacyHeaders = [{ id: 'sess-1', cwd: 'C:\\test' }]
    const modernSnapshots = [{ header: { id: 'sess-2', cwd: 'C:\\test' }, revision: 'rev-1' }]
    const normalize = (items: readonly unknown[]) =>
      items
        .map(item => item && typeof item === 'object' && 'header' in item ? (item as { header: { id: string } }).header : item as { id: string })
        .filter(header => header !== undefined)

    expect(normalize(legacyHeaders).map(h => h.id)).toEqual(['sess-1'])
    expect(normalize(modernSnapshots).map(h => h.id)).toEqual(['sess-2'])
  })

  it('guards cold-start hydration so concurrent operations see persisted entries and read file once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    const storeSeed = new StatisticsStore(file)
    await storeSeed.record({
      toolName: 'verifier_compare',
      startedAt: 1_000,
      finishedAt: 1_200,
      success: true,
      provider: 'p',
      model: 'm',
      stats: stats({ calls: 1 }),
    })

    readTracker.calls = []
    const freshStore = new StatisticsStore(file)
    const query = { fromMs: 0, toMs: 10_000 }

    const [all1, all2] = await Promise.all([
      freshStore.overview(query),
      freshStore.overview(query),
    ])

    expect(all1.totals.invocations).toBe(1)
    expect(all2.totals.invocations).toBe(1)
    expect(all1.recent[0]?.id).toBe(all2.recent[0]?.id)

    const fileReads = readTracker.calls.filter(p => p === file).length
    expect(fileReads).toBe(1)
  })

  it('starts empty when the statistics file does not exist (ENOENT)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'non-existent.json')
    const store = new StatisticsStore(file)
    const result = await store.overview({ fromMs: 0, toMs: 10_000 })
    expect(result.totals.invocations).toBe(0)
    expect(result.recent).toHaveLength(0)
  })

  it('propagates non-ENOENT read errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'corrupted.json')
    await writeFile(file, '{ corrupt json', 'utf8')
    const store = new StatisticsStore(file)
    await expect(store.overview({ fromMs: 0, toMs: 10_000 })).rejects.toThrow()
  })

  it('records verdict and round-trips through persistence into overview recent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    const store = new StatisticsStore(file)
    const record = await store.record({
      toolName: 'verifier_compare',
      startedAt: 100,
      finishedAt: 200,
      success: true,
      provider: 'p',
      model: 'm',
      stats: stats(),
      verdict: {
        phase: 'explicit',
        outcome: 'passed',
        score: 0.95,
        baselineScore: 0.2,
        winner: 'A',
        threshold: 0.8,
      },
    })
    expect(record.verdict).toEqual({
      phase: 'explicit',
      outcome: 'passed',
      score: 0.95,
      baselineScore: 0.2,
      winner: 'A',
      threshold: 0.8,
    })

    const freshStore = new StatisticsStore(file)
    const result = await freshStore.overview({ fromMs: 0, toMs: 1_000 })
    expect(result.recent[0]?.verdict).toEqual({
      phase: 'explicit',
      outcome: 'passed',
      score: 0.95,
      baselineScore: 0.2,
      winner: 'A',
      threshold: 0.8,
    })
  })

  it('loads old records that have no verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    await writeFile(file, JSON.stringify({
      version: 1,
      records: [
        {
          id: 'old-record-1',
          toolName: 'verifier_compare',
          startedAt: 100,
          finishedAt: 200,
          durationMs: 100,
          success: true,
          provider: 'p',
          model: 'm',
          stats: stats(),
        },
      ],
    }), 'utf8')

    const store = new StatisticsStore(file)
    const result = await store.overview({ fromMs: 0, toMs: 1_000 })
    expect(result.totals.invocations).toBe(1)
    expect(result.recent[0]?.id).toBe('old-record-1')
    expect(result.recent[0]?.verdict).toBeUndefined()
  })

  it('does not crash the load when a stored record has a malformed verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    await writeFile(file, JSON.stringify({
      version: 1,
      records: [
        {
          id: 'valid-record',
          toolName: 'verifier_compare',
          startedAt: 100,
          finishedAt: 200,
          durationMs: 100,
          success: true,
          provider: 'p',
          model: 'm',
          stats: stats(),
          verdict: { phase: 'compare', outcome: 'passed' },
        },
        {
          id: 'malformed-verdict-string',
          toolName: 'verifier_compare',
          startedAt: 150,
          finishedAt: 250,
          durationMs: 100,
          success: true,
          provider: 'p',
          model: 'm',
          stats: stats(),
          verdict: 'not an object',
        },
        {
          id: 'malformed-verdict-null',
          toolName: 'verifier_compare',
          startedAt: 160,
          finishedAt: 260,
          durationMs: 100,
          success: true,
          provider: 'p',
          model: 'm',
          stats: stats(),
          verdict: null,
        },
      ],
    }), 'utf8')

    const store = new StatisticsStore(file)
    const result = await store.overview({ fromMs: 0, toMs: 1_000 })
    expect(result.totals.invocations).toBe(1)
    expect(result.recent).toHaveLength(1)
    expect(result.recent[0]?.id).toBe('valid-record')
  })

  it('omits undefined verdict keys from persisted JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-statistics-'))
    const file = join(root, 'statistics.json')
    const store = new StatisticsStore(file)
    await store.record({
      toolName: 'verifier_track',
      startedAt: 100,
      success: true,
      provider: 'p',
      model: 'm',
      stats: stats(),
      verdict: {
        phase: 'track',
        outcome: 'passed',
        score: undefined,
        baselineScore: undefined,
        winner: undefined,
      },
    })
    await store.record({
      toolName: 'verifier_select',
      startedAt: 200,
      success: true,
      provider: 'p',
      model: 'm',
      stats: stats(),
      // no verdict supplied
    })

    const raw = JSON.parse(await readFile(file, 'utf8'))
    const withVerdict = raw.records.find((r: any) => r.toolName === 'verifier_track')
    const withoutVerdict = raw.records.find((r: any) => r.toolName === 'verifier_select')

    expect(withVerdict.verdict).toBeDefined()
    expect(Object.keys(withVerdict.verdict).sort()).toEqual(['outcome', 'phase'])
    expect('score' in withVerdict.verdict).toBe(false)
    expect('baselineScore' in withVerdict.verdict).toBe(false)
    expect('winner' in withVerdict.verdict).toBe(false)

    expect('verdict' in withoutVerdict).toBe(false)
  })
})

describe('parseStatisticsQuery', () => {
  it('round-trips a valid payload with all fields', () => {
    const result = parseStatisticsQuery({
      fromMs: 1000,
      toMs: 2000,
      timezoneOffsetMinutes: -120,
      recentLimit: 50,
      sessionId: 'sess-123',
    })
    expect(result).toEqual({
      ok: true,
      query: {
        fromMs: 1000,
        toMs: 2000,
        timezoneOffsetMinutes: -120,
        recentLimit: 50,
        sessionId: 'sess-123',
      },
    })
  })

  it('applies defaults for absent optionals and omits empty sessionId', () => {
    const result1 = parseStatisticsQuery({
      fromMs: 100,
      toMs: 200,
    })
    expect(result1).toEqual({
      ok: true,
      query: {
        fromMs: 100,
        toMs: 200,
        timezoneOffsetMinutes: 0,
        recentLimit: 40,
      },
    })

    const result2 = parseStatisticsQuery({
      fromMs: 100,
      toMs: 200,
      sessionId: '',
      extraField: 'ignored',
    })
    expect(result2).toEqual({
      ok: true,
      query: {
        fromMs: 100,
        toMs: 200,
        timezoneOffsetMinutes: 0,
        recentLimit: 40,
      },
    })
  })

  it('rejects non-object payloads with exact message', () => {
    const expected = { ok: false, message: 'statistics payload must be an object' }
    expect(parseStatisticsQuery(null)).toEqual(expected)
    expect(parseStatisticsQuery(undefined)).toEqual(expected)
    expect(parseStatisticsQuery('hello')).toEqual(expected)
    expect(parseStatisticsQuery(123)).toEqual(expected)
    expect(parseStatisticsQuery(true)).toEqual(expected)
    expect(parseStatisticsQuery([])).toEqual(expected)
  })

  it('rejects missing, NaN, string, Infinity bounds and reversed range with exact message', () => {
    const expected = { ok: false, message: 'statistics range must be finite and increasing' }
    expect(parseStatisticsQuery({})).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 100 })).toEqual(expected)
    expect(parseStatisticsQuery({ toMs: 200 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: NaN, toMs: 200 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 100, toMs: NaN })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: '100', toMs: 200 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 100, toMs: '200' })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: Infinity, toMs: 200 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 100, toMs: Infinity })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: -Infinity, toMs: 200 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 200, toMs: 100 })).toEqual(expected)
    expect(parseStatisticsQuery({ fromMs: 100, toMs: 100 })).toEqual(expected)
  })
})
