import { BlockAssembler, ReasoningEffortId, createUserMessage, type ContentBlock, type FinishReason, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import * as LlmModule from '@deepseek-ai/dsh-llm'

/**
 * Deep-freeze a call-options graph, leaving any live AbortSignal mutable.
 *
 * The host re-exports its own `deepFreeze` from `@deepseek-ai/dsh-llm` on the 0.1.1 line; the
 * 0.1.5 line moved the helper to `@deepseek-ai/dsh-util-values` and no longer re-exports it, so
 * the fallback below is what actually runs there. Both implementations must carry the same rule
 * ("leaving live AbortSignal objects mutable" — the host's own wording), because freezing a
 * signal breaks the transport twice over: Node >= 26.5 initializes the signal's internal event
 * map lazily, so the first `addEventListener` throws "Cannot assign to read only property
 * 'Symbol(kEvents)'", and on every Node version the attempt timeout's `controller.abort()` throws
 * the same way on 'Symbol(kAborted)'. The signal belongs to this call's retry loop and is still
 * unsubscribed when the options are frozen, which is what makes the ordering fatal.
 */
function deepFreeze<T>(value: T): T {
  const mod = LlmModule as unknown as Record<string, unknown>
  if (typeof mod.deepFreeze === 'function') {
    return (mod.deepFreeze as Function)(value)
  }
  return fallbackDeepFreeze(value)
}

/**
 * The graph walk used when the host exports no `deepFreeze`; exported for tests.
 * @param value - value to freeze.
 * @returns The same value, with every reachable enumerable child frozen except live AbortSignals.
 */
export function fallbackDeepFreeze<T>(value: T): T {
  // See deepFreeze(): a frozen signal fails on the transport's first subscription.
  if (value instanceof AbortSignal) return value
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      fallbackDeepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CompletionLogprobs } from './core.ts'
import { TopLogprobCapabilityCache, TopLogprobsUnsupportedError, callTopLogprobs, resolveTopLogprobRoute } from './top-logprobs.ts'
import type { Context } from '@deepseek-ai/cordis'

export interface VerifierClientConfig {
  ctx: Context
  llm: LlmRuntime
  attachments: AttachmentStore
  topLogprobCapabilities: TopLogprobCapabilityCache
  provider: string
  model: string
  /** User-facing judge name for tool output; cosmetic only, never part of the scoring cache identity. */
  label?: string
  reasoningEffort?: string
  maxTokens: number
  temperature: number
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  limiter?: RequestLimiter
}

export interface VerifierImage {
  data: Uint8Array
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}

export interface UsageStats {
  calls: number
  attempts: number
  retries: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  /**
   * At least one attempt's usage is UNKNOWN (an earlier attempt failed and was retried, or a
   * response came back unusable). The token counts are a floor, never a confident total.
   */
  usageIncomplete?: boolean
}

export type ScoringMode = 'top-logprobs' | 'explicit-tag'
export interface VerifierCompletion extends CompletionLogprobs {
  usage: UsageStats
  scoringMode: ScoringMode
  /**
   * The direct logprob transport was attempted and the provider rejected it, so this
   * answer came from the explicit-tag fallback. Diagnostics only: it never changes the
   * score, and it is recorded so a silent downgrade is visible in the statistics.
   */
  channelFallback?: boolean
}

/**
 * Where a finally-failed request records how many attempts it already spent.
 *
 * A failure that never returned usage leaves the tokens UNKNOWN, not zero. The attempt
 * count is the one fact the transport does know, so it is carried on the error itself
 * (the engine catches per-judge errors) instead of being discarded.
 */
const REQUEST_ATTEMPTS = Symbol('llm-verifier.requestAttempts')

/** Attempts one failed verifier request already spent; 0 when the error carries none. */
export function requestAttempts(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 0
  const value = (error as { [REQUEST_ATTEMPTS]?: unknown })[REQUEST_ATTEMPTS]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
 * Usage the transport DID return for a response that then turned out unusable.
 *
 * A parse failure or a truncated judge answer happened after the request was billed, so the
 * engine must not fold it into a zero-cost failure. The usage rides on the error next to the
 * attempt count; one error can carry both (a retried call whose final answer also failed).
 */
const PARTIAL_USAGE = Symbol('llm-verifier.partialUsage')

/** Usage a completed-but-unusable response already cost; undefined when the error carries none. */
export function partialUsage<T = UsageStats>(error: unknown): T | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as { [PARTIAL_USAGE]?: unknown })[PARTIAL_USAGE]
  return typeof value === 'object' && value !== null ? value as T : undefined
}

/** Attach the usage a completed-but-unusable response already cost to its error. */
export function attachUsage(error: unknown, usage: UsageStats): void {
  if (typeof error === 'object' && error !== null) (error as { [PARTIAL_USAGE]?: UsageStats })[PARTIAL_USAGE] = usage
}

/**
 * An error for a response that came back and was billed but produced no usable verdict.
 *
 * The usage is attached so the failure row reports known requests and tokens instead of zero.
 */
function unusable(reason: string, attempt: number, raw: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } | undefined): Error {
  const error = new Error('llm-verifier: ' + reason)
  attachUsage(error, usage(attempt, raw ?? {}))
  return error
}

/**
 * Describe why a finished stream is unusable.
 *
 * `FinishReason.failure` is the host's SERIALIZABLE facts record (`{message, code, status?,
 * providerRetryAfterMs?, requestId?}`), not the error the adapter threw: `normalizeLlmFailure`
 * detaches the facts at the adapter boundary, so the stack and the cause are already gone before
 * this plugin sees them. The machine code and the provider status ARE carried, and dropping them
 * left the board with one line and no way to tell an auth failure from a transport one.
 */
function failureMessage(finish: FinishReason): string | undefined {
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const failure = finish.failure
    const facts = [
      failure.code,
      failure.status === undefined ? undefined : 'HTTP ' + failure.status,
      failure.requestId === undefined ? undefined : 'request ' + failure.requestId,
    ].filter((fact): fact is string => typeof fact === 'string' && fact.length > 0)
    return facts.length > 0 ? failure.message + ' [' + facts.join(', ') + ']' : failure.message
  }
  if (finish.kind === 'max-tokens') return 'verifier response reached max tokens before completing its answer'
  return undefined
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function usage(attempts: number, value = {} as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }): UsageStats {
  return { calls: 1, attempts, retries: attempts - 1, inputTokens: value.inputTokens ?? 0, cachedInputTokens: (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0), outputTokens: value.outputTokens ?? 0, reasoningTokens: value.reasoningTokens ?? 0 }
}

/** Transient failures worth another attempt; anything else fails fast. */
const RETRYABLE_MESSAGE = /rate|quota|timeout|timed out|temporar|network|fetch|socket|5\d\d/i

/**
 * Run one logical verifier request under the configured timeout, retrying
 * transient failures with exponential backoff.
 *
 * Every channel goes through this wrapper — including the direct top_logprobs
 * transport, which used to bypass both the timeout and the retry budget.
 * @param config - resolved verifier client configuration.
 * @param signal - caller's abort signal (tool call or turn boundary).
 * @param run - one attempt; receives its own deadline signal and 1-based attempt number.
 * @returns The first successful completion.
 */
function attachAttempts(error: unknown, attempt: number): void {
  if (typeof error === 'object' && error !== null) (error as { [REQUEST_ATTEMPTS]?: number })[REQUEST_ATTEMPTS] = attempt
}

/**
 * A fresh error for one aborted call.
 *
 * Never annotate and rethrow the shared `signal.reason`: several concurrent requests share it,
 * and the engine attaches its accumulator to the thrown error, so one object carries several
 * accumulators and they get merged repeatedly. The wrapper preserves the message and name.
 */
function abortFailure(reason: unknown, attempt: number): Error {
  const source = reason instanceof Error ? reason : new Error(reason === undefined ? 'llm-verifier: request aborted' : String(reason))
  const error = new Error(source.message)
  error.name = source.name
  attachAttempts(error, attempt)
  return error
}

/** Token-only addition: call/attempt counters already describe the logical request. */
function addTokens(target: Pick<UsageStats, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'reasoningTokens'>, source: Pick<UsageStats, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'reasoningTokens'>): void {
  target.inputTokens += source.inputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.outputTokens += source.outputTokens
  target.reasoningTokens += source.reasoningTokens
}

