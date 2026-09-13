import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VerifierClientConfig } from './caller.ts'
import { ScoreCache, SingleFlight, type CachedPairScore } from './cache.ts'
import { VerifierEngine, mergeRunStats, orientRoundPairs, partialStats } from './engine.ts'
import { emptyUsage } from './caller.ts'
import { DEFAULT_CRITERIA, PROPOSAL_CRITERIA, pivotRoundPairs } from './core.ts'
import { TopLogprobCapabilityCache } from './top-logprobs.ts'

function chunks(text: string) { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 7, cacheReadTokens: 3, outputTokens: 4, reasoningTokens: 2 } }, { type: 'finish', reason: { kind: 'stop' } }] as any[] }
async function* streamOf(items: any[]) { for (const item of items) yield item }

function clientConfig(overrides: Partial<VerifierClientConfig> = {}): VerifierClientConfig {
  return { ctx: { get: () => undefined } as any, llm: { stream: async function* () { throw new Error('unexpected model call') } } as any, attachments: { saveImage: async () => ({}) } as any, topLogprobCapabilities: new TopLogprobCapabilityCache(), provider: 'openai', model: 'gpt-5', reasoningEffort: 'high', maxTokens: 100, temperature: 0.2, timeoutMs: 1000, maxRetries: 0, retryBaseDelayMs: 1, ...overrides }
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

describe('pivot round orientation', () => {
  it('gives every ring leader both slots instead of always trajectory B', () => {
    // Regression: the pivot round emitted [candidate, pivot] for every edge, so the ring
    // leaders sat in trajectory B in ALL their extra matches — a judge that merely
    // prefers slot A then averaged 0.36 for the pivots against 0.60 for everyone else
    // and pushed the leaders to the bottom of the final ranking.
    const key = ([a, b]: readonly [number, number]) => (a < b ? a + ',' + b : b + ',' + a)
    for (const count of [4, 5, 6, 8]) {
      const pivots = [0, 1]
      const raw = pivotRoundPairs(count, pivots)
      const oriented = orientRoundPairs(raw)
      // Same unordered pairs — only the presentation order may change.
      expect(oriented).toHaveLength(raw.length)
      expect(oriented.map(key).sort()).toEqual(raw.map(key).sort())
      expect(new Set(oriented.map(key)).size).toBe(oriented.length)
      const slotA = new Map<number, number>()
      const slotB = new Map<number, number>()
      for (const [a, b] of oriented) {
        slotA.set(a, (slotA.get(a) ?? 0) + 1)
        slotB.set(b, (slotB.get(b) ?? 0) + 1)
      }
      for (const pivot of pivots) {
        const a = slotA.get(pivot) ?? 0
        const b = slotB.get(pivot) ?? 0
        expect(a, 'count=' + count + ' pivot=' + pivot + ' must not always sit in slot B').toBeGreaterThan(0)
        expect(Math.abs(a - b), 'count=' + count + ' pivot=' + pivot + ' slot balance').toBeLessThanOrEqual(1)
      }
    }
  })

  it('leaves a two-candidate select with exactly one match', () => {
    // The orientation must not invent or duplicate matches.
    const oriented = orientRoundPairs([[0, 1]])
    expect(oriented).toHaveLength(1)
    expect([oriented[0]![0], oriented[0]![1]].sort()).toEqual([0, 1])
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
  it('prefixes snapshot labels so two comparisons on the same criteria stay distinguishable', async () => {
    const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream([]) } as any }), 4)
    const labels: string[] = []
    const trace = (call: { label: string }) => { labels.push(call.label) }
    await engine.compare({ problem: 'task', candidateA: 'STRONG', candidateB: 'WEAK', repeats: 1, trace })
    // Regression: without the prefix, a best-of-N baseline comparison was indistinguishable from
    // the tournament it followed, and the snapshot read as if the judge had contradicted itself.
    await engine.compare({ problem: 'task', candidateA: 'STRONG', candidateB: 'WEAK', repeats: 1, trace, traceLabelPrefix: 'baseline: ' })
    expect(labels.filter(label => label.startsWith('baseline: '))).toHaveLength(3)
    expect(labels.filter(label => !label.startsWith('baseline: '))).toHaveLength(3)
  })

  it('uses version 6 in scoreOne cache identity with temperature (regression FIX 1)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-v6-'))
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
        version: 6,
        provider: 'openai',
        model: 'gpt-5',
        effort: 'high',
        maxTokens: 100,
        temperature: 0.2,
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
  it('does not reuse cached scores when temperature differs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-temp-'))
    try {
      const file = join(dir, 'scores.json')
      const cache = new ScoreCache(file, 100)
      const options = { problem: 'task', candidateA: 'STRONG-1', candidateB: 'WEAK-2', repeats: 1 }

      const judged1: string[] = []
      const client1 = clientConfig({ temperature: 0.2, llm: { stream: scriptedStream(judged1) } as any })
      const engine1 = new VerifierEngine(client1, 4, cache)
      const r1 = await engine1.compare(options)
      expect(r1.stats.cacheHits).toBe(0)
      expect(r1.stats.cacheMisses).toBe(3)
      expect(judged1).toHaveLength(3)

      // Identical temperature -> full hit
      const r1Repeat = await engine1.compare(options)
      expect(r1Repeat.stats.cacheHits).toBe(3)
      expect(r1Repeat.stats.cacheMisses).toBe(0)

      // Different temperature -> cache miss, runs model again
      const judged2: string[] = []
      const client2 = clientConfig({ temperature: 0.8, llm: { stream: scriptedStream(judged2) } as any })
      const engine2 = new VerifierEngine(client2, 4, cache)
      const r2 = await engine2.compare(options)
      expect(r2.stats.cacheHits).toBe(0)
      expect(r2.stats.cacheMisses).toBe(3)
      expect(judged2).toHaveLength(3)
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

  it('marks usage incomplete and keeps the failed attempts when a judge dies', async () => {
    const client1 = clientConfig({ provider: 'prov-1', model: 'model-1', llm: { stream: scriptedStream([]) } as any })
    const client2 = clientConfig({ provider: 'prov-2', model: 'model-2', llm: { stream: async function* () { throw new Error('judge 2 network timeout') } } as any })
    const engine = new VerifierEngine([client1, client2], 4)
    const result = await engine.compare({ problem: 'task', candidateA: 'STRONG-1', candidateB: 'WEAK-2', repeats: 1 })
    // The request really happened even though its usage never arrived: the row must say so
    // instead of presenting the invocation as a complete, zero-cost measurement.
    expect(result.stats.usageIncomplete).toBe(true)
    expect(result.stats.attempts).toBeGreaterThanOrEqual(1)
  })

  it('counts a channel that was downgraded from the direct transport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400 })))
    const settingsValue = { providers: { 'prov-fb': { api: 'openai-completions', baseURL: 'https://example.test/v1' } } }
    const fallback = clientConfig({
      provider: 'prov-fb',
      model: 'model-fb',
      ctx: { get: (name: string) => name === 'settings' ? { get: () => settingsValue } : name === 'credentials' ? { resolve: async () => ({ value: 'secret' }) } : undefined } as any,
      llm: { stream: scriptedStream([]) } as any,
    })
    const engine = new VerifierEngine([fallback], 2)
    const result = await engine.compare({ problem: 'task', candidateA: 'STRONG-1', candidateB: 'WEAK-2', repeats: 1 })
    expect(result.stats.channelFallbacks).toBe(1)
    // A downgrade is not a failure: the answer is usable and the usage is known.
    expect(result.stats.usageIncomplete).toBeUndefined()
  })

  it('keeps the usage of successful calls when a later criterion fails', async () => {
    const promptOf = (options: any): string => {
      const message = options.messages[0]
      return typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    }
    const criteria = [
      { id: 'a', name: 'A', description: 'first requirement' },
      { id: 'b', name: 'B', description: 'second requirement' },
      { id: 'c', name: 'C', description: 'third requirement' },
    ]
    const llm = {
      stream: (options: any) => promptOf(options).includes('third requirement')
        ? (async function* () { throw new Error('judge exploded') })()
        : streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>')),
    }
    // concurrency 1: the two successful criteria resolve before the third fails.
    const engine = new VerifierEngine(clientConfig({ llm } as any), 1)
    const error = await engine.compare({ problem: 'task', candidateA: 'AA', candidateB: 'BB', criteria, repeats: 1 }).catch(reason => reason)
    const partial = partialStats(error)
    // Two real requests completed with 7 input / 4 output tokens each, then the third died.
    expect(partial?.calls).toBe(2)
    expect(partial?.inputTokens).toBe(14)
    expect(partial?.outputTokens).toBe(8)
    expect(partial?.attempts).toBe(3)
    expect(partial?.usageIncomplete).toBe(true)
  })

  const promptTextOf = (options: any): string => {
    const message = options.messages[0]
    return typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
  }
  const threeCriteria = [
    { id: 'a', name: 'A', description: 'first requirement' },
    { id: 'b', name: 'B', description: 'second requirement' },
    { id: 'c', name: 'C', description: 'third requirement' },
  ]

  it('keeps concurrent successes that settle after an earlier failure', async () => {
    // The failure row used to be written before the other in-flight calls returned, losing them.
    const llm = {
      // The SECOND criterion fails: it shares a concurrent batch with the third, which is
      // still in flight when the failure lands. (The first is the warm-up batch, alone.)
      stream: (options: any) => promptTextOf(options).includes('second requirement')
        ? (async function* () { throw new Error('judge exploded') })()
        // Settles clearly AFTER the failure, so the assertion is deterministic rather than a
        // microtask race: only awaiting the in-flight call keeps its usage.
        : (async function* () { await new Promise(resolve => setTimeout(resolve, 5)); yield* streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>')) })(),
    }
    const engine = new VerifierEngine(clientConfig({ llm } as any), 3)
    const error = await engine.compare({ problem: 'task', candidateA: 'AA', candidateB: 'BB', criteria: threeCriteria, repeats: 1 }).catch(reason => reason)
    const partial = partialStats(error)
    expect(partial?.calls).toBe(2)
    expect(partial?.inputTokens).toBe(14)
    expect(partial?.usageIncomplete).toBe(true)
  })

  it('keeps the usage of a response that returned but failed to parse', async () => {
    let call = 0
    const llm = {
      stream: () => {
        call += 1
        const text = call <= 2 ? '<score_A> A </score_A>\n<score_B> T </score_B>' : 'reasoning with no verdict tags'
        return streamOf(chunks(text))
      },
    }
    const engine = new VerifierEngine(clientConfig({ llm } as any), 1)
    const error = await engine.compare({ problem: 'task', candidateA: 'AA', candidateB: 'BB', criteria: threeCriteria, repeats: 1 }).catch(reason => reason)
    const partial = partialStats(error)
    // Three billable responses; the third produced no score but still cost its tokens.
    expect(partial?.calls).toBe(3)
    expect(partial?.inputTokens).toBe(21)
    expect(partial?.usageIncomplete).toBe(true)
  })

  it('keeps the ring phase usage when the pivot phase fails', async () => {
    let call = 0
    const llm = {
      stream: () => {
        call += 1
        if (call > 4) throw new Error('pivot exploded')
        return streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>'))
      },
    }
    const engine = new VerifierEngine(clientConfig({ llm } as any), 1)
    const error = await engine.select({ problem: 'task', candidates: ['AAAA', 'BBBB', 'CCCC', 'DDDD'], repeats: 1 }).catch(reason => reason)
    const partial = partialStats(error)
    expect(partial?.calls).toBe(4)
    expect(partial?.inputTokens).toBe(28)
    expect(partial?.attempts).toBe(5)
    expect(partial?.usageIncomplete).toBe(true)
  })

  it('keeps every RunStats counter finite when one judge reports no usage', async () => {
    // One judge succeeds, one answers with an unusable (truncated) response. The failed judge's
    // carrier is a bare UsageStats; merging it must not turn the RunStats-only counters into NaN
    // (which serializes to null and the host rejects).
    function truncated(text: string) { const value = chunks(text); value[value.length - 1] = { type: 'finish', reason: { kind: 'max-tokens' } }; return value }
    const good = clientConfig({ llm: { stream: () => streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>')) } as any })
    const bad = clientConfig({ provider: 'openai-bad', model: 'bad-model', llm: { stream: () => streamOf(truncated('<score_A> A </score_A>')) } as any })
    const engine = new VerifierEngine([good, bad], 4)
    const result = await engine.compare({ problem: 'task', candidateA: 'AA', candidateB: 'BB', criteria: threeCriteria.slice(0, 1), repeats: 1 })
    const counters = ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd', 'topLogprobScores', 'explicitTagScores'] as const
    for (const key of counters) expect(Number.isFinite(result.stats[key]), key).toBe(true)
    // A JSON round-trip is what the host does; NaN becomes null there.
    const roundTripped = JSON.parse(JSON.stringify(result.stats)) as Record<string, unknown>
    for (const key of counters) expect(roundTripped[key], key).not.toBeNull()
    expect(result.stats.usageIncomplete).toBe(true)
  })

  it('keeps the usage of a progress response that failed to parse', async () => {
    let call = 0
    const llm = { stream: () => { call += 1; return streamOf(chunks(call <= 1 ? '<c1> T </c1>\n<c2> T </c2>' : 'no checkpoint tags')) } }
    const engine = new VerifierEngine(clientConfig({ llm } as any), 1)
    const error = await engine.track('task', ['a', 'b'], [1, 2], 2).catch(reason => reason)
    const partial = partialStats(error)
    // Two billable responses; the second produced no checkpoint but still cost its tokens.
    expect(partial?.calls).toBe(2)
    expect(partial?.inputTokens).toBe(14)
  })

  it('never folds a stats accumulator into itself', () => {
    const stats = { ...emptyUsage(), cacheHits: 2, cacheMisses: 1, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
    mergeRunStats(stats, stats)
    expect(stats.calls).toBe(0)
    expect(stats.cacheHits).toBe(2)
    expect(stats.cacheMisses).toBe(1)
  })

  it('prices the partial usage before the failure row reads it', async () => {
    // partialStats returns a normalized COPY, so pricing it in place used to be discarded and
    // the failure row recorded an estimated cost of zero.
    const llm = {
      stream: (options: any) => promptTextOf(options).includes('second requirement')
        ? (async function* () { throw new Error('judge exploded') })()
        : streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>')),
    }
    const engine = new VerifierEngine(clientConfig({ llm } as any), 1, undefined, { input: 8, output: 2 })
    const error = await engine.compare({ problem: 'task', candidateA: 'AA', candidateB: 'BB', criteria: threeCriteria, repeats: 1 }).catch(reason => reason)
    const partial = partialStats(error)
    // The first criterion succeeded: 7 input + 3 cached input + 4 output tokens.
    expect(partial?.inputTokens).toBe(7)
    expect(partial?.estimatedCostUsd).toBeCloseTo((10 * 8 + 4 * 2) / 1_000_000)
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

/** Records start/end of every model call, tagged with the A/B slot orientation of its prompt. */
function recordingStream(events: string[]): (options: any) => AsyncIterable<any[]> {
  return function (options: any) {
    const message = options.messages[0]
    const prompt = typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    const orientation = prompt.indexOf('ALPHA') < prompt.indexOf('BRAVO') ? 'AB' : 'BA'
    return (async function* () {
      events.push('start:' + orientation)
      await new Promise(resolve => setTimeout(resolve, 1))
      events.push('end:' + orientation)
      yield* streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>'))
    })()
  }
}

/** Drops any call that is not already covered by the score cache. */
function failIfCalled(): (options: any) => AsyncIterable<any[]> {
  return function () {
    throw new Error('unexpected model call')
  }
}

describe('prefix warm-up', () => {
  it('warms one call per distinct A/B slot orientation before fanning out, without extra calls', async () => {
    const events: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: { stream: recordingStream(events) } as any }), 8)
    const result = await engine.compare({ problem: 'task', candidateA: 'ALPHA', candidateB: 'BRAVO', repeats: 2 })

    // Three default criteria x two repeats = six calls. The warm-up only reorders them, and
    // odd repeats swap the slots, so each of the two prompt prefixes needs its own warm call.
    expect(result.stats.calls).toBe(6)
    // Indices, not values: the two orientations repeat, so looking a start up by its text would
    // find the earlier warm call instead of the later fan-out one.
    const startIndices = events.map((entry, index) => (entry.startsWith('start:') ? index : -1)).filter(index => index >= 0)
    expect(startIndices).toHaveLength(6)
    expect(new Set(startIndices.slice(0, 2).map(index => events[index])).size).toBe(2)
    // Nothing else starts until BOTH warm calls (one per orientation) have finished: with a
    // single warm job the whole swapped-slot half of the fan-out was a cold cache miss.
    expect(events.slice(0, startIndices[2]!).filter(entry => entry.startsWith('end:'))).toHaveLength(2)
  })

  it('warms the identical track prompt once before the repeated calls', async () => {
    const events: string[] = []
    const stream = () => (async function* () {
      events.push('start')
      await new Promise(resolve => setTimeout(resolve, 1))
      events.push('end')
      yield* streamOf(chunks('<c1> T </c1>'))
    })()
    const engine = new VerifierEngine(clientConfig({ llm: { stream } as any }), 8)
    const result = await engine.track('problem', ['step 1'], [1], 3)

    // Every repeat sends the same prompt, so repeats 2 and 3 must not start before repeat 1
    // has returned and populated the provider prefix cache.
    expect(result.stats.calls).toBe(3)
    const starts = events.map((entry, index) => (entry === 'start' ? index : -1)).filter(index => index >= 0)
    expect(starts).toHaveLength(3)
    expect(events.slice(0, starts[1]!).filter(entry => entry === 'end')).toHaveLength(1)
  })
})

describe('byte-identical candidates', () => {
  it('compares identical sides as an uninformative tie without calling the model', async () => {
    const judged: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream(judged) } as any }), 4)
    const result = await engine.compare({ problem: 'task', candidateA: 'SAME', candidateB: 'SAME', repeats: 2 })

    expect(judged).toHaveLength(0)
    expect(result.calls).toBe(0)
    expect(result.identical).toBe(true)
    expect(result.winner).toBe('tie')
    // 0.5 on both sides, not a confident 1.0: the acceptance gate must stay closed.
    expect(result.scoreA).toBe(0.5)
    expect(result.scoreB).toBe(0.5)
    expect(result.criteria.map(row => row.scoreA)).toEqual([0.5, 0.5, 0.5])
    expect(result.judges[0]).toMatchObject({ ok: true, calls: 0, winner: 'tie' })
  })

  it('ranks all-identical candidates without a single model call', async () => {
    const judged: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream(judged) } as any }), 4)
    const result = await engine.select({ problem: 'task', candidates: ['SAME', 'SAME', 'SAME'], repeats: 1 })

    expect(judged).toHaveLength(0)
    expect(result.calls).toBe(0)
    expect(result.comparisons).toBe(0)
    expect(result.identical).toBe(true)
    expect(result.best).toBe('SAME')
    expect(result.scores).toEqual([0.5, 0.5, 0.5])
    expect(result.ranking).toEqual([0, 1, 2])
    expect(result.judges[0]).toMatchObject({ ok: true, calls: 0, scores: [0.5, 0.5, 0.5] })
  })

  it('judges duplicated candidates once and maps the verdict back onto every index', async () => {
    const judged: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream(judged) } as any }), 4)
    const result = await engine.select({ problem: 'task', candidates: ['STRONG-0', 'WEAK-1', 'STRONG-0'], repeats: 1 })

    // One compared pair (two distinct candidates) x three default criteria = three calls,
    // where the duplicate would otherwise have doubled the tournament.
    expect(result.comparisons).toBe(1)
    expect(result.stats.calls).toBe(3)
    expect(judged).toHaveLength(3)
    expect(result.best).toBe('STRONG-0')
    expect(result.index).toBe(0)
    expect(result.ranking[0]).toBe(0)
    expect(result.scores).toHaveLength(3)
    // The duplicate inherits its representative's score, so no index is left undefined.
    expect(result.scores[2]).toBe(result.scores[0])
    expect(result.scores[0]).toBeGreaterThan(result.scores[1]!)
  })

  it('rejects a blank candidate instead of spending calls on it', async () => {
    const engine = new VerifierEngine(clientConfig({ llm: { stream: failIfCalled() } as any }), 4)
    await expect(engine.select({ problem: 'task', candidates: ['real work', '   '] })).rejects.toThrow(/blank/u)
    await expect(engine.select({ problem: 'task', candidates: [] })).rejects.toThrow(/must not be empty/u)
  })
})

