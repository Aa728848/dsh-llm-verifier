import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { CompletionLogprobs, TokenAlternative } from '../scoring/core.ts'
import type { UsageStats, VerifierImage } from './caller.ts'

/**
 * The logprob-expectation scoring channel. The third upstream channel is deliberately not
 * implemented; see D1 for what it is and what it would take.
 */
export interface TopLogprobRoute {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  deepSeekThinking: boolean
}
export interface TopLogprobCompletion extends CompletionLogprobs { usage: UsageStats; scoringMode: 'top-logprobs' }
export class TopLogprobsUnsupportedError extends Error { constructor(message: string) { super(message); this.name = 'TopLogprobsUnsupportedError' } }
/**
 * A provider-level rejection of the direct transport that is not a logprobs
 * capability answer (bad request, auth, quota, malformed body). It downgrades
 * this topic to the DSH stream instead of failing the whole verification.
 */
export class TopLogprobsRouteError extends TopLogprobsUnsupportedError { constructor(message: string, readonly status?: number) { super(message); this.name = 'TopLogprobsRouteError' } }
/**
 * A deterministic, non-transient failure of the direct transport: the provider DID answer, but the
 * answer cannot be scored and no second attempt can change that. Upstream v0.3.0 splits exactly this
 * condition out of the capability path for the same reason.
 *
 * Deliberately NOT a {@link TopLogprobsUnsupportedError}: `callAutomatic` catches that type to
 * `markUnsupported(provider, model)`, so a route whose reasoning merely ate the output budget would be
 * remembered for 24h as a model that cannot do logprobs at all — a capability-cache lie that outlives
 * the misconfiguration that caused it. It is also excluded from the shared retry heuristic, because
 * the message quotes the budget figure and that figure can read as a transient HTTP 5xx code while the
 * failure itself is perfectly reproducible.
 */
export class TopLogprobsBudgetError extends Error { constructor(message: string) { super(message); this.name = 'TopLogprobsBudgetError' } }

/**
 * Classify a 200 response that carries no token logprob row.
 *
 * Different causes hide behind "no rows", and reporting them as one is how a configuration mistake
 * turns into a 24h capability-cache entry:
 *
 * 1. `finish_reason: 'length'` — reasoning consumed the whole output budget before the answer
 *    started. Raising `maxTokens` or lowering the reasoning effort fixes it, so this surfaces as
 *    {@link TopLogprobsBudgetError} and never reaches the capability memory.
 * 2. Every other finish reason — the route keeps its capability-probe meaning
 *    ({@link TopLogprobsUnsupportedError}): a provider that answers while ignoring `logprobs` is
 *    exactly the answer the probe exists to collect.
 *
 * The finish reason is recorded either way, so "this model produced no answer" stays readable apart
 * from "this model cannot report logprobs".
 * @param finishReason - `choices[0].finish_reason` as a trimmed string, when the provider sent one.
 * @param maxTokens - the output budget actually requested, quoted back in the budget message.
 * @returns The error to throw for a response that carries no logprob rows.
 */
function noLogprobsError(finishReason: string | undefined, maxTokens: number): Error {
  if (finishReason === 'length') return new TopLogprobsBudgetError(`llm-verifier: top_logprobs returned no answer logprobs (finish_reason='length', reasoning consumed the ${maxTokens}-token budget); raise the judge maxTokens or lower the reasoning effort`)
  return new TopLogprobsUnsupportedError('provider returned no token logprobs (finish_reason=' + (finishReason ?? 'unknown') + ', no answer emitted)')
}

function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function endpoint(baseURL: string): string { return baseURL.replace(/\/+$/, '') + '/chat/completions' }
function dataUrl(image: VerifierImage): string { return 'data:' + image.mediaType + ';base64,' + Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).toString('base64') }

async function credential(ctx: Context, name: string | undefined): Promise<string | undefined> {
  if (!name) return undefined
  const provider = ctx.get('credentials')
  return (await provider?.resolve(credentialRef(name)))?.value
}

/**
 * Read one host settings namespace as a plain object.
 *
 * DSH 0.1.1-0.1.6 answered this with `settings.get(ns)` on the register-based seam.
 * DSH 0.1.7 replaced that seam with `SettingsForms`, which has no `get` method at
 * all: the only public read is `describe()`, whose descriptors carry each
 * namespace's projected live value. Probing both keeps the direct logprob route
 * working across the whole supported line, and a seam that throws degrades to the
 * explicit-tag channel instead of failing the verification outright.
 * @param ctx - Plugin context carrying the optional settings service.
 * @param ns - Host namespace id, e.g. `llm-deepseek`.
 * @returns The namespace value, or `undefined` when it cannot be read.
 */
function settingsNamespace(ctx: Context, ns: string): Record<string, unknown> | undefined {
  const settings = ctx.get('settings') as unknown as { get?: unknown; describe?: unknown } | undefined
  if (!settings) return undefined
  try {
    if (typeof settings.get === 'function') return object((settings.get as (ns: string) => unknown)(ns))
    if (typeof settings.describe !== 'function') return undefined
    const rows: unknown = (settings.describe as () => unknown)()
    if (!Array.isArray(rows)) return undefined
    const row = rows.map(object).find(candidate => candidate?.ns === ns)
    return object(row?.value)
  } catch {
    return undefined
  }
}

export async function resolveTopLogprobRoute(ctx: Context, provider: string): Promise<TopLogprobRoute | undefined> {
  if (provider === 'deepseek-official') {
    const value = settingsNamespace(ctx, 'llm-deepseek') ?? {}
    const apiKeyEnv = text(value.apiKeyEnv) ?? 'DEEPSEEK_API_KEY'
    const apiKey = await credential(ctx, apiKeyEnv)
    if (!apiKey) return undefined
    return { baseURL: text(value.baseURL) ?? 'https://api.deepseek.com', apiKey, deepSeekThinking: true }
  }
  const root = settingsNamespace(ctx, 'llm-pi-ai')
  if (root === undefined) return undefined
  const profiles = object(root?.providers)
  const profile = object(profiles?.[provider])
  // Only explicitly OpenAI-compatible profiles are safe to serialize directly.
  // Other DSH adapters keep their private protocol and use the explicit-tag fallback.
  if (!profile || profile.api !== 'openai-completions') return undefined
  const baseURL = text(profile.baseURL)
  if (!baseURL || !/^https:\/\//i.test(baseURL)) return undefined
  const apiKey = await credential(ctx, text(profile.apiKeyEnv))
  const rawHeaders = object(profile.headers)
  const headers = rawHeaders === undefined ? undefined : Object.fromEntries(Object.entries(rawHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return { baseURL, ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), deepSeekThinking: false }
}

export async function callTopLogprobs(route: TopLogprobRoute, model: string, prompt: string, maxTokens: number, reasoningEffort: string | undefined, signal?: AbortSignal, images?: readonly VerifierImage[], attempt = 1, temperature = 0.2): Promise<TopLogprobCompletion> {
  const content: string | Record<string, unknown>[] = images?.length ? [{ type: 'text', text: prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: dataUrl(image) } }))] : prompt
  const thinking = route.deepSeekThinking && reasoningEffort ? reasoningEffort === 'off' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort } : {}
  const response = await fetch(endpoint(route.baseURL), {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json', ...(route.apiKey ? { authorization: 'Bearer ' + route.apiKey } : {}), ...route.headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: maxTokens, temperature, logprobs: true, top_logprobs: 20, ...thinking }),
  })
  const raw = await response.text()
  if (!response.ok) {
    const excerpt = raw.slice(0, 1000)
    const message = 'llm-verifier: top_logprobs request failed with HTTP ' + response.status + ': ' + excerpt
    if ([400, 404, 405, 415, 422].includes(response.status) && /logprob|top_logprobs|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|not support/i.test(excerpt)) throw new TopLogprobsUnsupportedError('provider rejected top_logprobs: HTTP ' + response.status + ' ' + excerpt)
    // Throttling and server faults stay generic so the shared retry wrapper can
    // attempt again; every other rejection downgrades to the DSH stream.
    if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) throw new Error(message)
    throw new TopLogprobsRouteError(message, response.status)
  }
  let body: Record<string, unknown>
  try { body = object(JSON.parse(raw)) ?? {} } catch { throw new TopLogprobsRouteError('llm-verifier: top_logprobs endpoint returned invalid JSON', response.status) }
  const choices = Array.isArray(body.choices) ? body.choices : []
  const choice = object(choices[0])
  const message = object(choice?.message)
  const answer = typeof message?.content === 'string' ? message.content : ''
  const logprobs = object(choice?.logprobs)
  const rows = Array.isArray(logprobs?.content) ? logprobs.content : []
  if (!rows.length) throw noLogprobsError(text(choice?.finish_reason), maxTokens)
  const tokens: string[] = []
  const positions: TokenAlternative[][] = []
  for (const rawRow of rows) {
    const row = object(rawRow) ?? {}
    const token = typeof row.token === 'string' ? row.token : ''
    tokens.push(token)
    const top = Array.isArray(row.top_logprobs) ? row.top_logprobs : []
    const alternatives = top.flatMap(value => { const item = object(value); return item && typeof item.token === 'string' && typeof item.logprob === 'number' ? [{ token: item.token, logprob: item.logprob }] : [] })
    if (!alternatives.length && typeof row.logprob === 'number') alternatives.push({ token, logprob: row.logprob })
    positions.push(alternatives)
  }
  const rawUsage = object(body.usage) ?? {}
  const promptDetails = object(rawUsage.prompt_tokens_details) ?? {}
  const completionDetails = object(rawUsage.completion_tokens_details) ?? {}
  const cached = Number(rawUsage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? 0) || 0
  const input = Number(rawUsage.prompt_tokens ?? 0) || 0
  return { text: answer, tokens, positions, scoringMode: 'top-logprobs', usage: { calls: 1, attempts: attempt, retries: attempt - 1, inputTokens: Math.max(0, input - cached), cachedInputTokens: cached, outputTokens: Number(rawUsage.completion_tokens ?? 0) || 0, reasoningTokens: Number(completionDetails.reasoning_tokens ?? 0) || 0 } }
}

