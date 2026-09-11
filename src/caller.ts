import { BlockAssembler, ReasoningEffortId, createUserMessage, type ContentBlock, type FinishReason, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import * as LlmModule from '@deepseek-ai/dsh-llm'

function deepFreeze<T>(value: T): T {
  const mod = LlmModule as unknown as Record<string, unknown>
  if (typeof mod.deepFreeze === 'function') {
    return (mod.deepFreeze as Function)(value)
  }
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
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
}

export type ScoringMode = 'top-logprobs' | 'explicit-tag'
export interface VerifierCompletion extends CompletionLogprobs { usage: UsageStats; scoringMode: ScoringMode }

function failureMessage(finish: FinishReason): string | undefined {
  if (finish.kind === 'error' || finish.kind === 'aborted') return finish.failure.message
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
async function retrying<T>(config: VerifierClientConfig, signal: AbortSignal | undefined, run: (signal: AbortSignal, attempt: number) => Promise<T>): Promise<T> {
  let attempt = 0
  while (true) {
    attempt += 1
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort(new Error('llm-verifier: request timed out')) }, config.timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await run(controller.signal, attempt)
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      // A deadline abort is retryable even when the adapter wraps the reason in
      // its own error type with an unrelated message.
      const retryable = timedOut || (error instanceof Error && RETRYABLE_MESSAGE.test(error.message))
      if (attempt > config.maxRetries || !retryable) throw error
      await delay(Math.min(30000, config.retryBaseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)), signal)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** One attachment per image object per process: retries must not duplicate attachments. */
const imageRefs = new WeakMap<VerifierImage, Promise<unknown>>()

async function callExplicitTag(config: VerifierClientConfig, prompt: string, signal: AbortSignal | undefined, images: readonly VerifierImage[] | undefined, attempt: number): Promise<VerifierCompletion> {
  const content: ContentBlock[] = [{ type: 'text', text: prompt }]
  for (const image of images ?? []) {
    let pending = imageRefs.get(image)
    if (pending === undefined) { pending = config.attachments.saveImage({ data: image.data, mediaType: image.mediaType }); imageRefs.set(image, pending) }
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
    temperature: 1,
    signal,
  })
  for await (const chunk of config.llm.stream(options)) assembler.push(chunk)
  const failed = failureMessage(assembler.finish)
  if (failed !== undefined) throw new Error('llm-verifier: model call failed: ' + failed)
  const text = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
  if (!text.trim()) throw new Error('llm-verifier: selected DSH model produced no text')
  // DSH adapters expose provider-neutral text/usage but not top-logprob candidates.
  // extractScore() therefore uses the model's explicit final A–T tags.
  return { text, tokens: [], positions: [], scoringMode: 'explicit-tag', usage: usage(attempt, assembler.usage) }
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
  if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
    const route = await resolveTopLogprobRoute(config.ctx, config.provider)
    if (route !== undefined) {
      try { return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images, attempt) }
      catch (error) {
        // Both a capability rejection and a non-retryable provider rejection of
        // the direct transport fall back to the DSH stream instead of failing
        // the whole verification.
        if (!(error instanceof TopLogprobsUnsupportedError)) throw error
        config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
      }
    } else config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
  }
  return callExplicitTag(config, prompt, signal, images, attempt)
}

export async function callVerifier(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion> {
  const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callAutomatic(config, prompt, attemptSignal, images, attempt))
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}

/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
export async function callVerifierText(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion> {
  const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callExplicitTag(config, prompt, attemptSignal, undefined, attempt))
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}
export function addUsage(target: UsageStats, source: UsageStats): void { for (const key of ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'] as const) target[key] += source[key] }
export function emptyUsage(): UsageStats { return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } }
