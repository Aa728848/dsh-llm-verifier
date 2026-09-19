/**
 * Automatic USD pricing for one judge route.
 *
 * Why this module exists: the harness ships no price to plugins. `@deepseek-ai/dsh-llm`
 * exposes usage tokens and `resolveModel` metadata, never money, and `llm-pi-ai`
 * deliberately zeroes pi-ai's own `cost` metadata ("The harness never reads pi-ai's cost
 * metadata … no consumer reports spend"). Before this module the operator had to type two
 * USD-per-million rates by hand and every statistics row stayed $0 until they did.
 *
 * Four sources, in order, each best-effort and independently degradable:
 * 1. the operator's explicit rates (`estimated*UsdPerMillion`) — they always win;
 * 2. the installed pi-ai provider catalog on disk (`@earendil-works/pi-ai/dist/providers/data`),
 *    the same models.dev snapshot the host itself carries, cached in-process;
 * 3. models.dev over HTTPS, cached for the same TTL, consulted only when 2 misses;
 * 4. `none` — zero, which the statistics UI treats as "not priced" rather than as "free".
 *
 * A route may be a reseller whose provider id is in neither table (the bundled catalog does
 * not ship `command-code`, and models.dev has no such provider). The optional
 * `priceProviderOverride` makes that explicit: it names the provider whose list price the
 * operator chose to follow. Nothing is ever guessed across providers — the same model id is
 * listed at 0.10/0.40 by one vendor and 0.65/1.45 by another, so a silent cross-provider
 * guess would put a fabricated number in a cost column.
 *
 * Every failure (package not installed, unreadable file, network error, unknown shape)
 * degrades to the next source and finally to `none`: this module never throws, so automatic
 * pricing can never block or fail a verification.
 *
 * @module dsh-llm-verifier/pricing
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the rates in effect came from; reported by the judge probe. */
export type PriceSource = 'manual' | 'catalog' | 'online' | 'none'

/** USD per million tokens for one route. */
export interface TokenPrices {
  input: number
  output: number
  /** Price of a prompt token served from cache, which is typically 10–50x cheaper than `input`. */
  cachedInput: number
  source: PriceSource
}

/** Operator-configured rates, before any automatic lookup. */
export interface ManualPrices {
  input: number
  output: number
  cachedInput: number
}

/** The token counts a cost estimate needs; a structural subset of `RunStats`. */
export interface PricedUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

/** Rates for a route nothing could price. */
export const UNPRICED: TokenPrices = { input: 0, output: 0, cachedInput: 0, source: 'none' }

/** One route's rates inside a price table. */
export interface PriceTableEntry {
  input: number
  output: number
  cachedInput: number
}

/** `provider\0model` → rates. */
export type PriceTable = Map<string, PriceTableEntry>

/**
 * USD cost of one usage figure under a rate table.
 *
 * Cached prompt tokens are billed at their own rate instead of the full input rate. The old
 * formula added them to `inputTokens` and multiplied by the input price, which over-reported
 * every cache-heavy call by the cache-read discount — on a real acceptance run
 * (2,374 uncached + 134,912 cached input tokens) that is the difference between ~$0.0004 and
 * an order of magnitude more.
 * @param usage - token counts of the call.
 * @param prices - rates in effect for the route that produced them.
 * @returns The estimated cost in USD.
 */
export function costUsd(usage: PricedUsage, prices: Omit<TokenPrices, 'source'>): number {
  return (usage.inputTokens * prices.input + usage.cachedInputTokens * prices.cachedInput + usage.outputTokens * prices.output) / 1_000_000
}