/** Marks older than this are dropped on hydration so a provider that later gains logprobs support is re-probed. */
export const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000

interface CapabilityDocument { version: 1; entries: Record<string, number> }

/** Resolves the capability memory file beside the score cache inside the topic verifier directory. */
export function resolveCapabilityFile(cacheDir: string, cwd = process.cwd()): string {
  const root = isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir)
  return join(root, 'capabilities-v1.json')
}

/** Replace failures that are a transient lock rather than a verdict about the capability file directory. */
const TRANSIENT_REPLACE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

let replaceOrdinal = 0

async function replaceFile(temporary: string, target: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 5 || code === undefined || !TRANSIENT_REPLACE_CODES.has(code)) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 10))
    }
  }
}

export class TopLogprobCapabilityCache {
  private readonly unsupported = new Map<string, number>()
  private loaded = false
  private hydrating: Promise<void> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file?: string, private readonly now: () => number = Date.now) {}

  /** Expired marks are dropped so a provider that later gains logprobs support is re-probed. */
  isUnsupported(provider: string, model: string): boolean {
    const key = provider + '\0' + model
    const markedAt = this.unsupported.get(key)
    if (markedAt === undefined) return false
    if (this.now() - markedAt > CAPABILITY_TTL_MS) { this.unsupported.delete(key); return false }
    return true
  }

  /** Hydrates persisted marks once; in-process marks always win over file contents. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded || this.file === undefined) return
    this.hydrating ??= (async () => {
      try {
        const document = JSON.parse(await readFile(this.file!, 'utf8')) as CapabilityDocument
        const entries = document !== null && typeof document === 'object' && document.version === 1 && typeof document.entries === 'object' && document.entries !== null ? document.entries : {}
        const now = this.now()
        for (const [key, markedAt] of Object.entries(entries)) {
          if (typeof markedAt !== 'number' || !Number.isFinite(markedAt) || markedAt < 0 || now - markedAt > CAPABILITY_TTL_MS) continue
          // Max-merge: never let an older persisted stamp clobber a fresher in-process probe.
          const existing = this.unsupported.get(key)
          if (existing === undefined || existing < markedAt) this.unsupported.set(key, markedAt)
        }
      } catch { /* a missing or unreadable file simply starts empty */ }
      this.loaded = true
    })()
    await this.hydrating
  }

  markUnsupported(provider: string, model: string): void {
    this.unsupported.set(provider + '\0' + model, this.now())
    this.persist()
  }

  /**
   * Forget one provider/model mark so the next call re-probes instead of replaying a cached answer.
   *
   * The judge probe exists to answer "which scoring channel is this judge on". Replaying a mark
   * written up to {@link CAPABILITY_TTL_MS} ago — possibly under a different provider
   * configuration — would answer a different, stale question. The removal is persisted, so a host
   * restart cannot resurrect the old mark.
   *
   * The delete is repeated INSIDE the serialized write: hydration max-merges the file into memory,
   * so deleting only beforehand would let the very write we schedule put the entry back.
   * @param provider - provider id the mark belongs to.
   * @param model - model id the mark belongs to.
   */
  forget(provider: string, model: string): void {
    const key = provider + '\0' + model
    this.unsupported.delete(key)
    if (this.file === undefined) return
    const next = this.writing
      .catch(() => {})
      .then(() => this.ensureLoaded())
      .then(() => { this.unsupported.delete(key); return this.writeDocument() })
    this.writing = next
    next.catch(() => { /* capability memory is best-effort */ })
  }

  /** Serialize behind hydration so an early mark never clobbers not-yet-loaded entries. */
  private persist(): void {
    if (this.file === undefined) return
    const next = this.writing
      .catch(() => {})
      .then(() => this.ensureLoaded())
      .then(() => this.writeDocument())
    this.writing = next
    next.catch(() => { /* capability memory is best-effort; the next mark rewrites the file */ })
  }

  private async writeDocument(): Promise<void> {
    const snapshot: CapabilityDocument = { version: 1, entries: Object.fromEntries(this.unsupported) }
    await mkdir(dirname(this.file!), { recursive: true })
    const temporary = this.file! + '.tmp-' + process.pid + '-' + (++replaceOrdinal)
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
    try { await replaceFile(temporary, this.file!) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }

  /** Resolves once the trailing persistence attempt settles; exposed for tests. */
  flush(): Promise<void> { return this.writing }
}
