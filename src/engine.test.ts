import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VerifierClientConfig } from './caller.ts'
import { ScoreCache, SingleFlight, type CachedPairScore } from './cache.ts'
import { VerifierEngine } from './engine.ts'
import { TopLogprobCapabilityCache } from './top-logprobs.ts'

function chunks(text: string) { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 7, cacheReadTokens: 3, outputTokens: 4, reasoningTokens: 2 } }, { type: 'finish', reason: { kind: 'stop' } }] as any[] }
async function* streamOf(items: any[]) { for (const item of items) yield item }

function clientConfig(overrides: Partial<VerifierClientConfig> = {}): VerifierClientConfig {
  return { ctx: { get: () => undefined } as any, llm: { stream: async function* () { throw new Error('unexpected model call') } } as any, attachments: { saveImage: async () => ({}) } as any, topLogprobCapabilities: new TopLogprobCapabilityCache(), provider: 'openai', model: 'gpt-5', reasoningEffort: 'high', maxTokens: 100, timeoutMs: 1000, maxRetries: 0, retryBaseDelayMs: 1, ...overrides }
}

/** Streams an explicit-tag verdict derived from which named candidate sits in trajectory A/B. */
function scriptedStream(judged: Array<string>, gate?: Array<() => void>): (options: any) => AsyncIterable<any[]> {
  return function (options: any) {
    const message = options.messages[0]
    const prompt = typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    const section = (marker: string) => { const at = prompt.indexOf(marker); if (at < 0) return ''; const end = prompt.indexOf('\n\n**', at); return prompt.slice(at + marker.length, end < 0 ? undefined : end) }
    const traceA = section('**Trajectory A:**\n')
    const traceB = section('**Trajectory B:**\n')
    const letter = (trace: string) => trace.includes('STRONG') ? 'A' : 'T'
    const criterion = /\*\*Evaluation Guideline — (.+?):\*\*/.exec(prompt)?.[1] ?? '?'
    judged.push(criterion + '|' + [traceA.trim(), traceB.trim()].sort().join('|'))
    const text = '<score_A> ' + letter(traceA) + ' </score_A>\n<score_B> ' + letter(traceB) + ' </score_B>'
    if (gate === undefined) return streamOf(chunks(text))
    return (async function* () { await new Promise<void>(resolve => { gate.push(resolve) }); yield* streamOf(chunks(text)) })()
  }
}

/** Dissenting stream that rates STRONG as T (worst) and WEAK as A (best). */
function dissentingStream(judged: Array<string>): (options: any) => AsyncIterable<any[]> {
  return function (options: any) {
    const message = options.messages[0]
    const prompt = typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    const section = (marker: string) => { const at = prompt.indexOf(marker); if (at < 0) return ''; const end = prompt.indexOf('\n\n**', at); return prompt.slice(at + marker.length, end < 0 ? undefined : end) }
    const traceA = section('**Trajectory A:**\n')
    const traceB = section('**Trajectory B:**\n')
    const letter = (trace: string) => trace.includes('STRONG') ? 'T' : 'A'
    const criterion = /\*\*Evaluation Guideline — (.+?):\*\*/.exec(prompt)?.[1] ?? '?'
    judged.push(criterion + '|' + [traceA.trim(), traceB.trim()].sort().join('|'))
    const text = '<score_A> ' + letter(traceA) + ' </score_A>\n<score_B> ' + letter(traceB) + ' </score_B>'
    return streamOf(chunks(text))
  }
}

