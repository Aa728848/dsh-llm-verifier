/** Where the rates in effect came from; reported by the judge probe. */
export type PriceSource = 'manual' | 'catalog' | 'online' | 'none';
/** USD per million tokens for one route. */
export interface TokenPrices {
    input: number;
    output: number;
    /** Price of a prompt token served from cache, which is typically 10–50x cheaper than `input`. */
    cachedInput: number;
    source: PriceSource;
}
/** Operator-configured rates, before any automatic lookup. */
export interface ManualPrices {
    input: number;
    output: number;
    cachedInput: number;
}
/** The token counts a cost estimate needs; a structural subset of `RunStats`. */
export interface PricedUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}
/** Rates for a route nothing could price. */
export declare const UNPRICED: TokenPrices;
/** One route's rates inside a price table. */
export interface PriceTableEntry {
    input: number;
    output: number;
    cachedInput: number;
}
/** `provider\0model` → rates. */
export type PriceTable = Map<string, PriceTableEntry>;
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
export declare function costUsd(usage: PricedUsage, prices: Omit<TokenPrices, 'source'>): number;
/** Identity of one route inside a {@link PriceTable}. */
export declare function priceKey(provider: string, model: string): string;
/** Reads one `{input, output, cacheRead|cache_read}` record; `undefined` when nothing usable is there. */
export declare function priceEntry(value: unknown): PriceTableEntry | undefined;
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
export declare function mergeProviderDocument(provider: string, document: unknown, into: PriceTable): number;
/** Parses one models.dev snapshot (`{ provider: { models } }`) into a table. */
export declare function parseModelsDevDocument(document: unknown, into: PriceTable): number;
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
export declare function resolveCatalogDataDir(from?: string, ...args: [string | undefined] | []): string | undefined;
/** Reads every `*.json` provider document in a catalog directory into a table. */
export declare function loadCatalogTable(dataDir: string): PriceTable;
/** Default lifetime of a loaded price table, matching the capability memory's TTL. */
export declare const PRICE_TTL_MS: number;
/** Public models.dev snapshot; the upstream of the pi-ai catalog the host ships. */
export declare const MODELS_DEV_URL = "https://models.dev/api.json";
export interface PriceResolverOptions {
    /** Rates the operator typed; they win over every automatic source. */
    manual: ManualPrices;
    /** Consult the installed catalog (default true). */
    fromCatalog?: boolean;
    /** Consult models.dev when the catalog misses (default false; opt-in network). */
    online?: boolean;
    /** Provider id whose list price to follow for a route the tables do not know. */
    overrideProvider?: string;
}
export interface PriceResolverDeps {
    /** Injected HTTP client; tests must never reach the network. */
    fetch?: typeof fetch;
    now?: () => number;
    catalogDir?: () => string | undefined;
    url?: string;
    ttlMs?: number;
    timeoutMs?: number;
}
/**
 * Resolves a route's rates once per TTL, caching both tables in-process.
 *
 * The two tables are independent: a broken catalog read still leaves the online lookup, and
 * a network failure still leaves the catalog. Both are single-flighted so concurrent topics
 * cannot each fetch the 4.6 MB models.dev snapshot.
 */
export declare class PriceResolver {
    private readonly deps;
    private catalog;
    private online;
    private onlineFlight;
    constructor(deps?: PriceResolverDeps);
    /** The installed catalog table, loaded at most once per TTL. */
    catalogTable(): PriceTable;
    /** The models.dev table, fetched at most once per TTL. Never rejects. */
    onlineTable(): Promise<PriceTable>;
    private fromTable;
    /**
     * Rates in effect for one route.
     * @param provider - route's provider id.
     * @param model - route's model id.
     * @param options - manual rates plus which automatic sources may run.
     * @returns The rates, always, with the source that answered.
     */
    resolve(provider: string, model: string, options: PriceResolverOptions): Promise<TokenPrices>;
}
//# sourceMappingURL=pricing.d.ts.map