async function retrying<T>(config: VerifierClientConfig, signal: AbortSignal | undefined, run: (signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
  let attempt = 0
  // Tokens an earlier attempt already paid for but never delivered a usable result. They are
  // real cost, so they follow the chain into whichever exit happens (success, final failure or
  // cancellation) instead of being discarded when no attempt ultimately succeeds.
  const carried = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  let unknownFailure = false
  // The usage the chain must be able to report: everything already spent plus this attempt's own
  // billed response. `unknown` (some attempt's tokens never came back) is what makes it a floor.
  const spent = (billed: UsageStats | undefined, unknown: boolean): UsageStats => ({
    calls: billed === undefined ? 0 : billed.calls,
    attempts: attempt,
    retries: Math.max(0, attempt - 1),
    inputTokens: carried.inputTokens + (billed?.inputTokens ?? 0),
    cachedInputTokens: carried.cachedInputTokens + (billed?.cachedInputTokens ?? 0),
    outputTokens: carried.outputTokens + (billed?.outputTokens ?? 0),
    reasoningTokens: carried.reasoningTokens + (billed?.reasoningTokens ?? 0),
    ...(unknown ? { usageIncomplete: true } : {}),
  })
  const cancel = (reason: unknown, billed: UsageStats | undefined, unknown: boolean): never => {
    const error = abortFailure(reason, attempt)
    attachUsage(error, spent(billed, unknown))
    throw error
  }
  while (true) {
    if (signal?.aborted) cancel(signal.reason, undefined, false)
    attempt += 1
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort(new Error('llm-verifier: request timed out')) }, config.timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const value = await run(controller.signal, attempt)
      if (typeof value === 'object' && value !== null) {
        const usage = (value as { usage?: UsageStats }).usage
        if (usage !== undefined) {
          addTokens(usage, carried)
          // Only a failed attempt whose tokens never came back makes the total a floor.
          if (unknownFailure) usage.usageIncomplete = true
        }
      }
      return value
    } catch (error) {
      const billed = partialUsage<UsageStats>(error)
      if (signal?.aborted) cancel(signal.reason ?? error, billed, unknownFailure || billed === undefined)
      // A deadline abort is retryable even when the adapter wraps the reason in
      // its own error type with an unrelated message.
      const retryable = timedOut || (error instanceof Error && RETRYABLE_MESSAGE.test(error.message))
      if (attempt > config.maxRetries || !retryable) {
        // Every attempt of the chain goes onto the thrown error: the last response alone would
        // report a fraction of the requests and tokens the invocation really spent.
        if (billed === undefined) unknownFailure = true
        const failure = typeof error === 'object' && error !== null ? error : new Error(String(error))
        attachAttempts(failure, attempt)
        attachUsage(failure, spent(billed, unknownFailure || billed === undefined))
        throw failure
      }
      if (billed === undefined) unknownFailure = true
      else addTokens(carried, billed)
      try {
        await delay(Math.min(30000, config.retryBaseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)), signal)
      } catch (waitError) {
        // Cancelled while waiting to retry: the attempts and the tokens already spent are real.
        cancel(signal?.reason ?? waitError, undefined, unknownFailure)
      }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** One attachment per image object per process: retries must not duplicate attachments. */
const imageRefs = new WeakMap<VerifierImage, Promise<unknown>>()

/**
 * One plain-text completion through the DSH stream.
 *
 * Shared by the explicit-tag judge path and by best-of-N generation, which differ in exactly one
 * place: a `max-tokens` finish. A truncated JUDGE answer is unusable — its verdict tags may never
 * have been emitted — so it stays a hard error. A truncated DRAFT is still a candidate the operator
 * already paid for, and the judge can see that the text stops mid-sentence and score it accordingly,
 * so generation receives the text plus a `truncated` flag.
 * @param config - resolved verifier client configuration.
 * @param prompt - the rendered prompt.
 * @param signal - the attempt's deadline signal.
 * @param images - attachments to send, if any.
 * @param attempt - 1-based attempt number for usage accounting.
 * @param tolerateTruncation - return the text of a max-tokens finish instead of throwing.
 * @returns The completion (with `truncated`) when it produced text.
 */
async function callTextCompletion(config: VerifierClientConfig, prompt: string, signal: AbortSignal | undefined, images: readonly VerifierImage[] | undefined, attempt: number, tolerateTruncation: boolean): Promise<VerifierCompletion & { truncated: boolean }> {
  const content: ContentBlock[] = [{ type: 'text', text: prompt }]
  for (const image of images ?? []) {
    let pending = imageRefs.get(image)
    if (pending === undefined) {
      const promise = Promise.resolve()
        .then(() => config.attachments.saveImage({ data: image.data, mediaType: image.mediaType }))
        .catch(error => {
          if (imageRefs.get(image) === pending) {
            imageRefs.delete(image)
          }
          throw error
        })
      pending = promise
      imageRefs.set(image, pending)
    }
    content.push({ type: 'image', attachment: await pending as never })
  }
  const messages = [createUserMessage({ content, source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } })]
  const assembler = new BlockAssembler()
  const options = deepFreeze({
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(config.reasoningEffort) } : {}),
    messages,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    signal,
  })
  for await (const chunk of config.llm.stream(options)) assembler.push(chunk)
  let truncated = false
  if (assembler.finish.kind === 'max-tokens') {
    if (!tolerateTruncation) throw unusable('model call failed: ' + failureMessage(assembler.finish), attempt, assembler.usage)
    truncated = true
  } else {
    const failed = failureMessage(assembler.finish)
    if (failed !== undefined) throw unusable('model call failed: ' + failed, attempt, assembler.usage)
  }
  const text = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
  if (!text.trim()) throw unusable('selected DSH model produced no text', attempt, assembler.usage)
  // DSH adapters expose provider-neutral text/usage but not top-logprob candidates.
  // extractScore() therefore uses the model's explicit final A–T tags.
  return { text, tokens: [], positions: [], scoringMode: 'explicit-tag', usage: usage(attempt, assembler.usage), truncated }
}

