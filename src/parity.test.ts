import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ScoreCache } from './cache.ts'
import { accumulatePairs, extractProgressScore, extractScore, pivotRoundPairs, rankScores } from './core.ts'
import { resolveConfig } from './config.ts'

const PYTHON_ROOT = join(import.meta.dirname, '..', '..', 'llm-as-a-verifier')
const hasPythonUpstream = existsSync(join(PYTHON_ROOT, 'llm_verifier'))
/** Sibling checkout path, launcher, and interpreter flag differ per platform. */
const PYTHON_BIN = process.env.DSH_VERIFIER_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3')
const PYTHON_ARGS = process.platform === 'win32' && PYTHON_BIN === 'py' ? ['-3'] : []

function python(payload: unknown): unknown {
  const script = [
    'import json,sys',
    'sys.path.insert(0, sys.argv[1])',
    'from llm_verifier.fine_grained_reward import extract_score',
    'from llm_verifier.pivot_tournament import pivot_round_pairs',
    'd=json.loads(sys.stdin.read())',
    "result = extract_score(d['text'], d['tokens'], d['positions'], d['tag']) if d['kind']=='score' else pivot_round_pairs(d['n'], d['pivots'])",
    'print(json.dumps(result))',
  ].join(';')
  const source = payload as Record<string, unknown>
  const compatible = source.kind === 'score' ? { ...source, positions: (source.positions as Array<Array<{ token: string; logprob: number }>>).map(position => position.map(item => [item.token, item.logprob])) } : source
  const result = execFileSync(PYTHON_BIN, [...PYTHON_ARGS, '-c', script, PYTHON_ROOT], { input: JSON.stringify(compatible), encoding: 'utf8' })
  return JSON.parse(result)
}

describe('Python parity fixtures', () => {
  it.skipIf(!hasPythonUpstream)('matches literal and distribution score extraction', () => {
    // Deliberately no fixture puts two surface variants of the SAME letter in one
    // position (" A" + "A") under the distribution path: this port sums them while
    // upstream keeps the max (fine_grained_reward.py:678), so such a fixture would
    // fail by design. That divergence is documented in README
    // 「与上游的一处已知差异」and pinned by core.test.ts.
    const fixtures = [
      { text: '<score_A> A </score_A>', tokens: [], positions: [], tag: '<score_A>' },
      { text: '<score_A> A </score_A> then <score_A> T </score_A>', tokens: [], positions: [], tag: '<score_A>' },
      { text: '', tokens: ['<score_A>'], positions: [[], [{ token: 'A', logprob: Math.log(0.7) }, { token: 'T', logprob: Math.log(0.3) }]], tag: '<score_A>' },
      { text: '', tokens: ['<score_A'], positions: [[], [{ token: '>B', logprob: Math.log(0.8) }, { token: '>S', logprob: Math.log(0.2) }]], tag: '<score_A>' },
    ]
    for (const fixture of fixtures) {
      const ts = extractScore(fixture, fixture.tag)
      const py = python({ kind: 'score', ...fixture }) as number
      expect(ts).toBeCloseTo(py, 12)
    }
  })
  it.skipIf(!hasPythonUpstream)('matches pivot pair generation', () => {
    expect(pivotRoundPairs(7, [1, 4, 5])).toEqual(python({ kind: 'pivot', n: 7, pivots: [1, 4, 5] }))
  })
  it('matches reversed progress convention', () => {
    expect(extractProgressScore({ text: '<c1> T </c1>', tokens: [], positions: [] }, '<c1>')).toBe(1)
  })
})

describe('DSH model routing and cache', () => {
  it('accepts any non-empty DSH provider and model route', () => {
    expect(resolveConfig({ provider: 'openai', model: 'gpt-5' })).toMatchObject({ provider: 'openai', model: 'gpt-5' })
    expect(resolveConfig({ provider: 'anthropic', model: 'claude-sonnet' })).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet' })
    expect(() => resolveConfig({ provider: '', model: 'gpt-5' })).toThrow(/provider must be non-empty/)
    expect(resolveConfig({ autoRouteMaxItemChars: 1000, autoRouteMaxInputChars: 2000, autoMaxModelCallsPerTask: 4, autoMaxModelCallsPerSession: 8 })).toMatchObject({ autoRouteMaxItemChars: 1000, autoRouteMaxInputChars: 2000, autoMaxModelCallsPerTask: 4, autoMaxModelCallsPerSession: 8 })
    expect(() => resolveConfig({ autoRouteMaxCandidates: 17 })).toThrow(/between 3 and 16/)
    expect(() => resolveConfig({ autoRouteMaxItemChars: 2000, autoRouteMaxInputChars: 3000 })).toThrow(/fit at least two/)
  })
  it('rejects malformed persisted entries and recreates them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-invalid-'))
    try {
      const file = join(dir, 'scores.json')
      writeFileSync(file, JSON.stringify({ version: 1, entries: { bad: { scoreA: 'NaN', scoreB: 0, usage: {}, createdAt: -1 } } }))
      const cache = new ScoreCache(file, 100)
      let creates = 0
      const result = await cache.getOrCreate('bad', async () => { creates++; return { scoreA: .8, scoreB: .2, usage: { calls: 1, attempts: 1, retries: 0, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 }, scoringMode: 'explicit-tag' as const, createdAt: Date.now() } })
      expect(result.hit).toBe(false); expect(creates).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('persists successful results and avoids duplicate creation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-'))
    try {
      const file = join(dir, 'scores.json')
      const first = new ScoreCache(file, 100)
      let creates = 0
      const create = async () => { creates++; return { scoreA: 1, scoreB: 0, usage: { calls: 1, attempts: 1, retries: 0, inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 }, scoringMode: 'top-logprobs' as const, createdAt: Date.now() } }
      expect((await first.getOrCreate('key', create)).hit).toBe(false)
      expect((await first.getOrCreate('key', create)).hit).toBe(true)
      const second = new ScoreCache(file, 100)
      expect((await second.getOrCreate('key', create)).hit).toBe(true)
      expect(creates).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

/**
 * Offline golden data for the algorithm contract.
 *
 * The Python suite above is the primary cross-language check, but it SKIPS when the
 * sibling checkout is absent — so a drift in the aggregation semantics could go unnoticed
 * in CI. These fixtures need no Python: they lock one recorded set of pivot pairs and the
 * two documented aggregation variants with an expectation each.
 */
describe('offline aggregation fixtures', () => {
  // Fixed reward table from the recorded review. `rewards['a,b'] = [a, b]`; the reversed
  // orientation is emitted with the scores swapped, so position preference cancels.
  const rewards = new Map<string, readonly [number, number]>()
  for (const [key, value] of Object.entries({ '0,1': [0.75, 0.25], '0,2': [0.25, 0.75], '0,3': [0.75, 0.25], '1,2': [0.75, 0.25], '1,3': [0, 1], '2,3': [0.5, 0.5] } as Record<string, readonly [number, number]>)) {
    rewards.set(key, value)
    const [a, b] = key.split(',')
    rewards.set(b + ',' + a, [value[1]!, value[0]!])
  }
  const ring: Array<[number, number]> = [[3, 2], [2, 0], [0, 1], [1, 3]]
  const unordered = (a: number, b: number) => (a < b ? a + ',' + b : b + ',' + a)
  const rank = (pairs: ReadonlyArray<readonly [number, number]>) => {
    const wins = [0, 0, 0, 0]; const counts = [0, 0, 0, 0]
    accumulatePairs(pairs, rewards, wins, counts)
    return rankScores(wins, counts)
  }
  const pivotPairs = pivotRoundPairs(4, [3, 2])
  const ringEdges = new Set(ring.map(([a, b]) => unordered(a, b)))

  it('pins upstream pivot pair generation as golden data', () => {
    expect(pivotPairs).toEqual([[0, 3], [0, 2], [1, 3], [1, 2], [2, 3]])
    expect(pivotRoundPairs(7, [1, 4, 5])).toEqual([
      [0, 1], [0, 4], [0, 5], [2, 1], [2, 4], [2, 5], [3, 1], [3, 4], [3, 5], [6, 1], [6, 4], [6, 5], [1, 4], [1, 5], [4, 5],
    ])
  })

  it('records the deliberate aggregation difference with an expectation per variant', () => {
    // Upstream accumulates the ring AND the full pivot round, so pivot/ring edges are
    // weighted twice; on this fixture its winner is candidate 3.
    const upstream = rank([...ring, ...pivotPairs])
    expect(upstream[0]!.index).toBe(3)
    expect(upstream[0]!.score).toBeCloseTo(0.5679315652, 9)
    // This port de-duplicates the overlap, judging each unordered pair once; its winner
    // is candidate 0. The two semantics genuinely disagree here, so neither may be
    // described as "the same implementation".
    const local = rank([...ring, ...pivotPairs.filter(([a, b]) => !ringEdges.has(unordered(a, b)))])
    expect(local[0]!.index).toBe(0)
    expect(local[0]!.score).toBeCloseTo(0.5408197771, 9)
  })
})