/**
 * P02: the review stage picks the DEFAULT rubric and the prompt framing.
 *
 * A proposal has no observed output, so the artifact rubric's "compare the final verification
 * command's stdout/stderr" fails it by construction — the exact case this split exists to fix.
 * The stage is also part of the cache identity, so re-reviewing the same text as an artifact is
 * never served the proposal's scores.
 */
describe('review stage', () => {
  function textOf(options: any): string {
    const message = options.messages[0]
    return typeof message.content === 'string'
      ? message.content
      : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
  }
  /** Records every rendered prompt and always answers with the same A/T verdict. */
  function recordingPrompts(prompts: string[]) {
    return { stream: (options: any) => { prompts.push(textOf(options)); return streamOf(chunks('<score_A> A </score_A>\n<score_B> T </score_B>')) } }
  }

  it('defaults a proposal to the proposal rubric and the unexecuted framing', async () => {
    const prompts: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: recordingPrompts(prompts) } as any), 4)
    const result = await engine.compare({ problem: 'task', candidateA: 'plan STRONG', candidateB: 'plan WEAK', repeats: 1, reviewStage: 'proposal' })
    expect(result.criteria.map(row => row.id)).toEqual(PROPOSAL_CRITERIA.map(row => row.id))
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(prompt).toContain('<<<PROPOSAL_A:')
      expect(prompt).not.toContain('<<<TRAJECTORY_A:')
    }
    // One call per proposal criterion, and never the artifact ones.
    const guidelines = prompts.map(prompt => /\*\*Evaluation Guideline — (.+?):\*\*/u.exec(prompt)?.[1])
    expect(new Set(guidelines)).toEqual(new Set(PROPOSAL_CRITERIA.map(row => row.name)))
  })

  it('keeps the artifact default byte-identical in behaviour and criteria', async () => {
    const prompts: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: recordingPrompts(prompts) } as any), 4)
    const result = await engine.compare({ problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1 })
    expect(result.criteria.map(row => row.id)).toEqual(DEFAULT_CRITERIA.map(row => row.id))
    expect(prompts.some(prompt => prompt.includes('<<<TRAJECTORY_A:'))).toBe(true)
    expect(prompts.some(prompt => prompt.includes('<<<PROPOSAL_A:'))).toBe(false)
  })

  it('lets an explicit rubric override the stage default', async () => {
    const prompts: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: recordingPrompts(prompts) } as any), 4)
    const result = await engine.compare({
      problem: 'task', candidateA: 'plan STRONG', candidateB: 'plan WEAK', repeats: 1, reviewStage: 'proposal',
      criteria: [{ id: 'mine', name: 'Mine', description: 'judge only this one thing' }],
    })
    expect(result.criteria.map(row => row.id)).toEqual(['mine'])
    expect(prompts).toHaveLength(1)
    // The framing is still a proposal: the caller changed the rubric, not the stage.
    expect(prompts[0]).toContain('<<<PROPOSAL_A:')
  })

  it('keys the score cache by stage so artifact scores never answer a proposal review', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-engine-stage-'))
    try {
      const file = join(dir, 'scores.json')
      const engine = new VerifierEngine(clientConfig({ llm: { stream: scriptedStream([]) } as any }), 4, new ScoreCache(file, 100))
      const artifact = await engine.compare({ problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1 })
      expect(artifact.stats.cacheMisses).toBe(3)
      const proposal = await engine.compare({ problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1, reviewStage: 'proposal' })
      expect(proposal.stats.cacheMisses).toBe(3)
      expect(proposal.stats.cacheHits).toBe(0)
      // Same stage AND same content is still a hit: the split does not disable the cache.
      const again = await engine.compare({ problem: 'task', candidateA: 'AAA', candidateB: 'BBB', repeats: 1, reviewStage: 'proposal' })
      expect(again.stats.cacheHits).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('applies the stage to every pair of a selection', async () => {
    const prompts: string[] = []
    const engine = new VerifierEngine(clientConfig({ llm: recordingPrompts(prompts) } as any), 4)
    const result = await engine.select({ problem: 'task', candidates: ['plan STRONG', 'plan WEAK', 'plan THIRD'], repeats: 1, reviewStage: 'proposal' })
    expect(result.comparisons).toBe(3)
    // Three ring edges x three proposal criteria x one repeat.
    expect(prompts).toHaveLength(9)
    for (const prompt of prompts) expect(prompt).toContain('<<<PROPOSAL_A:')
  })
})

