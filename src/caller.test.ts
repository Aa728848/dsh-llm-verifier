import { afterEach, describe, expect, it, vi } from 'vitest'
import { callVerifier } from './caller.ts'
import { TopLogprobCapabilityCache } from './top-logprobs.ts'

function chunks(text = '<score_A> A </score_A>') { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'usage', usage: { inputTokens: 7, cacheReadTokens: 3, outputTokens: 4, reasoningTokens: 2 } }, { type: 'finish', reason: { kind: 'stop' } }] as any[] }
function ctx(settingsValue?: unknown) { return { get(name: string) { if (name === 'settings' && settingsValue !== undefined) return { get: () => settingsValue }; if (name === 'credentials') return { resolve: async () => ({ value: 'secret' }) }; return undefined } } as any }
function config(stream: (options: any) => AsyncIterable<any>, saveImage = vi.fn(), context = ctx()) { return { ctx: context, llm: { stream } as any, attachments: { saveImage } as any, topLogprobCapabilities: new TopLogprobCapabilityCache(), provider: 'openai', model: 'gpt-5', reasoningEffort: 'high', maxTokens: 100, timeoutMs: 1000, maxRetries: 2, retryBaseDelayMs: 1 } }
async function* streamOf(items: any[]) { for (const item of items) yield item }
afterEach(() => vi.unstubAllGlobals())

describe('automatic verifier scoring', () => {
  it('falls back to explicit A-T tags when the route has no safe logprob transport', async () => {
    let seen: any
    const result = await callVerifier(config(async function* (options) { seen = options; yield* streamOf(chunks()) }), 'prompt')
    expect(seen.provider).toBe('openai'); expect(result.scoringMode).toBe('explicit-tag')
  })
  it('uses top-logprob distributions on an explicit OpenAI-compatible route', async () => {
    const body = { choices: [{ message: { content: '<score_A> A </score_A>' }, logprobs: { content: [{ token: '<score_A>', logprob: 0, top_logprobs: [] }, { token: 'A', logprob: -0.1, top_logprobs: [{ token: 'A', logprob: Math.log(0.7) }, { token: 'T', logprob: Math.log(0.3) }] }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    let streamed = false
    const context = ctx({ providers: { openai: { api: 'openai-completions', baseURL: 'https://example.test/v1', apiKeyEnv: 'OPENAI_API_KEY' } } })
    const result = await callVerifier(config(async function* () { streamed = true; yield* streamOf(chunks()) }, vi.fn(), context), 'prompt')
    expect(result.scoringMode).toBe('top-logprobs'); expect(result.positions[1]?.length).toBe(2); expect(streamed).toBe(false)
  })
  it('remembers a provider logprob rejection and falls back through DSH', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":{"message":"logprobs unsupported"}}', { status: 400 }))
    vi.stubGlobal('fetch', fetcher)
    const context = ctx({ providers: { openai: { api: 'openai-completions', baseURL: 'https://example.test/v1' } } })
    const cfg = config(async function* () { yield* streamOf(chunks()) }, vi.fn(), context)
    expect((await callVerifier(cfg, 'prompt')).scoringMode).toBe('explicit-tag')
    expect((await callVerifier(cfg, 'prompt2')).scoringMode).toBe('explicit-tag')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
