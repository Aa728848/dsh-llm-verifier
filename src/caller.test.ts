import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestLimiter, callVerifier } from './caller.ts'
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
  it('applies timeout and retry budget to the top-logprob transport', async () => {
    const fetcher = vi.fn((_url: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const context = ctx({ providers: { openai: { api: 'openai-completions', baseURL: 'https://example.test/v1', apiKeyEnv: 'OPENAI_API_KEY' } } })
    const cfg = { ...config(async function* () { yield* streamOf(chunks()) }, vi.fn(), context), timeoutMs: 20, maxRetries: 2 }
    await expect(callVerifier(cfg, 'prompt')).rejects.toThrow(/timed out/)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('downgrades the direct transport on a non-logprob provider rejection', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":{"message":"max_tokens is too large"}}', { status: 400 }))
    vi.stubGlobal('fetch', fetcher)
    const context = ctx({ providers: { openai: { api: 'openai-completions', baseURL: 'https://example.test/v1' } } })
    let streamed = 0
    const cfg = config(async function* () { streamed += 1; yield* streamOf(chunks()) }, vi.fn(), context)
    expect((await callVerifier(cfg, 'prompt')).scoringMode).toBe('explicit-tag')
    expect(streamed).toBe(1)
    // The rejection is remembered, so the second call must not probe again.
    expect((await callVerifier(cfg, 'prompt2')).scoringMode).toBe('explicit-tag')
    expect(streamed).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(1)
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

describe('RequestLimiter', () => {
  it('does not strand queued work when an already-aborted call is queued (a)', async () => {
    const limiter = new RequestLimiter(1)
    const order: string[] = []
    const slow = limiter.run(async () => {
      await new Promise(r => setTimeout(r, 50))
      order.push('slow')
      return 'slow'
    })
    const abortedController = new AbortController()
    abortedController.abort(new Error('pre-aborted'))
    const queuedAborted = limiter.run(async () => {
      order.push('queued-aborted')
      return 'queued-aborted'
    }, abortedController.signal)
    let thirdExecuted = false
    const third = limiter.run(async () => {
      order.push('third')
      thirdExecuted = true
      return 'third'
    })

    const results = await Promise.allSettled([slow, queuedAborted, third])
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'slow' })
    expect(results[1].status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason).toEqual(new Error('pre-aborted'))
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' })
    expect(thirdExecuted).toBe(true)
    expect(order).toEqual(['slow', 'third'])
  })

  it('rejects an already-aborted signal immediately without consuming a slot (b)', async () => {
    const limiter = new RequestLimiter(1)
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))

    let ran = false
    await expect(limiter.run(async () => {
      ran = true
      return 'should-not-run'
    }, controller.signal)).rejects.toThrow('already aborted')

    expect(ran).toBe(false)

    // Verify slot was not consumed and a subsequent call runs immediately
    let secondRan = false
    const result = await limiter.run(async () => {
      secondRan = true
      return 'available'
    })
    expect(secondRan).toBe(true)
    expect(result).toBe('available')
  })

  it('recovers cleanly after an abort storm with no permanent damage (c)', async () => {
    const limiter = new RequestLimiter(2)
    const tasks: Promise<unknown>[] = []

    // 1. Occupy active slots
    for (let i = 0; i < 2; i++) {
      tasks.push(limiter.run(async () => {
        await new Promise(r => setTimeout(r, 40))
        return `initial-${i}`
      }))
    }

    // 2. Already-aborted calls
    for (let i = 0; i < 3; i++) {
      const c = new AbortController()
      c.abort(new Error(`storm-pre-aborted-${i}`))
      tasks.push(limiter.run(async () => `storm-${i}`, c.signal))
    }

    // 3. Calls that abort while waiting in queue
    const controllersToAbort: AbortController[] = []
    for (let i = 0; i < 3; i++) {
      const c = new AbortController()
      controllersToAbort.push(c)
      tasks.push(limiter.run(async () => {
        await new Promise(r => setTimeout(r, 20))
        return `queued-${i}`
      }, c.signal))
    }
    setTimeout(() => {
      for (const c of controllersToAbort) c.abort(new Error('storm-queued-abort'))
    }, 10)

    // 4. Legitimate queued calls
    for (let i = 0; i < 2; i++) {
      tasks.push(limiter.run(async () => {
        await new Promise(r => setTimeout(r, 20))
        return `valid-queued-${i}`
      }))
    }

    const settled = await Promise.allSettled(tasks)
    expect(settled).toHaveLength(10)

    // Verify limiter is completely operational and undamaged
    const fresh = await limiter.run(async () => 'fresh-call')
    expect(fresh).toBe('fresh-call')
  })

  it('hands slot to next waiter when queued waiter is aborted during wait', async () => {
    const limiter = new RequestLimiter(1)
    const task1 = limiter.run(async () => {
      await new Promise(r => setTimeout(r, 50))
      return 'task1'
    })
    const c = new AbortController()
    const task2 = limiter.run(async () => 'task2', c.signal)
    const task3 = limiter.run(async () => 'task3')

    c.abort(new Error('aborted-while-queued'))

    const results = await Promise.allSettled([task1, task2, task3])
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'task1' })
    expect(results[1].status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason).toEqual(new Error('aborted-while-queued'))
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'task3' })
  })
})