/**
 * Located findings have to name the object the CALLER knows, not the slot of one internal round.
 */
describe('finding identity across slots and pairs', () => {
  /** A judge that always locates the same defect in one slot of whatever it was shown. */
  function findingStream(finding: string, evidence = 'A'): (options: any) => AsyncIterable<any[]> {
    return function () {
      const text = '<finding criterion="' + DEFAULT_CRITERIA[0]!.name + '" evidence="' + evidence + '">' + finding + '</finding>\n<score_A> T </score_A>\n<score_B> A </score_B>'
      return streamOf(chunks(text))
    }
  }

  it('maps a swapped round finding back to the caller slots, not to the other candidate', async () => {
    const engine = new VerifierEngine(clientConfig({ llm: { stream: findingStream('the header is never validated') } as any }), 4)
    const result = await engine.compare({
      problem: 'Review the parser fix.',
      candidateA: 'CANDIDATE-A',
      candidateB: 'CANDIDATE-B',
      criteria: [DEFAULT_CRITERIA[0]!],
      repeats: 2,
    })
    // Repeat 0 shows the caller's A in slot A; repeat 1 swaps the slots, so the same "slot A"
    // finding must come back as the caller's B. Without the mapping both would claim evidence A.
    expect(result.diagnostics.map(diagnostic => diagnostic.evidence).sort()).toEqual(['A', 'B'])
    expect(result.diagnostics.every(diagnostic => diagnostic.finding === 'the header is never validated')).toBe(true)
    // Scores are still the caller's: the mapping must not touch arithmetic.
    expect(result.diagnostics).toHaveLength(2)
  })

  it('rewrites a tournament pair finding into the original candidate identity', async () => {
    const engine = new VerifierEngine(clientConfig({ llm: { stream: findingStream('missing verification') } as any }), 4)
    const result = await engine.select({
      problem: 'Pick the better plan.',
      candidates: ['CANDIDATE-0', 'CANDIDATE-1', 'CANDIDATE-2'],
      criteria: [DEFAULT_CRITERIA[0]!],
      repeats: 1,
    })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    // A selection has no A/B slots the caller ever saw: every finding must name a candidate.
    for (const diagnostic of result.diagnostics) expect(diagnostic.evidence).toMatch(/^candidate [123]$/)
  })

  it('maps a deduplicated selection finding back onto the caller candidate numbering', async () => {
    // [PLAN-A, PLAN-A, PLAN-B] is deduplicated to [PLAN-A, PLAN-B] before the tournament, and
    // orientPair(0, 1) keeps that order, so slot B is the caller's THIRD candidate. The scores were
    // already expanded back onto the caller's list; without the same remap the finding claimed
    // "candidate 2", which is a DIFFERENT (duplicate) entry of the caller's list.
    const engine = new VerifierEngine(clientConfig({ llm: { stream: findingStream('missing verification', 'B') } as any }), 4)
    const result = await engine.select({
      problem: 'Pick the better plan.',
      candidates: ['PLAN-A', 'PLAN-A', 'PLAN-B'],
      criteria: [DEFAULT_CRITERIA[0]!],
      repeats: 1,
    })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]!.evidence).toBe('candidate 3')
    // The compressed candidates were expanded too: a score exists for every caller entry.
    expect(result.scores).toHaveLength(3)
  })
})