function progressStream(letter = 'T'): (options: any) => AsyncIterable<any[]> {
  return function () {
    const text = '<c1> ' + letter + ' </c1>\n<c2> ' + letter + ' </c2>'
    return streamOf(chunks(text))
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('VerifierEngine tournament', () => {
  it('judges each unordered candidate pair at most once and ranks the strong candidate first', async () => {
    const judged: Array<string> = []
    const llm = { stream: scriptedStream(judged) } as any
    const engine = new VerifierEngine(clientConfig({ llm }), 4)
    const candidates = ['STRONG-0', 'WEAK-1', 'WEAK-2', 'WEAK-3']
    const result = await engine.select({ problem: 'Pick the better implementation.', candidates, repeats: 1 })
    // Ring edges incident to a pivot used to be re-judged (reversed) in the pivot round.
    expect(new Set(judged).size).toBe(judged.length)
    expect(result.comparisons).toBe(new Set(judged.map(entry => entry.split('|')[1] + '|' + entry.split('|')[2])).size)
    expect(result.stats.calls).toBe(judged.length)
    expect(result.ranking[0]).toBe(0)
    expect(result.best).toBe('STRONG-0')
  })
})

describe('VerifierEngine cache identity', () => {
  it('does not reuse an explicit-tag cache entry for top-logprobs scoring', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-'))
    try {
      const file = join(dir, 'scores.json')
      const options = { problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1 }
      const fallbackCaps = new TopLogprobCapabilityCache()
      fallbackCaps.markUnsupported('openai', 'gpt-5')
      const fallback = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream([]) } as any, topLogprobCapabilities: fallbackCaps }), 4, new ScoreCache(file, 100))
      const first = await fallback.compare(options)
      expect(first.stats.explicitTagScores).toBe(3)
      expect(first.stats.cacheMisses).toBe(3)

      const alternative = (token: string, probability: number) => ({ token, logprob: Math.log(probability) })
      const body = { choices: [{ message: { content: '<score_A> A </score_A> <score_B> T </score_B>' }, logprobs: { content: [{ token: '<score_A>', logprob: 0, top_logprobs: [] }, { token: 'A', logprob: -0.1, top_logprobs: [alternative('A', 0.7), alternative('T', 0.3)] }, { token: '<score_B>', logprob: 0, top_logprobs: [] }, { token: 'T', logprob: -0.1, top_logprobs: [alternative('T', 0.8), alternative('A', 0.2)] }] } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
      const context = { get(name: string) { if (name === 'settings') return { get: () => ({ providers: { openai: { api: 'openai-completions', baseURL: 'https://example.test/v1', apiKeyEnv: 'OPENAI_API_KEY' } } }) }; if (name === 'credentials') return { resolve: async () => ({ value: 'secret' }) }; return undefined } }
      const live = new VerifierEngine(clientConfig({ ctx: context as any }), 4, new ScoreCache(file, 100))
      const second = await live.compare(options)
      expect(second.stats.topLogprobScores).toBe(3)
      expect(second.stats.cacheHits).toBe(0)
      expect(second.stats.cacheMisses).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('files a first-call explicit-tag downgrade under explicit-tag cache keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-'))
    try {
      const file = join(dir, 'scores.json')
      const options = { problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1 }
      // No settings in ctx, so the first call predicts top-logprobs but discovers no
      // route at runtime and downgrades; nothing was pre-marked unsupported.
      const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream([]) } as any }), 4, new ScoreCache(file, 100))
      const first = await engine.compare(options)
      expect(first.stats.explicitTagScores).toBe(3)
      expect(first.stats.cacheMisses).toBe(3)
      // The downgraded entries must be found by the now-explicit-tag prediction.
      const second = await engine.compare(options)
      expect(second.stats.cacheHits).toBe(3)
      expect(second.stats.calls).toBe(0)
      expect(second.stats.explicitTagScores).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('plays a single match when select is called with two candidates', async () => {
    const judged: Array<string> = []
    const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream(judged) } as any }), 4)
    const result = await engine.select({ problem: 'Pick the better implementation.', candidates: ['STRONG-0', 'WEAK-1'], repeats: 1 })
    expect(new Set(judged).size).toBe(judged.length)
    expect(result.comparisons).toBe(1)
    expect(result.index).toBe(0)
    expect(result.pivots).toEqual([])
  })
  it('uses version 5 in scoreOne cache identity (regression FIX 1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-v5-'))
    try {
      const file = join(dir, 'scores.json')
      const options = { problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1 }
      const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream([]) } as any }), 4, new ScoreCache(file, 100))
      await engine.compare(options)
      const { readFileSync } = await import('node:fs')
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      expect(raw.version).toBe(1)
      const { stableHash } = await import('./cache.ts')
      const prompt = (await import('./core.ts')).buildPairwisePrompt(options.problem, options.candidateA, options.candidateB, (await import('./core.ts')).DEFAULT_CRITERIA[0]!)
      const expectedKey = stableHash({
        version: 5,
        provider: 'openai',
        model: 'gpt-5',
        effort: 'high',
        maxTokens: 100,
        repeat: 0,
        promptHash: stableHash(prompt),
        imageKey: undefined,
        scoringMode: 'explicit-tag',
      })
      expect(raw.entries[expectedKey]).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('merges concurrent identical requests across engine instances inside the first-call downgrade window', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-'))
    try {
      const judged: Array<string> = []
      const gate: Array<() => void> = []
      const caps = new TopLogprobCapabilityCache()
      // Separate engines, shared topic flight table + cache — the index.ts assembly shape.
      const flights = new SingleFlight<{ value: CachedPairScore; hit: boolean }>()
      const cache = new ScoreCache(join(dir, 'scores.json'), 100)
      const makeEngine = () => new VerifierEngine(clientConfig({ llm: { stream: scriptedStream(judged, gate) } as any, topLogprobCapabilities: caps }), 4, cache, { input: 0, output: 0 }, flights)
      const options = { problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1, criteria: [{ id: 'one', name: 'One', description: 'single criterion' }] }
      // No settings in ctx, so t1 predicts top-logprobs but downgrades at runtime.
      const first = makeEngine().compare(options)
      caps.markUnsupported('openai', 'gpt-5')
      const second = makeEngine().compare(options)
      // Wait until the first engine's stream is actually parked on the gate (cache
      // load does real fs I/O, so a single macrotask tick is not enough), then release.
      for (let index = 0; index < 200 && gate.length === 0; index += 1) await new Promise<void>(resolve => setTimeout(resolve, 5))
      while (gate.length > 0) gate.shift()!()
      const [r1, r2] = await Promise.all([first, second])
      // One criterion, one merged model call — without the shared flight the second engine would re-run it.
      expect(judged).toHaveLength(1)
      expect(r1.stats.cacheMisses).toBe(1)
      expect(r2.stats.cacheHits).toBe(1)
      expect(r2.stats.calls).toBe(0)
      expect(r2.scoreA).toBe(r1.scoreA)
      expect(r2.scoreB).toBe(r1.scoreB)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('VerifierEngine N-judge ensemble', () => {
  it('N=1 regression: old singleClient call form produces exact scores and agreement=1', async () => {
    const judged: Array<string> = []
    const singleClient = clientConfig({ llm: { stream: scriptedStream(judged) } as any })
    const engine = new VerifierEngine(singleClient, 4)
    expect(engine.client).toBe(singleClient)
    expect(engine.clients).toEqual([singleClient])

    const result = await engine.compare({
      problem: 'Compare the two solutions.',
      candidateA: 'STRONG-1',
      candidateB: 'WEAK-2',
      repeats: 1,
    })

    expect(result.scoreA).toBe(1)
    expect(result.scoreB).toBe(0)
    expect(result.winner).toBe('A')
    expect(result.agreement).toBe(1)
    expect(result.calls).toBe(judged.length)
    expect(result.stats.calls).toBe(judged.length)

    expect(result.judges).toHaveLength(1)
    const judge = result.judges[0]!
    expect(judge.ok).toBe(true)
    expect(judge.calls).toBe(judged.length)
    expect(judge.scoreA).toBe(1)
    expect(judge.scoreB).toBe(0)
    expect(judge.winner).toBe('A')
    expect(judge.provider).toBe(singleClient.provider)
    expect(judge.model).toBe(singleClient.model)
    expect('error' in judge).toBe(false)
  })

  it('N=3 median with a dissenting judge: aggregates by median and agreement is 2/3', async () => {
    const judged1: string[] = []
    const judged2: string[] = []
    const judged3: string[] = []
    const client1 = clientConfig({ provider: 'prov-a', model: 'model-1', llm: { stream: scriptedStream(judged1) } as any })
    const client2 = clientConfig({ provider: 'prov-b', model: 'model-2', llm: { stream: scriptedStream(judged2) } as any })
    const client3 = clientConfig({ provider: 'prov-c', model: 'model-3', llm: { stream: dissentingStream(judged3) } as any })

    const engine = new VerifierEngine([client1, client2, client3], 4)
    const result = await engine.compare({
      problem: 'Pick the better implementation.',
      candidateA: 'STRONG-1',
      candidateB: 'WEAK-2',
      repeats: 1,
    })

    // Median of [1, 1, 0] is 1; mean would be 2/3 (0.6667)
    expect(result.scoreA).toBe(1)
    expect(result.scoreB).toBe(0)
    expect(result.winner).toBe('A')
    expect(result.agreement).toBe(2 / 3)

    expect(result.judges).toHaveLength(3)
    expect(result.judges[0]!.ok).toBe(true)
    expect(result.judges[0]!.winner).toBe('A')
    expect(result.judges[0]!.scoreA).toBe(1)
    expect(result.judges[0]!.scoreB).toBe(0)

    expect(result.judges[1]!.ok).toBe(true)
    expect(result.judges[1]!.winner).toBe('A')
    expect(result.judges[1]!.scoreA).toBe(1)
    expect(result.judges[1]!.scoreB).toBe(0)

    expect(result.judges[2]!.ok).toBe(true)
    expect(result.judges[2]!.winner).toBe('B')
    expect(result.judges[2]!.scoreA).toBe(0)
    expect(result.judges[2]!.scoreB).toBe(1)

    expect(result.stats.calls).toBe(judged1.length + judged2.length + judged3.length)
  })

  it('Degradation: one judge throwing does not prevent successful verification', async () => {
    const client1 = clientConfig({ provider: 'prov-1', model: 'model-1', llm: { stream: scriptedStream([]) } as any })
    const client2 = clientConfig({ provider: 'prov-2', model: 'model-2', llm: { stream: scriptedStream([]) } as any })
    const client3 = clientConfig({
      provider: 'prov-3',
      model: 'model-3',
      llm: {
        stream: async function* () {
          throw new Error('judge 3 network timeout')
        },
      } as any,
    })

    const engine = new VerifierEngine([client1, client2, client3], 4)
    const result = await engine.compare({
      problem: 'Task description',
      candidateA: 'STRONG-1',
      candidateB: 'WEAK-2',
      repeats: 1,
    })

    expect(result.scoreA).toBe(1)
    expect(result.scoreB).toBe(0)
    expect(result.winner).toBe('A')
    expect(result.agreement).toBe(1) // 2 out of 2 scoring judges agree

    expect(result.judges).toHaveLength(3)
    expect(result.judges[0]!.ok).toBe(true)
    expect(result.judges[1]!.ok).toBe(true)

    const failedJudge = result.judges[2]!
    expect(failedJudge.ok).toBe(false)
    expect(failedJudge.error).toBe('judge 3 network timeout')
    expect('scoreA' in failedJudge).toBe(false)
    expect('scoreB' in failedJudge).toBe(false)
    expect('winner' in failedJudge).toBe(false)
    expect('scores' in failedJudge).toBe(false)
    expect('ranking' in failedJudge).toBe(false)
  })

  it('All judges fail: compare rejects with the first error', async () => {
    const client1 = clientConfig({
      provider: 'prov-1',
      model: 'model-1',
      llm: {
        stream: async function* () {
          throw new Error('first judge failed completely')
        },
      } as any,
    })
    const client2 = clientConfig({
      provider: 'prov-2',
      model: 'model-2',
      llm: {
        stream: async function* () {
          throw new Error('second judge failed completely')
        },
      } as any,
    })

    const engine = new VerifierEngine([client1, client2], 4)
    await expect(
      engine.compare({ problem: 'task', candidateA: 'A', candidateB: 'B', repeats: 1 })
    ).rejects.toThrow('first judge failed completely')
  })

  it('Per-judge caching: shared ScoreCache yields full hit on repeat, distinct identities do not collide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cache-judges-'))
    try {
      const file = join(dir, 'scores.json')
      const cache = new ScoreCache(file, 100)
      const judged1: string[] = []
      const judged2: string[] = []
      const client1 = clientConfig({ provider: 'prov-x', model: 'model-x', llm: { stream: scriptedStream(judged1) } as any })
      const client2 = clientConfig({ provider: 'prov-y', model: 'model-y', llm: { stream: scriptedStream(judged2) } as any })
      const engine = new VerifierEngine([client1, client2], 4, cache)
      const options = { problem: 'task', candidateA: 'STRONG-1', candidateB: 'WEAK-2', repeats: 1 }

      const r1 = await engine.compare(options)
      expect(r1.judges[0]?.calls).toBe(3)
      expect(r1.judges[1]?.calls).toBe(3)
      expect(r1.stats.calls).toBe(6)
      expect(r1.stats.cacheHits).toBe(0)
      expect(r1.stats.cacheMisses).toBe(6)

      // Second identical compare is a full cache hit for both judges (calls === 0)
      const r2 = await engine.compare(options)
      expect(r2.judges[0]?.calls).toBe(0)
      expect(r2.judges[1]?.calls).toBe(0)
      expect(r2.stats.calls).toBe(0)
      expect(r2.stats.cacheHits).toBe(6)
      expect(r2.stats.cacheMisses).toBe(0)

      // Changed judge identity does not read other judges' entries
      const judged3: string[] = []
      const client3 = clientConfig({ provider: 'prov-z', model: 'model-z', llm: { stream: scriptedStream(judged3) } as any })
      const engine3 = new VerifierEngine([client3], 4, cache)
      const r3 = await engine3.compare(options)
      expect(r3.judges[0]?.calls).toBe(3)
      expect(r3.stats.calls).toBe(3)
      expect(r3.stats.cacheHits).toBe(0)
      expect(r3.stats.cacheMisses).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('select with 3 judges: judges has one entry per judge with scores/ranking and strong ranks first', async () => {
    const judged1: string[] = []
    const judged2: string[] = []
    const judged3: string[] = []
    const client1 = clientConfig({ provider: 'p1', model: 'm1', llm: { stream: scriptedStream(judged1) } as any })
    const client2 = clientConfig({ provider: 'p2', model: 'm2', llm: { stream: scriptedStream(judged2) } as any })
    const client3 = clientConfig({ provider: 'p3', model: 'm3', llm: { stream: scriptedStream(judged3) } as any })
    const engine = new VerifierEngine([client1, client2, client3], 4)
    const candidates = ['STRONG-0', 'WEAK-1', 'WEAK-2', 'WEAK-3']

    const result = await engine.select({ problem: 'Pick the better implementation.', candidates, repeats: 1 })
    expect(result.best).toBe('STRONG-0')
    expect(result.ranking[0]).toBe(0)
    expect(result.judges).toHaveLength(3)

    for (const j of result.judges) {
      expect(j.ok).toBe(true)
      expect(j.calls).toBeGreaterThan(0)
      expect(j.scores).toBeDefined()
      expect(j.scores).toHaveLength(4)
      expect(j.ranking).toBeDefined()
      expect(j.ranking?.[0]).toBe(0)
      expect('error' in j).toBe(false)
    }

    const totalJudgeCalls = result.judges.reduce((sum, j) => sum + j.calls, 0)
    expect(result.stats.calls).toBe(totalJudgeCalls)
  })

  it('select with 2 candidates and multiple judges: single match played and judges populated', async () => {
    const judged1: string[] = []
    const judged2: string[] = []
    const client1 = clientConfig({ provider: 'p1', model: 'm1', llm: { stream: scriptedStream(judged1) } as any })
    const client2 = clientConfig({ provider: 'p2', model: 'm2', llm: { stream: scriptedStream(judged2) } as any })
    const engine = new VerifierEngine([client1, client2], 4)
    const candidates = ['STRONG-0', 'WEAK-1']

    const result = await engine.select({ problem: 'Pick between two', candidates, repeats: 1 })
    expect(result.comparisons).toBe(1)
    expect(result.index).toBe(0)
    expect(result.best).toBe('STRONG-0')
    expect(result.judges).toHaveLength(2)
    for (const j of result.judges) {
      expect(j.ok).toBe(true)
      expect(j.scores).toHaveLength(2)
      expect(j.ranking).toEqual([0, 1])
    }
  })

  it('select with 1 candidate and multiple judges: immediate return with judges populated', async () => {
    const client1 = clientConfig({ provider: 'p1', model: 'm1' })
    const client2 = clientConfig({ provider: 'p2', model: 'm2' })
    const engine = new VerifierEngine([client1, client2], 4)

    const result = await engine.select({ problem: 'Pick single', candidates: ['ONLY-0'] })
    expect(result.index).toBe(0)
    expect(result.best).toBe('ONLY-0')
    expect(result.comparisons).toBe(0)
    expect(result.calls).toBe(0)
    expect(result.judges).toHaveLength(2)
    for (const j of result.judges) {
      expect(j.ok).toBe(true)
      expect(j.calls).toBe(0)
      expect(j.scores).toEqual([1])
      expect(j.ranking).toEqual([0])
    }
  })

  it('select degradation: failing judge has ok:false, surviving judges have rankings', async () => {
    const client1 = clientConfig({ provider: 'p1', model: 'm1', llm: { stream: scriptedStream([]) } as any })
    const client2 = clientConfig({
      provider: 'p2',
      model: 'm2',
      llm: {
        stream: async function* () {
          throw new Error('p2 crashed in select')
        },
      } as any,
    })
    const engine = new VerifierEngine([client1, client2], 4)
    const candidates = ['STRONG-0', 'WEAK-1', 'WEAK-2']

    const result = await engine.select({ problem: 'Pick better', candidates, repeats: 1 })
    expect(result.best).toBe('STRONG-0')
    expect(result.ranking[0]).toBe(0)
    expect(result.judges).toHaveLength(2)

    expect(result.judges[0]!.ok).toBe(true)
    expect(result.judges[0]!.scores).toBeDefined()
    expect(result.judges[0]!.ranking).toBeDefined()

    expect(result.judges[1]!.ok).toBe(false)
    expect(result.judges[1]!.error).toBe('p2 crashed in select')
    expect('scores' in result.judges[1]!).toBe(false)
    expect('ranking' in result.judges[1]!).toBe(false)
  })

  it('track with multiple judges: aggregates checkpoint scores and returns per-judge scores', async () => {
    const client1 = clientConfig({ provider: 'p1', model: 'm1', llm: { stream: progressStream('T') } as any })
    const client2 = clientConfig({ provider: 'p2', model: 'm2', llm: { stream: progressStream('T') } as any })
    const engine = new VerifierEngine([client1, client2], 4)

    const result = await engine.track('Test problem', ['step 1', 'step 2'], [1, 2], 1)
    expect(result.scores).toEqual([1, 1])
    expect(result.judges).toHaveLength(2)
    for (const j of result.judges) {
      expect(j.ok).toBe(true)
      expect(j.scores).toEqual([1, 1])
      expect('error' in j).toBe(false)
    }
  })

  it('track degradation: one judge fails, surviving judge scores are used', async () => {
    const client1 = clientConfig({ provider: 'p1', model: 'm1', llm: { stream: progressStream('T') } as any })
    const client2 = clientConfig({
      provider: 'p2',
      model: 'm2',
      llm: {
        stream: async function* () {
          throw new Error('track failed for p2')
        },
      } as any,
    })
    const engine = new VerifierEngine([client1, client2], 4)

    const result = await engine.track('Test problem', ['step 1', 'step 2'], [1, 2], 1)
    expect(result.scores).toEqual([1, 1])
    expect(result.judges).toHaveLength(2)
    expect(result.judges[0]!.ok).toBe(true)
    expect(result.judges[0]!.scores).toEqual([1, 1])
    expect(result.judges[1]!.ok).toBe(false)
    expect(result.judges[1]!.error).toBe('track failed for p2')
    expect('scores' in result.judges[1]!).toBe(false)
  })

  it('track all judges fail: rejects with first error', async () => {
    const client1 = clientConfig({
      provider: 'p1',
      model: 'm1',
      llm: {
        stream: async function* () {
          throw new Error('track failed completely 1')
        },
      } as any,
    })
    const client2 = clientConfig({
      provider: 'p2',
      model: 'm2',
      llm: {
        stream: async function* () {
          throw new Error('track failed completely 2')
        },
      } as any,
    })
    const engine = new VerifierEngine([client1, client2], 4)

    await expect(engine.track('Test problem', ['step 1'], [1], 1)).rejects.toThrow('track failed completely 1')
  })
})