/** Identity of one route inside a {@link PriceTable}. */
export function priceKey(provider: string, model: string): string {
  return provider + '\u0000' + model
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Reads one `{input, output, cacheRead|cache_read}` record; `undefined` when nothing usable is there. */
export function priceEntry(value: unknown): PriceTableEntry | undefined {
  const row = object(value)
  if (row === undefined) return undefined
  const input = rate(row.input)
  const output = rate(row.output)
  if (input === undefined || output === undefined) return undefined
  return { input, output, cachedInput: rate(row.cacheRead) ?? rate(row.cache_read) ?? input }
}

/**
 * Merge one provider document into a table.
 *
 * Accepts both shapes this module reads: the pi-ai catalog (`{ api: { modelId: { cost } } }`,
 * `cost` nested) and models.dev (`{ models: { modelId: { cost } } }`, model keys at the top of
 * the provider object). Unrecognized entries are skipped, never fatal.
 * @param provider - provider id the models belong to.
 * @param document - parsed provider document.
 * @param into - table to merge into.
 * @returns How many models were added.
 */
export function mergeProviderDocument(provider: string, document: unknown, into: PriceTable): number {
  const root = object(document)
  if (root === undefined) return 0
  const models: Record<string, unknown> = {}
  // pi-ai: one key per wire protocol, each holding { modelId: model }.
  for (const [key, value] of Object.entries(root)) {
    if (key === 'models') continue
    const block = object(value)
    if (block === undefined) continue
    for (const [id, model] of Object.entries(block)) models[id] = model
  }
  // models.dev: a single { models: { modelId: model } } block.
  for (const [id, model] of Object.entries(object(root.models) ?? {})) models[id] = model
  let added = 0
  for (const [id, model] of Object.entries(models)) {
    const row = object(model)
    if (row === undefined) continue
    const entry = priceEntry(row.cost)
    if (entry === undefined) continue
    into.set(priceKey(provider, id), entry)
    added += 1
  }
  return added
}

/** Parses one models.dev snapshot (`{ provider: { models } }`) into a table. */
export function parseModelsDevDocument(document: unknown, into: PriceTable): number {
  let added = 0
  for (const [provider, value] of Object.entries(object(document) ?? {})) added += mergeProviderDocument(provider, value, into)
  return added
}

/** The catalog inside one package root, if the adapter is installed there. */
function catalogUnder(root: string): string | undefined {
  const candidate = join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * Locate the installed pi-ai catalog directory.
 *
 * The package's `exports` map publishes no subpath, so a module resolver cannot even name its
 * files and this walks the filesystem instead: upward from this module (the plugin normally
 * sits in the same `profiles/<name>/node_modules` tree as the adapter), then the host profile
 * directories for a plugin loaded straight from a checkout. `DSH_VERIFIER_PI_AI_DATA`
 * overrides both for a deployment whose layout differs.
 *
 * Returns `undefined` when the package is not installed — the caller then simply has one
 * source fewer, which is the documented degradation and not an error.
 * @param from - directory to start the upward walk from; defaults to this module's directory.
 * @param home - DSH home whose `profiles` are searched last; defaults to `$DSH_HOME`.
 * @returns Absolute `dist/providers/data` directory, or `undefined`.
 */
export function resolveCatalogDataDir(from: string = dirname(fileURLToPath(import.meta.url)), ...args: [string | undefined] | []): string | undefined {
  const home = args.length > 0 ? args[0] : process.env.DSH_HOME?.trim()
  const override = process.env.DSH_VERIFIER_PI_AI_DATA?.trim()
  if (override) return existsSync(override) ? override : undefined
  let dir = from
  for (let depth = 0; depth < 12; depth += 1) {
    const found = catalogUnder(dir)
    if (found !== undefined) return found
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (!home) return undefined
  const profiles = join(home, 'profiles')
  const direct = catalogUnder(profiles)
  if (direct !== undefined) return direct
  try {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const found = catalogUnder(join(profiles, entry.name))
      if (found !== undefined) return found
    }
  } catch { /* no profiles directory: nothing left to find */ }
  return undefined
}

/** Reads every `*.json` provider document in a catalog directory into a table. */
export function loadCatalogTable(dataDir: string): PriceTable {
  const table: PriceTable = new Map()
  let files: string[]
  try {
    files = readdirSync(dataDir).filter(name => name.endsWith('.json'))
  } catch {
    return table
  }
  for (const file of files) {
    try {
      mergeProviderDocument(file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(dataDir, file), 'utf8')), table)
    } catch { /* one unreadable provider must not lose the other 39 */ }
  }
  return table
}

/** Default lifetime of a loaded price table, matching the capability memory's TTL. */
export const PRICE_TTL_MS = 24 * 60 * 60 * 1000

/** Public models.dev snapshot; the upstream of the pi-ai catalog the host ships. */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

