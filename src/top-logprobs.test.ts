import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITY_TTL_MS, TopLogprobCapabilityCache, callTopLogprobs, resolveCapabilityFile } from './top-logprobs.ts'

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