/** Explicit-tag judge completion: fail-closed, so a truncated answer is an error and never a score. */
async function callExplicitTag(config: VerifierClientConfig, prompt: string, signal: AbortSignal | undefined, images: readonly VerifierImage[] | undefined, attempt: number): Promise<VerifierCompletion> {
  return callTextCompletion(config, prompt, signal, images, attempt, false)
}

export class RequestLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []
  constructor(readonly limit: number) { if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('llm-verifier: request concurrency limit must be a positive integer') }
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw signal.reason
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const enter = () => { signal?.removeEventListener('abort', abort); resolve() }
      const abort = () => { const index = this.queue.indexOf(enter); if (index >= 0) this.queue.splice(index, 1); reject(signal?.reason) }
      this.queue.push(enter); signal?.addEventListener('abort', abort, { once: true })
    })
    if (signal?.aborted) {
      this.queue.shift()?.()
      throw signal.reason
    }
    this.active += 1
    try { return await operation() } finally { this.active -= 1; this.queue.shift()?.() }
  }
}

/** Best-effort pre-call channel prediction for cache identity only; callAutomatic() stays the runtime source of truth. */
export async function predictScoringChannel(config: VerifierClientConfig): Promise<ScoringMode> {
  await config.topLogprobCapabilities.ensureLoaded()
  return config.topLogprobCapabilities.isUnsupported(config.provider, config.model) ? 'explicit-tag' : 'top-logprobs'
}

async function callAutomatic(config: VerifierClientConfig, prompt: string, signal: AbortSignal | undefined, images: readonly VerifierImage[] | undefined, attempt: number): Promise<VerifierCompletion> {
  await config.topLogprobCapabilities.ensureLoaded()
  let fellBack = false
  if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
    const route = await resolveTopLogprobRoute(config.ctx, config.provider)
    if (route !== undefined) {
      try { return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images, attempt, config.temperature) }
      catch (error) {
        // Both a capability rejection and a non-retryable provider rejection of
        // the direct transport fall back to the DSH stream instead of failing
        // the whole verification.
        if (!(error instanceof TopLogprobsUnsupportedError)) throw error
        config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
        // A runtime downgrade AFTER a live attempt, unlike the capability probe that
        // finds no route at all: only this one is a fallback worth counting.
        fellBack = true
      }
    } else config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
  }
  const completion = await callExplicitTag(config, prompt, signal, images, attempt)
  return fellBack ? { ...completion, channelFallback: true } : completion
}

export async function callVerifier(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion> {
  const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callAutomatic(config, prompt, attemptSignal, images, attempt))
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}

/**
 * Best-of-N generation sampling constants.
 *
 * Deliberately NOT the judge's temperature: best-of-N only pays off when the drafts actually
 * differ, and the judge's low default (0.2) would produce N near-copies — the tool would then
 * spend N times the money choosing between the same answer.
 */
