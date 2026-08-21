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
