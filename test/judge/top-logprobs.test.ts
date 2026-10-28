import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITY_TTL_MS, TopLogprobCapabilityCache, TopLogprobsBudgetError, TopLogprobsUnsupportedError, callTopLogprobs, resolveCapabilityFile, resolveTopLogprobRoute } from '../../src/judge/top-logprobs.ts'

describe('TopLogprobCapabilityCache persistence', () => {
  it('round-trips marks across instances through the capability file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const file = resolveCapabilityFile(dir)
      const first = new TopLogprobCapabilityCache(file)
      expect(first.isUnsupported('openai', 'gpt-5')).toBe(false)
      first.markUnsupported('openai', 'gpt-5')
      await first.flush()
      expect(existsSync(file)).toBe(true)

      const second = new TopLogprobCapabilityCache(file)
      await second.ensureLoaded()
      expect(second.isUnsupported('openai', 'gpt-5')).toBe(true)
      expect(second.isUnsupported('openai', 'other')).toBe(false)

      // A mark from a later instance must merge with hydrated entries, not clobber them.
      second.markUnsupported('anthropic', 'claude')
      await second.flush()
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: Record<string, number> }
      expect(raw.version).toBe(1)
      expect(Object.keys(raw.entries)).toHaveLength(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('drops marks older than the TTL on hydration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const file = join(dir, 'capabilities-v1.json')
      writeFileSync(file, JSON.stringify({ version: 1, entries: { 'openai\0gpt-5': Date.now() - CAPABILITY_TTL_MS - 1, 'openai\0fresh': Date.now() } }))
      const cache = new TopLogprobCapabilityCache(file)
      await cache.ensureLoaded()
      expect(cache.isUnsupported('openai', 'gpt-5')).toBe(false)
      expect(cache.isUnsupported('openai', 'fresh')).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('forgets a mark and persists the removal, even when it is forgotten before hydration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const file = join(dir, 'capabilities-v1.json')
      writeFileSync(file, JSON.stringify({ version: 1, entries: { 'openai\0gpt-5': Date.now(), 'openai\0keep': Date.now() } }))

      // Forgotten BEFORE the file is hydrated: hydration max-merges the file into memory, so a
      // delete that only happened up front would be undone by the write this schedule performs.
      const cache = new TopLogprobCapabilityCache(file)
      cache.forget('openai', 'gpt-5')
      await cache.flush()
      expect(cache.isUnsupported('openai', 'gpt-5')).toBe(false)
      // The other mark survives: forgetting one judge must not erase the topic's memory.
      expect(cache.isUnsupported('openai', 'keep')).toBe(true)

      // Persisted: a fresh instance (a restarted host) must not resurrect the stale answer.
      const restarted = new TopLogprobCapabilityCache(file)
      await restarted.ensureLoaded()
      expect(restarted.isUnsupported('openai', 'gpt-5')).toBe(false)
      expect(restarted.isUnsupported('openai', 'keep')).toBe(true)

      // Forgetting an unmarked judge is a no-op that still settles.
      restarted.forget('openai', 'never-marked')
      await restarted.flush()
      expect(restarted.isUnsupported('openai', 'never-marked')).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('re-probes a mark that expires while the process is running', () => {
    let now = 1_000_000
    const cache = new TopLogprobCapabilityCache(undefined, () => now)
    cache.markUnsupported('openai', 'gpt-5')
    expect(cache.isUnsupported('openai', 'gpt-5')).toBe(true)
    now += CAPABILITY_TTL_MS + 1
    expect(cache.isUnsupported('openai', 'gpt-5')).toBe(false)
  })

  it('ignores missing and corrupt capability files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const corrupt = join(dir, 'corrupt.json')
      writeFileSync(corrupt, 'not json at all')
      const corrupted = new TopLogprobCapabilityCache(corrupt)
      await expect(corrupted.ensureLoaded()).resolves.toBeUndefined()
      expect(corrupted.isUnsupported('openai', 'gpt-5')).toBe(false)

      const absent = new TopLogprobCapabilityCache(join(dir, 'absent.json'))
      await expect(absent.ensureLoaded()).resolves.toBeUndefined()
      absent.markUnsupported('openai', 'gpt-5')
      await absent.flush()
      expect(absent.isUnsupported('openai', 'gpt-5')).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('keeps the freshest mark when hydration races an in-process probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const file = join(dir, 'capabilities-v1.json')
      writeFileSync(file, JSON.stringify({ version: 1, entries: { 'openai\0gpt-5': Date.now() - 5_000 } }))
      const cache = new TopLogprobCapabilityCache(file)
      const floor = Date.now()
      cache.markUnsupported('openai', 'gpt-5')
      await cache.ensureLoaded()
      await cache.flush()
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, number> }
      expect(raw.entries['openai\0gpt-5']).toBeGreaterThanOrEqual(floor)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('keeps the in-memory-only behavior when no file is configured', async () => {
    const cache = new TopLogprobCapabilityCache()
    await expect(cache.ensureLoaded()).resolves.toBeUndefined()
    cache.markUnsupported('p', 'm')
    expect(cache.isUnsupported('p', 'm')).toBe(true)
    expect(cache.isUnsupported('p', 'other')).toBe(false)
  })

  it('survives rapid consecutive marks without clobbering temporary files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-caps-'))
    try {
      const file = resolveCapabilityFile(dir)
      const cache = new TopLogprobCapabilityCache(file)
      for (let i = 0; i < 10; i++) {
        cache.markUnsupported('provider', 'model-' + i)
      }
      await cache.flush()
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: Record<string, number> }
      expect(raw.version).toBe(1)
      expect(Object.keys(raw.entries)).toHaveLength(10)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('callTopLogprobs temperature', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends default temperature 0.2 in request body when unspecified', async () => {
    let capturedBody: any
    const mockResponse = {
      choices: [{
        message: { content: '<score_A> A </score_A>' },
        logprobs: {
          content: [
            { token: '<score_A>', logprob: 0, top_logprobs: [] },
            { token: 'A', logprob: -0.1, top_logprobs: [{ token: 'A', logprob: 0 }] },
          ],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }
    vi.stubGlobal('fetch', vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response(JSON.stringify(mockResponse), { status: 200 })
    }))

    const route = { baseURL: 'https://api.openai.com/v1', apiKey: 'test-key', deepSeekThinking: false }
    await callTopLogprobs(route, 'gpt-4o', 'test prompt', 100, undefined)
    expect(capturedBody.temperature).toBe(0.2)
  })

  it('sends explicit temperature in request body when specified', async () => {
    let capturedBody: any
    const mockResponse = {
      choices: [{
        message: { content: '<score_A> A </score_A>' },
        logprobs: {
          content: [
            { token: '<score_A>', logprob: 0, top_logprobs: [] },
            { token: 'A', logprob: -0.1, top_logprobs: [{ token: 'A', logprob: 0 }] },
          ],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }
    vi.stubGlobal('fetch', vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response(JSON.stringify(mockResponse), { status: 200 })
    }))

    const route = { baseURL: 'https://api.openai.com/v1', apiKey: 'test-key', deepSeekThinking: false }
    await callTopLogprobs(route, 'gpt-4o', 'test prompt', 100, undefined, undefined, undefined, 1, 0.7)
    expect(capturedBody.temperature).toBe(0.7)
  })
})

describe('resolveTopLogprobRoute settings seam', () => {
  const credentials = { resolve: async () => ({ value: 'secret' }) }
  const route = async (settings: unknown) => resolveTopLogprobRoute(
    { get: (name: string) => name === 'credentials' ? credentials : name === 'settings' ? settings : undefined } as never,
    'deepseek-official',
  )

  it('reads a namespace through the 0.1.1-0.1.6 register seam', async () => {
    const seen: string[] = []
    const resolved = await route({ get: (ns: string) => { seen.push(ns); return { baseURL: 'https://legacy.example/v1', apiKeyEnv: 'MY_KEY' } } })
    expect(seen).toEqual(['llm-deepseek'])
    expect(resolved).toEqual({ baseURL: 'https://legacy.example/v1', apiKey: 'secret', deepSeekThinking: true })
  })

  // DSH 0.1.7 replaced the register seam with SettingsForms, whose prototype has no
  // get() at all. Calling it threw 'settings.get is not a function' and killed the
  // whole verification; the descriptor's projected value is the public read.
  it('reads a namespace through the 0.1.7 SettingsForms seam, which has no get()', async () => {
    const forms = {
      describe: () => [{
        ns: 'llm-deepseek', revision: 0, applies: 'live',
        value: { baseURL: 'https://forms.example/v1', apiKeyEnv: 'FORM_KEY' },
      }],
    }
    expect(typeof (forms as { get?: unknown }).get).toBe('undefined')
    const resolved = await route(forms)
    expect(resolved).toEqual({ baseURL: 'https://forms.example/v1', apiKey: 'secret', deepSeekThinking: true })
  })

  // The pre-existing contract for the official channel: an unreadable namespace is
  // not an error, it falls back to the declared default endpoint. What must never
  // happen is the seam throwing out of the route resolver and killing verification.
  it('degrades to the default official endpoint instead of throwing when the seam is unusable', async () => {
    const fallback = { baseURL: 'https://api.deepseek.com', apiKey: 'secret', deepSeekThinking: true }
    // Absent service, a seam that throws, and a seam answering something unreadable.
    await expect(route(undefined)).resolves.toEqual(fallback)
    await expect(route({ describe: () => { throw new Error('boom') } })).resolves.toEqual(fallback)
    await expect(route({ describe: () => ({ nope: true }) })).resolves.toEqual(fallback)
    await expect(route({ describe: () => [] })).resolves.toEqual(fallback)
    await expect(route({ describe: () => [{ ns: 'llm-deepseek' }] })).resolves.toEqual(fallback)
  })

  // The pi-ai channel is the one that must stand down when its namespace is
  // unreadable: there is no safe default provider profile to invent.
  it('selects the matching descriptor and stands down when pi-ai has no usable profile', async () => {
    const piRoute = async (settings: unknown) => resolveTopLogprobRoute(
      { get: (name: string) => name === 'credentials' ? credentials : name === 'settings' ? settings : undefined } as never,
      'custom-provider',
    )
    await expect(piRoute({ describe: () => [
      { ns: 'llm-deepseek', value: { baseURL: 'https://not-me.example/v1' } },
    ] })).resolves.toBeUndefined()
    await expect(piRoute({ describe: () => [{ ns: 'llm-pi-ai' }] })).resolves.toBeUndefined()
    // Only an explicitly OpenAI-compatible profile is safe to serialize directly.
    await expect(piRoute({ describe: () => [
      { ns: 'llm-pi-ai', value: { providers: { 'custom-provider': { api: 'anthropic', baseURL: 'https://x.example' } } } },
    ] })).resolves.toBeUndefined()
    await expect(piRoute({ describe: () => [
      { ns: 'llm-pi-ai', value: { providers: { 'custom-provider': { api: 'openai-completions', baseURL: 'https://ok.example/v1', apiKeyEnv: 'PROVIDER_KEY' } } } },
    ] })).resolves.toEqual({ baseURL: 'https://ok.example/v1', apiKey: 'secret', deepSeekThinking: false })
  })
})
describe('callTopLogprobs no-logprob classification', () => {
  afterEach(() => vi.unstubAllGlobals())
  const route = { baseURL: 'https://api.example/v1', apiKey: 'test-key', deepSeekThinking: false }
  /** A response the provider answered but that carries no token distribution at all. */
  const answerWithoutLogprobs = (finishReason?: string) => ({
    choices: [{ message: { content: '' }, ...(finishReason === undefined ? {} : { finish_reason: finishReason }) }],
    usage: { prompt_tokens: 10, completion_tokens: 512 },
  })
  const stub = (body: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
  }

  // Reasoning ate the whole output budget. This is a configuration problem, so it must NOT be a
  // TopLogprobsUnsupportedError: callAutomatic catches that type to markUnsupported(provider, model),
  // which would remember a route whose only fault was maxTokens as "cannot do logprobs" for 24h.
  it('raises a non-capability budget error when reasoning exhausted the output budget', async () => {
    stub(answerWithoutLogprobs('length'))
    const error = await callTopLogprobs(route, 'gpt-5', 'prompt', 65536).catch(reason => reason)
    expect(error).toBeInstanceOf(TopLogprobsBudgetError)
    expect(error).not.toBeInstanceOf(TopLogprobsUnsupportedError)
    expect(error.message).toContain("finish_reason='length'")
    // The actionable half: the budget actually requested, plus both ways out.
    expect(error.message).toContain('65536')
    expect(error.message).toMatch(/raise the judge maxTokens or lower the reasoning effort/)
  })

  // The probe still answers the question it was built for: a provider that IGNORES the logprobs
  // parameter and returns a normal completion is the capability answer, and must keep marking the
  // route unsupported so the automatic channel degrades to explicit tags.
  it('keeps the capability-probe semantics when the provider simply returns no token logprobs', async () => {
    stub(answerWithoutLogprobs('stop'))
    const stopped = await callTopLogprobs(route, 'gpt-5', 'prompt', 4096).catch(reason => reason)
    expect(stopped).toBeInstanceOf(TopLogprobsUnsupportedError)
    expect(stopped).not.toBeInstanceOf(TopLogprobsBudgetError)
    expect(stopped.message).toContain('provider returned no token logprobs')
    // ...but the cause is now readable: this model stopped WITHOUT emitting an answer.
    expect(stopped.message).toContain('finish_reason=stop')
    expect(stopped.message).toContain('no answer emitted')
  })

  // A provider that omits finish_reason entirely is still a capability answer, not a budget fault.
  it('treats a missing finish_reason as an unsupported route rather than an exhausted budget', async () => {
    stub(answerWithoutLogprobs())
    const error = await callTopLogprobs(route, 'gpt-5', 'prompt', 4096).catch(reason => reason)
    expect(error).toBeInstanceOf(TopLogprobsUnsupportedError)
    expect(error).not.toBeInstanceOf(TopLogprobsBudgetError)
    expect(error.message).toContain('finish_reason=unknown')
  })
})