export const GENERATION_TEMPERATURE = 1
/**
 * Output ceiling for one draft.
 *
 * 4096 was a guess in the plan, and the first real end-to-end acceptance disproved it: a
 * "function + 12 test cases + a note" task truncated ALL THREE drafts, so the tool returned
 * nothing at all. The measured cause is reasoning tokens: on a trivial 2-draft run the session
 * model (deepseek-official/deepseek-flash) spent 16363 reasoning tokens out of 17254 output
 * tokens — roughly 8k of reasoning PER DRAFT, which eats any 4096 budget before the answer starts.
 *
 * 16384 is about 2x that measured per-draft spend, and it is also the largest ceiling that keeps
 * a pairwise judge prompt inside the plugin's own evidence limit: two drafts at 16384 tokens are
 * roughly 130k characters against a 240k explicit-evidence ceiling (EXPLICIT_MAX_TOTAL_CHARS).
 * `maxTokens` is a ceiling rather than a reservation, so a draft that needs less room costs
 * exactly what it did before. A task whose answer genuinely needs more is too large for this tool,
 * and its truncation is REPORTED instead of being silently returned.
 */
export const GENERATION_MAX_TOKENS = 16384

export interface GenerationTarget {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One draft: plain text, never scored, plus whether it ran into the output ceiling. */
export interface GeneratedCandidate extends VerifierCompletion { truncated: boolean }

/**
 * Re-point an existing verifier client at the model that should draft the candidates.
 *
 * Everything transport-shaped (context, llm runtime, attachments, capability memory, limiter,
 * timeout, retry budget) is inherited; only the route and the two generation-specific scalars
 * are replaced. `reasoningEffort` comes from the target and is never inherited from the base,
 * because the base is a judge: a leftover judge effort would silently draft with the wrong model
 * settings.
 * @param base - any configured verifier client (the primary judge is the cheapest source).
 * @param target - the model that writes the drafts.
 * @param maxTokens - output ceiling for this attempt.
 * @returns A client config safe to pass to {@link callGeneratedText}.
 */
export function generationClient(base: VerifierClientConfig, target: GenerationTarget, maxTokens = GENERATION_MAX_TOKENS): VerifierClientConfig {
  return {
    ctx: base.ctx,
    llm: base.llm,
    attachments: base.attachments,
    topLogprobCapabilities: base.topLogprobCapabilities,
    provider: target.provider,
    model: target.model,
    label: target.provider + '/' + target.model,
    ...(target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort }),
    maxTokens,
    temperature: GENERATION_TEMPERATURE,
    timeoutMs: base.timeoutMs,
    maxRetries: base.maxRetries,
    retryBaseDelayMs: base.retryBaseDelayMs,
    ...(base.limiter === undefined ? {} : { limiter: base.limiter }),
  }
}

/**
 * One best-of-N draft.
 *
 * A named seam over the plain-text path: generation has no A–T contract and no scoring channel, and
 * the name keeps it distinct from the judge calls at every call site and in the decision snapshot.
 *
 * Hitting the output ceiling is deliberately NOT an error here. The operator already paid for those
 * tokens, and the judge can see for itself that the text stops mid-sentence. That is exactly why the
 * judge's fail-closed max-tokens handling was split out of this path: before the split, one long
 * task made the whole tool return zero candidates.
 * @param base - any configured verifier client (the primary judge is the cheapest source).
 * @param target - the model that writes the draft (normally the session model).
 * @param prompt - the rendered drafting prompt.
 * @param signal - caller's abort signal.
 * @returns The draft text, token usage, and whether it ran into the ceiling.
 */
export async function generateCandidate(base: VerifierClientConfig, target: GenerationTarget, prompt: string, signal?: AbortSignal): Promise<GeneratedCandidate> {
  return callGeneratedText(generationClient(base, target), prompt, signal)
}

/** Generation transport: the judge's timeout/retry/limiter wrappers, with truncation as a result. */
async function callGeneratedText(config: VerifierClientConfig, prompt: string, signal: AbortSignal | undefined): Promise<GeneratedCandidate> {
  const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callTextCompletion(config, prompt, attemptSignal, undefined, attempt, true))
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}

/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
export async function callVerifierText(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion> {
  const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callExplicitTag(config, prompt, attemptSignal, undefined, attempt))
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}
export function addUsage(target: UsageStats, source: UsageStats): void { for (const key of ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'] as const) target[key] += source[key] ?? 0 }
export function emptyUsage(): UsageStats { return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } }
