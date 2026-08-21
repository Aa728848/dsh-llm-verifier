import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_TTL_MS, TopLogprobCapabilityCache, resolveCapabilityFile } from './top-logprobs.ts'

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
