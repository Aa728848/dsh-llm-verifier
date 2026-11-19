/**
 * DeepSeek IoT-Lite: stream ordinary reasoning and replace at most one high-waste segment per block.
 *
 * Untouched text is relayed byte-for-byte. A candidate is dispatched as soon as its segment closes,
 * while the main model may still be generating; auxiliary deltas are assembled privately and only a
 * complete, accepted segment enters the main stream. Later text waits in a bounded ordered queue.
 *
 * Fail-open is scoped to the candidate: before it is emitted, any refusal, timeout, abort, source
 * failure or terminal barrier relays its original text. Text already emitted cannot be retracted.
 * The main GenerateOptions object, including the user's reasoningEffort, is never mutated. See D15.
 */
import {
  BlockAssembler, ReasoningEffortId, createUserMessage, isAgentLoopRequest,
  type ContentBlock, type GenerateOptions, type LlmRuntime, type StreamChunk, type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction-basic'
import type {} from '../plugin/message-source.ts'
import {
  IOT_AUX_TIMEOUT_MS, findIoTTarget, resolveIoTRequestRoute, strategyFor,
  type IoTMode, type IoTRequestRoute, type IoTStrategy, type IoTThinkingTarget,
} from './mode.ts'
import { assessCompaction } from './compaction.ts'
import { IoTFlights } from './flight.ts'
import { IoTSessions, type SessionIoTMetrics } from './metrics.ts'
import { buildCompactionPrompt } from './prompt.ts'
import { IOT_MAX_PENDING_CHARS, IoTSegmenter, type IoTSegment } from './segments.ts'

/** Live settings the controller acts on; read fresh at every decision point. */
export interface IoTSettings {
  /** The level IS the switch; the review-tools enabled switch deliberately does not appear here. */
  iotThinking: IoTMode
  /** Global auxiliary model settings; unset fields use the enabled route's own provider and model, and low. */
  iotThinkingProvider?: string
  iotThinkingModel?: string
  iotThinkingEffort?: string
  /** Explicit opt-in main routes, each with an optional auxiliary override. */
  iotThinkingTargets?: readonly IoTThinkingTarget[]
}

/** Everything the controller needs from its host. */
export interface IoTDeps {
  llm: LlmRuntime
  settings: () => IoTSettings
  /** Diagnostics only: reasons and counts, never reasoning text or credentials. */
  logger?: { warn(message: string): void; info?(message: string): void }
}

interface EligibleRequest {
  sessionId: string
  strategy: IoTStrategy
  target?: IoTThinkingTarget
}

interface CompactionOutcome {
  text?: string
  reason?: string
}

interface PendingCompaction {
  start: number
  original: string
  promise: Promise<CompactionOutcome>
  cancel: AbortController
  settled: boolean
  outcome?: CompactionOutcome
}

interface ReasoningBuffer {
  segmenter: IoTSegmenter
  received: number
  emitted: string[]
  after: string[]
  afterChars: number
  candidate?: PendingCompaction
  candidateUsed: boolean
  hadAux: boolean
  replaced: boolean
  ended: boolean
  flushed: boolean
}

/** The controller the host wires onto llm/stream and session disposal. */
export class IoTController {
  private readonly sessions = new IoTSessions()
  private readonly flights = new IoTFlights()
  /** At most one auxiliary call per session, including concurrent requests and interleaved blocks. */
  private readonly auxiliarySessions = new Map<string, AbortController>()

  constructor(private readonly deps: IoTDeps) {}

  stream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const eligible = this.eligible(options)
    if (eligible === undefined) return next()
    return this.compacting(options, eligible, next)
  }

  clear(sessionId: string): void {
    this.sessions.clear(sessionId)
    this.flights.clear(sessionId)
    this.auxiliarySessions.get(sessionId)?.abort(new Error('llm-iot: session cleared'))
    this.auxiliarySessions.delete(sessionId)
  }

  thinking(sessionId: string): number | undefined { return this.flights.held(sessionId, Date.now()) }

  mode(_sessionId: string | undefined): IoTMode { return this.deps.settings().iotThinking }

  metrics(sessionId: string): SessionIoTMetrics | undefined { return this.sessions.metrics(sessionId) }

  /** Eligibility never rewrites the main request or its reasoning effort. */
  private eligible(options: GenerateOptions): EligibleRequest | undefined {
    if (typeof options !== 'object' || options === null) return undefined
    const settings = this.deps.settings()
    if (!isAgentLoopRequest(options)) return undefined
    if (options.sessionId === undefined) return undefined
    const sessionId = String(options.sessionId)
    if (sessionId === '') return undefined
    const strategy = strategyFor(settings.iotThinking)
    if (strategy === undefined) return undefined
    const target = findIoTTarget(settings.iotThinkingTargets ?? [], options.provider, options.model)
    return target === undefined ? undefined : { sessionId, strategy, target }
  }

  private async *compacting(
    options: GenerateOptions,
    eligible: EligibleRequest,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncGenerator<StreamChunk> {
    const controller = this
    const logger = this.deps.logger
    const metrics = this.sessions.metricsFor(eligible.sessionId, eligible.strategy.mode)
    const buffers = new Map<number, ReasoningBuffer>()
    const open: number[] = []
    const holding = new Set<number>()

    const hold = (index: number): void => {
      if (holding.has(index)) return
      holding.add(index)
      if (holding.size === 1) this.flights.begin(eligible.sessionId, Date.now())
    }
    const release = (index: number): void => {
      if (!holding.delete(index)) return
      if (holding.size === 0) this.flights.end(eligible.sessionId)
    }
    const close = (index: number): void => {
      buffers.delete(index)
      const at = open.indexOf(index)
      if (at >= 0) open.splice(at, 1)
      release(index)
    }
    const updateBuffered = (buffer: ReasoningBuffer): void => {
      const chars = buffer.segmenter.pendingText.length + buffer.afterChars + (buffer.candidate?.original.length ?? 0)
      metrics.streaming.maxBufferedChars = Math.max(metrics.streaming.maxBufferedChars, chars)
    }
    const emit = function* (buffer: ReasoningBuffer, index: number, text: string): Generator<StreamChunk> {
      if (text.length === 0) return
      buffer.emitted.push(text)
      metrics.streaming.emittedSegments += 1
      yield { type: 'reasoning-delta', index, text }
    }

    const start = (index: number, buffer: ReasoningBuffer, segment: IoTSegment): void => {
      const cancel = new AbortController()
      buffer.candidateUsed = true
      buffer.hadAux = true
      metrics.streaming.candidates += 1
      if (!buffer.ended) metrics.streaming.earlyCalls += 1
      hold(index)
      this.auxiliarySessions.set(eligible.sessionId, cancel)
      const pending: PendingCompaction = {
        start: segment.start,
        original: segment.text,
        cancel,
        settled: false,
        promise: this.compact(options, eligible.strategy, segment.text, options.signal, metrics, eligible.target, cancel),
      }
      buffer.candidate = pending
      void pending.promise.then(outcome => {
        pending.outcome = outcome
        pending.settled = true
      })
      void pending.promise.finally(() => {
        if (this.auxiliarySessions.get(eligible.sessionId) === cancel) this.auxiliarySessions.delete(eligible.sessionId)
      })
    }

    /** Commit a ready candidate, or await it at a block/barrier boundary. */
    const settle = async function* (index: number, allowReplacement: boolean): AsyncGenerator<StreamChunk> {
      const buffer = buffers.get(index)
      const pending = buffer?.candidate
      if (buffer === undefined || pending === undefined) return
      const outcome = pending.settled ? pending.outcome! : await pending.promise
      buffer.candidate = undefined
      release(index)
      try {
        if (allowReplacement && outcome.text !== undefined) {
          buffer.replaced = true
          metrics.streaming.preservedPrefixChars += pending.start
          logger?.info?.('llm-iot: replaced a reasoning segment at ' + pending.start + ' (' + pending.original.length + ' -> ' + outcome.text.length + ' chars)')
          yield* emit(buffer, index, outcome.text)
        } else {
          metrics.failures += 1
          logger?.warn('llm-iot: kept the original reasoning segment (' + (outcome.reason ?? 'refused') + ')')
          yield* emit(buffer, index, pending.original)
        }
        const after = buffer.after.splice(0)
        buffer.afterChars = 0
        for (const text of after) yield* emit(buffer, index, text)
      } finally {
        release(index)
      }
    }
    const processSegments = async function* (index: number, segments: readonly IoTSegment[]): AsyncGenerator<StreamChunk> {
      const buffer = buffers.get(index)
      if (buffer === undefined) return
      for (const segment of segments) {
        if (buffer.candidate?.settled) yield* settle(index, true)
        if (buffer.candidate !== undefined) {
          buffer.after.push(segment.text)
          buffer.afterChars += segment.text.length
          updateBuffered(buffer)
          if (buffer.afterChars + buffer.segmenter.pendingText.length > IOT_MAX_PENDING_CHARS) {
            buffer.candidate.cancel.abort(new Error('llm-iot: pending buffer limit'))
            yield* settle(index, false)
          }
          continue
        }
        if (segment.waste && !buffer.candidateUsed) {
          if (!controller.auxiliarySessions.has(eligible.sessionId)) start(index, buffer, segment)
          else buffer.candidateUsed = true
          updateBuffered(buffer)
          if (buffer.candidate !== undefined) continue
        }
        yield* emit(buffer, index, segment.text)
        updateBuffered(buffer)
      }
    }

    const flushBuffer = async function* (index: number): AsyncGenerator<StreamChunk> {
      const buffer = buffers.get(index)
      if (buffer === undefined) return
      if (buffer.candidate !== undefined) {
        buffer.candidate.cancel.abort(new Error('llm-iot: stream ended before block-end'))
        yield* settle(index, false)
      }
      const pending = buffer.segmenter.takePending()
      yield* emit(buffer, index, pending)
      buffer.flushed = true
      release(index)
    }
    const flushOpen = async function* (): AsyncGenerator<StreamChunk> {
      for (const index of [...open]) yield* flushBuffer(index)
    }

    try {
      for await (const chunk of next()) {
        // A completed auxiliary result may be committed before the reasoning block ends. Terminal
        // barriers deliberately skip this step so an unterminated block always keeps its candidate.
        if (chunk.type !== 'usage' && chunk.type !== 'finish') {
          for (const index of [...open]) {
            if (buffers.get(index)?.candidate?.settled) yield* settle(index, true)
          }
        }
        switch (chunk.type) {
          case 'block-start':
            if (chunk.blockType === 'reasoning' && !buffers.has(chunk.index)) {
              buffers.set(chunk.index, {
                segmenter: new IoTSegmenter(), received: 0, emitted: [], after: [], afterChars: 0,
                candidateUsed: false, hadAux: false, replaced: false, ended: false, flushed: false,
              })
              open.push(chunk.index)
            }
            yield chunk
            break
          case 'reasoning-delta': {
            const buffer = buffers.get(chunk.index)
            if (buffer === undefined || buffer.flushed) {
              yield chunk
              break
            }
            buffer.received += chunk.text.length
            const segments = buffer.segmenter.push(chunk.text)
            yield* processSegments(chunk.index, segments)
            updateBuffered(buffer)
            break
          }
          case 'block-end': {
            const buffer = buffers.get(chunk.index)
            if (buffer === undefined) {
              yield chunk
              break
            }
            buffer.ended = true
            yield* processSegments(chunk.index, buffer.segmenter.finish())
            yield* settle(chunk.index, true)
            const text = buffer.emitted.join('')
            const countMetrics = !buffer.flushed
            close(chunk.index)
            if (countMetrics) {
              if (buffer.received === 0) metrics.skips += 1
              else {
                if (!buffer.hadAux) metrics.skips += 1
                if (buffer.replaced) metrics.replacements += 1
                else metrics.kept += 1
                metrics.chars.original += buffer.received
                metrics.chars.emitted += text.length
              }
            }
            if (buffer.received === 0 || chunk.block.type !== 'reasoning') yield chunk
            else yield { ...chunk, block: { ...chunk.block, text } }
            break
          }
          case 'usage':
            yield* flushOpen()
            this.recordMainUsage(metrics, chunk.usage)
            yield chunk
            break
          case 'finish':
            yield* flushOpen()
            yield chunk
            break
          default:
            yield chunk
        }
      }
    } catch (error) {
      yield* flushOpen()
      throw error
    } finally {
      for (const buffer of buffers.values()) buffer.candidate?.cancel.abort(new Error('llm-iot: main stream closed'))
      for (const index of [...holding]) release(index)
    }
    yield* flushOpen()
  }

  /** One auxiliary call: streaming input, private assembly, no retry, tools, session identity or main-option mutation. */
  private async compact(
    options: GenerateOptions,
    strategy: IoTStrategy,
    original: string,
    signal: AbortSignal | undefined,
    metrics: SessionIoTMetrics,
    target: IoTThinkingTarget | undefined,
    controller: AbortController,
  ): Promise<CompactionOutcome> {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('llm-iot: auxiliary compaction timed out'))
    }, IOT_AUX_TIMEOUT_MS)
    const forward = (): void => controller.abort(signal?.reason)
    if (signal !== undefined) {
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', forward, { once: true })
    }
    const assembler = new BlockAssembler()
    let dispatched = false
    let recorded = false
    const recordUsage = (): void => {
      if (recorded || assembler.usage === undefined) return
      recorded = true
      addAuxiliaryTokens(metrics, assembler.usage)
    }
    try {
      if (controller.signal.aborted) return { reason: 'aborted' }
      const selected = this.deps.settings()
      const route = resolveIoTRequestRoute({
        provider: selected.iotThinkingProvider,
        model: selected.iotThinkingModel,
        reasoningEffort: selected.iotThinkingEffort,
      }, { provider: options.provider, model: options.model }, target)
      const request: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        reasoningEffort: ReasoningEffortId(route.reasoningEffort),
        messages: [createUserMessage({
          content: [{ type: 'text', text: buildCompactionPrompt(strategy, original) }],
          source: { kind: 'llm-verifier' },
        })],
        maxTokens: strategy.maxTokens,
        purpose: 'compaction',
        signal: controller.signal,
      }
      dispatched = true
      let finished = false
      for await (const chunk of this.deps.llm.stream(request)) {
        assembler.push(chunk)
        if (chunk.type === 'finish') finished = true
      }
      recordUsage()
      if (!finished) return { reason: 'incomplete' }
      if (assembler.finish.kind !== 'stop') {
        return { reason: assembler.finish.kind === 'aborted' && timedOut ? 'timeout' : assembler.finish.kind }
      }
      const text = assembler.blocks().filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
      const assessed = assessCompaction(text, strategy, original)
      return assessed.accepted ? { text: assessed.text } : { reason: assessed.reason }
    } catch {
      recordUsage()
      return { reason: timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' : 'error' }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
      if (dispatched) metrics.auxiliary.calls += 1
    }
  }

  private recordMainUsage(metrics: SessionIoTMetrics, usage: TokenUsage): void {
    metrics.main.inputTokens += usage.inputTokens
    metrics.main.cacheReadTokens += usage.cacheReadTokens ?? 0
    metrics.main.outputTokens += usage.outputTokens
    metrics.main.reasoningTokens += usage.reasoningTokens ?? 0
  }
}

function addAuxiliaryTokens(metrics: SessionIoTMetrics, usage: TokenUsage): void {
  metrics.auxiliary.inputTokens += usage.inputTokens
  metrics.auxiliary.cacheReadTokens += usage.cacheReadTokens ?? 0
  metrics.auxiliary.outputTokens += usage.outputTokens
  metrics.auxiliary.reasoningTokens += usage.reasoningTokens ?? 0
}
