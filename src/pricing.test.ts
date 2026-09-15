import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MODELS_DEV_URL,
  PRICE_TTL_MS,
  PriceResolver,
  costUsd,
  loadCatalogTable,
  mergeProviderDocument,
  parseModelsDevDocument,
  priceKey,
  resolveCatalogDataDir,
  type PriceTable,
} from './pricing.ts'

const manual = { input: 0, output: 0, cachedInput: 0 }

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A catalog directory holding one provider document, in the installed pi-ai shape. */
function catalogDir(provider: string, document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-prices-'))
  dirs.push(dir)
  writeFileSync(join(dir, provider + '.json'), JSON.stringify(document))
  return dir
}

const PI_AI_DOCUMENT = {
  'openai-completions': {
    'deepseek-v4-flash': {
      id: 'deepseek-v4-flash',
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    },
    'no-cost-model': { id: 'no-cost-model' },
  },
}

describe('costUsd', () => {
  it('bills cached prompt tokens at their own rate instead of the input rate', () => {
    const prices = { input: 0.15, output: 0.6, cachedInput: 0.003, source: 'catalog' as const }
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }
    expect(costUsd(usage, prices)).toBeCloseTo(0.15 + 0.003, 10)
    // The old formula (inputTokens + cachedInputTokens) * input is 100x the cache-read price.
    expect(costUsd(usage, prices)).toBeLessThan(0.15 * 2)
  })

  it('prices an unpriced route at zero rather than failing', () => {
    expect(costUsd({ inputTokens: 10_000, cachedInputTokens: 90_000, outputTokens: 5_000 }, { input: 0, output: 0, cachedInput: 0, source: 'none' })).toBe(0)
  })
})

describe('catalog parsing', () => {
  it('reads the installed pi-ai shape, keyed by protocol block', () => {
    const table: PriceTable = new Map()
    expect(mergeProviderDocument('deepseek', PI_AI_DOCUMENT, table)).toBe(1)
    expect(table.get(priceKey('deepseek', 'deepseek-v4-flash'))).toEqual({ input: 0.14, output: 0.28, cachedInput: 0.0028 })
    expect(table.has(priceKey('deepseek', 'no-cost-model'))).toBe(false)
  })

  it('reads the models.dev shape, including snake_case cache fields', () => {
    const table: PriceTable = new Map()
    const added = parseModelsDevDocument({
      openrouter: { id: 'openrouter', models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
      'no-models': { id: 'no-models' },
    }, table)
    expect(added).toBe(1)
    expect(table.get(priceKey('openrouter', 'deepseek/deepseek-v4.1-flash'))).toEqual({ input: 0.15, output: 0.6, cachedInput: 0.003 })
  })

  it('loads every provider document in a directory and survives a corrupt one', () => {
    const dir = catalogDir('deepseek', PI_AI_DOCUMENT)
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const table = loadCatalogTable(dir)
    expect(table.size).toBe(1)
    expect(loadCatalogTable(join(dir, 'missing'))).toEqual(new Map())
  })

  it('finds the adapter catalog by walking the install tree, and reports none instead of guessing', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-verifier-pkg-'))
    dirs.push(root)
    const data = join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')
    mkdirSync(data, { recursive: true })
    // The plugin walks up from its own lib/ directory, which is how a profile install resolves.
    expect(resolveCatalogDataDir(join(root, 'node_modules', 'dsh-llm-verifier', 'lib'), undefined)).toBe(data)
    const empty = mkdtempSync(join(tmpdir(), 'dsh-verifier-pkg-'))
    dirs.push(empty)
    expect(resolveCatalogDataDir(empty, undefined)).toBeUndefined()
  })
})

