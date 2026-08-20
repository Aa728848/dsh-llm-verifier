import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { StatisticsStore, emptyRunStats, mergeStatisticsOverviews } from './statistics.ts'

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
})
