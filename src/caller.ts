import { BlockAssembler, ReasoningEffortId, createUserMessage, deepFreeze, type ContentBlock, type FinishReason, type LlmRuntime } from '@deepseek-ai/dsh-llm'
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

async function callExplicitTag(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion> {
  let attempt = 0
  while (true) {
    attempt += 1
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('llm-verifier: request timed out')), config.timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const content: ContentBlock[] = [{ type: 'text', text: prompt }]
      for (const image of images ?? []) {
        const ref = await config.attachments.saveImage({ data: image.data, mediaType: image.mediaType })
        content.push({ type: 'image', attachment: ref })
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
        signal: controller.signal,
      })
      for await (const chunk of config.llm.stream(options)) assembler.push(chunk)
      const failed = failureMessage(assembler.finish)
      if (failed !== undefined) throw new Error('llm-verifier: model call failed: ' + failed)
      const text = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
      if (!text.trim()) throw new Error('llm-verifier: selected DSH model produced no text')
      // DSH adapters expose provider-neutral text/usage but not top-logprob candidates.
      // extractScore() therefore uses the model's explicit final A–T tags.
      return { text, tokens: [], positions: [], scoringMode: 'explicit-tag', usage: usage(attempt, assembler.usage) }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (attempt > config.maxRetries || !(error instanceof Error) || !/rate|quota|timeout|timed out|temporar|network|fetch|socket|5\d\d/i.test(error.message)) throw error
      await delay(Math.min(30000, config.retryBaseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)), signal)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

export class RequestLimiter {
  private active = 0
  private readonly queue: Array<() => void> = []
  constructor(readonly limit: number) { if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('llm-verifier: request concurrency limit must be a positive integer') }
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const enter = () => { signal?.removeEventListener('abort', abort); resolve() }
      const abort = () => { const index = this.queue.indexOf(enter); if (index >= 0) this.queue.splice(index, 1); reject(signal?.reason) }
      this.queue.push(enter); signal?.addEventListener('abort', abort, { once: true })
    })
    if (signal?.aborted) throw signal.reason
    this.active += 1
    try { return await operation() } finally { this.active -= 1; this.queue.shift()?.() }
  }
}

/** Best-effort pre-call channel prediction for cache identity only; callAutomatic() stays the runtime source of truth. */
export function predictScoringChannel(config: VerifierClientConfig): ScoringMode {
  return config.topLogprobCapabilities.isUnsupported(config.provider, config.model) ? 'explicit-tag' : 'top-logprobs'
}

async function callAutomatic(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion> {
  if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
    const route = await resolveTopLogprobRoute(config.ctx, config.provider)
    if (route !== undefined) {
      try { return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images) }
      catch (error) {
        if (!(error instanceof TopLogprobsUnsupportedError)) throw error
        config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
      }
    } else config.topLogprobCapabilities.markUnsupported(config.provider, config.model)
  }
  return callExplicitTag(config, prompt, signal, images)
}

export async function callVerifier(config: VerifierClientConfig, prompt: string, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<VerifierCompletion> {
  const invoke = () => callAutomatic(config, prompt, signal, images)
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}

/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
export async function callVerifierText(config: VerifierClientConfig, prompt: string, signal?: AbortSignal): Promise<VerifierCompletion> {
  const invoke = () => callExplicitTag(config, prompt, signal)
  return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal)
}
export function addUsage(target: UsageStats, source: UsageStats): void { for (const key of ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'] as const) target[key] += source[key] }
export function emptyUsage(): UsageStats { return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } }
