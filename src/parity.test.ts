import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ScoreCache } from './cache.ts'
import { extractProgressScore, extractScore, pivotRoundPairs } from './core.ts'
import { resolveConfig } from './config.ts'

const PYTHON_ROOT = join(import.meta.dirname, '..', '..', 'llm-as-a-verifier')
const hasPythonUpstream = existsSync(join(PYTHON_ROOT, 'llm_verifier'))

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
  const result = execFileSync('py', ['-3', '-c', script, PYTHON_ROOT], { input: JSON.stringify(compatible), encoding: 'utf8' })
  return JSON.parse(result)
}

describe('Python parity fixtures', () => {
  it.skipIf(!hasPythonUpstream)('matches literal and distribution score extraction', () => {
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