describe('PriceResolver', () => {
  it('lets the operator typed rates win over every automatic source', async () => {
    const resolver = new PriceResolver({ catalogDir: () => catalogDir('deepseek', PI_AI_DOCUMENT), fetch: vi.fn() as never })
    const prices = await resolver.resolve('deepseek', 'deepseek-v4-flash', { manual: { input: 9, output: 9, cachedInput: 9 } })
    expect(prices).toEqual({ input: 9, output: 9, cachedInput: 9, source: 'manual' })
  })

  it('falls back to the input rate for cache reads when the operator typed only two rates', async () => {
    const resolver = new PriceResolver({})
    const prices = await resolver.resolve('x', 'y', { manual: { input: 0.5, output: 1.5, cachedInput: 0 } })
    expect(prices.cachedInput).toBe(0.5)
    expect(prices.source).toBe('manual')
  })

  it('prices a catalog route with no configuration at all', async () => {
    const resolver = new PriceResolver({ catalogDir: () => catalogDir('deepseek', PI_AI_DOCUMENT) })
    const prices = await resolver.resolve('deepseek', 'deepseek-v4-flash', { manual })
    expect(prices).toEqual({ input: 0.14, output: 0.28, cachedInput: 0.0028, source: 'catalog' })
  })

  it('consults the online snapshot only after the catalog misses, and only when enabled', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      openrouter: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
    })))
    const resolver = new PriceResolver({ catalogDir: () => catalogDir('deepseek', PI_AI_DOCUMENT), fetch: fetcher as never })
    const offline = await resolver.resolve('openrouter', 'deepseek/deepseek-v4.1-flash', { manual })
    expect(offline.source).toBe('none')
    expect(fetcher).not.toHaveBeenCalled()

    const online = await resolver.resolve('openrouter', 'deepseek/deepseek-v4.1-flash', { manual, online: true })
    expect(online).toEqual({ input: 0.15, output: 0.6, cachedInput: 0.003, source: 'online' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    // A second route reuses the cached snapshot instead of re-fetching 4.6 MB.
    await resolver.resolve('openrouter', 'deepseek/deepseek-v4.1-flash', { manual, online: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('prices a reseller route only through an explicit provider override, never by guessing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      openrouter: { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
      'nano-gpt': { models: { 'deepseek/deepseek-v4.1-flash': { cost: { input: 0.65, output: 1.45, cache_read: 0.13 } } } },
    })))
    const resolver = new PriceResolver({ catalogDir: () => undefined, fetch: fetcher as never })
    const unguarded = await resolver.resolve('command-code', 'deepseek/deepseek-v4.1-flash', { manual, online: true })
    expect(unguarded.source).toBe('none')

    const guarded = await resolver.resolve('command-code', 'deepseek/deepseek-v4.1-flash', { manual, online: true, overrideProvider: 'openrouter' })
    expect(guarded).toEqual({ input: 0.15, output: 0.6, cachedInput: 0.003, source: 'online' })
    // The override is a lookup key, not a fallback chain: the other vendor's price is never used.
    expect(guarded.input).not.toBe(0.65)
  })

  it('degrades to unpriced when the snapshot cannot be read', async () => {
    const resolver = new PriceResolver({ catalogDir: () => undefined, fetch: (async () => { throw new Error('offline') }) as never })
    expect(await resolver.resolve('p', 'm', { manual, online: true })).toEqual({ input: 0, output: 0, cachedInput: 0, source: 'none' })
    const invalid = new PriceResolver({ catalogDir: () => undefined, fetch: (async () => new Response('<html>nope</html>')) as never })
    expect(await invalid.resolve('p', 'm', { manual, online: true })).toEqual({ input: 0, output: 0, cachedInput: 0, source: 'none' })
  })

  it('single-flights concurrent online lookups and expires both tables on the TTL', async () => {
    let clock = 1_000
    const fetcher = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return new Response(JSON.stringify({ p: { models: { m: { cost: { input: 1, output: 2, cache_read: 3 } } } } }))
    })
    const resolver = new PriceResolver({ catalogDir: () => undefined, fetch: fetcher as never, now: () => clock })
    const [a, b] = await Promise.all([resolver.onlineTable(), resolver.onlineTable()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a.get(priceKey('p', 'm'))).toEqual(b.get(priceKey('p', 'm')))

    clock += PRICE_TTL_MS + 1
    await resolver.resolve('p', 'm', { manual, online: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses the documented public snapshot URL', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    await new PriceResolver({ catalogDir: () => undefined, fetch: fetcher as never }).onlineTable()
    expect(fetcher.mock.calls[0]?.[0]).toBe(MODELS_DEV_URL)
  })
})