export interface PriceResolverOptions {
  /** Rates the operator typed; they win over every automatic source. */
  manual: ManualPrices
  /** Consult the installed catalog (default true). */
  fromCatalog?: boolean
  /** Consult models.dev when the catalog misses (default false; opt-in network). */
  online?: boolean
  /** Provider id whose list price to follow for a route the tables do not know. */
  overrideProvider?: string
}

export interface PriceResolverDeps {
  /** Injected HTTP client; tests must never reach the network. */
  fetch?: typeof fetch
  now?: () => number
  catalogDir?: () => string | undefined
  url?: string
  ttlMs?: number
  timeoutMs?: number
}

/**
 * Resolves a route's rates once per TTL, caching both tables in-process.
 *
 * The two tables are independent: a broken catalog read still leaves the online lookup, and
 * a network failure still leaves the catalog. Both are single-flighted so concurrent topics
 * cannot each fetch the 4.6 MB models.dev snapshot.
 */
export class PriceResolver {
  private catalog: { at: number; table: PriceTable } | undefined
  private online: { at: number; table: PriceTable } | undefined
  private onlineFlight: Promise<PriceTable> | undefined

  constructor(private readonly deps: PriceResolverDeps = {}) {}

  /** The installed catalog table, loaded at most once per TTL. */
  catalogTable(): PriceTable {
    const now = (this.deps.now ?? Date.now)()
    const ttl = this.deps.ttlMs ?? PRICE_TTL_MS
    if (this.catalog !== undefined && now - this.catalog.at <= ttl) return this.catalog.table
    const dir = (this.deps.catalogDir ?? (() => resolveCatalogDataDir()))()
    const table = dir === undefined ? new Map() : loadCatalogTable(dir)
    this.catalog = { at: now, table }
    return table
  }

  /** The models.dev table, fetched at most once per TTL. Never rejects. */
  async onlineTable(): Promise<PriceTable> {
    const now = (this.deps.now ?? Date.now)()
    const ttl = this.deps.ttlMs ?? PRICE_TTL_MS
    if (this.online !== undefined && now - this.online.at <= ttl) return this.online.table
    this.onlineFlight ??= (async () => {
      const table: PriceTable = new Map()
      try {
        const fetchImpl = this.deps.fetch ?? fetch
        const response = await fetchImpl(this.deps.url ?? MODELS_DEV_URL, { signal: AbortSignal.timeout(this.deps.timeoutMs ?? 20_000) })
        if (response.ok) parseModelsDevDocument(JSON.parse(await response.text()), table)
      } catch { /* offline, blocked, or a changed shape: no price beats a fabricated one */ }
      this.online = { at: (this.deps.now ?? Date.now)(), table }
      this.onlineFlight = undefined
      return table
    })()
    return this.onlineFlight
  }

  private fromTable(table: PriceTable, providers: readonly string[], model: string): PriceTableEntry | undefined {
    for (const provider of providers) {
      const entry = table.get(priceKey(provider, model))
      if (entry !== undefined) return entry
    }
    return undefined
  }

  /**
   * Rates in effect for one route.
   * @param provider - route's provider id.
   * @param model - route's model id.
   * @param options - manual rates plus which automatic sources may run.
   * @returns The rates, always, with the source that answered.
   */
  async resolve(provider: string, model: string, options: PriceResolverOptions): Promise<TokenPrices> {
    const manual = options.manual
    if (manual.input > 0 || manual.output > 0) {
      // A typed rate is a fact about the deployment. Cache reads keep the operator's own
      // cached rate when they gave one; otherwise they fall back to the input rate, which is
      // exactly the pre-existing estimate rather than silently inventing a discount.
      return { input: manual.input, output: manual.output, cachedInput: manual.cachedInput > 0 ? manual.cachedInput : manual.input, source: 'manual' }
    }
    const override = options.overrideProvider?.trim()
    const candidates = override && override !== provider ? [override, provider] : [provider]
    if (options.fromCatalog !== false) {
      const entry = this.fromTable(this.catalogTable(), candidates, model)
      if (entry !== undefined) return { ...entry, source: 'catalog' }
    }
    if (options.online === true) {
      const entry = this.fromTable(await this.onlineTable(), candidates, model)
      if (entry !== undefined) return { ...entry, source: 'online' }
    }
    return UNPRICED
  }
}
