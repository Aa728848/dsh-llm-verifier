/**
 * DeepSeek IoT-Lite: replace one finished reasoning block with a compacted trace.
 *
 * The block is the unit of work because a reasoning block is what the next request replays, and
 * because a block is complete before the replacement can be validated: deltas are buffered per
 * block, exactly one auxiliary call is made at block-end, and a refused answer costs nothing but
 * that call.
 *
 * What a replacement actually does: it substitutes the TEXT of one reasoning block. The chunk
 * shapes, the block indexes, every other chunk field, the main usage chunk, and the finish chunk
 * with its replay state (per-block signatures included) are relayed unchanged, so the host stores
 * a well-formed reply — but the stored reasoning is no longer what the model wrote, so the session
 * log and the next request's cache prefix DO differ from it. That divergence is the cost this
 * module buys, not something it avoids. See D15.
 *
 * Fail-safe direction: every failure path (refused answer, provider error, timeout, abort,
 * truncation, malformed stream) flushes the original deltas and the original block-end, in the
 * original order. See D15.
 */
import {
  BlockAssembler, ReasoningEffortId, createUserMessage, isAgentLoopRequest,
  type ContentBlock, type GenerateOptions, type LlmRuntime, type StreamChunk, type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {} from '../plugin/message-source.ts'
import {
  IOT_AUX_TIMEOUT_MS, IOT_MAX_CHARS, IOT_MIN_CHARS, findIoTTarget, resolveIoTRequestRoute, strategyFor,
  type IoTMode, type IoTRequestRoute, type IoTStrategy, type IoTThinkingTarget,
} from './mode.ts'
import { assessCompaction } from './compaction.ts'
import { IoTSessions, type SessionIoTMetrics } from './metrics.ts'
import { buildCompactionPrompt } from './prompt.ts'

/** Live settings the controller acts on; read fresh at every decision point. */
export interface IoTSettings {
  /**
   * Global auxiliary-thinking strategy; no per-session override exists. The level IS the switch:
   * `off` disables the feature and any other level enables it. The plugin's review-tools switch is
   * deliberately absent, so turning the tools off cannot stop this feature (D15).
   */
  iotThinking: IoTMode
  /** Global auxiliary model settings; unset fields use the enabled route's own provider and model, and low. */
  iotThinkingProvider?: string
  iotThinkingModel?: string
  iotThinkingEffort?: string
  /** Additional opt-in main routes, each with an optional auxiliary override. */
  iotThinkingTargets?: readonly IoTThinkingTarget[]
}

/** Everything the controller needs from its host. */
export interface IoTDeps {
  llm: LlmRuntime
  settings: () => IoTSettings
  /** Diagnostics only: reasons and counts, never reasoning text or credentials. */
  logger?: { warn(message: string): void; info?(message: string): void }
}

/** One request eligible for compaction. */
interface EligibleRequest {
  sessionId: string
  strategy: IoTStrategy
  target?: IoTThinkingTarget
}

/** Reasoning deltas of one open block, plus the two facts that decide its fate. */
interface ReasoningBuffer {
  deltas: string[]
  chars: number
  /** Over the prompt cap: the block is relayed as it arrived from here on. */
  overflowed: boolean
  /** Already drained by a terminal chunk, so a late block-end must not be counted again. */
  flushed: boolean
}

/** One auxiliary call's verdict. */
interface CompactionOutcome {
  text?: string
  reason?: string
}

/** The controller the host wires onto `llm/stream` and session disposal. */
export class IoTController {
  private readonly sessions = new IoTSessions()

  /**
   * @param deps - host seams: the LLM runtime, live settings, and a diagnostic logger.
   */
  constructor(private readonly deps: IoTDeps) {}

  /**
   * Wrap one stream. Ineligible requests reach `next()` untouched and are never buffered.
   * @param options - the request entering the waterfall.
   * @param next - the rest of the waterfall.
   * @returns The possibly compacted stream.
   */
  stream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const eligible = this.eligible(options)
    if (eligible === undefined) return next()
    return this.compacting(options, eligible, next)
  }

  /**
   * Forget one session's override and counters (session disposal, settings reset).
   * @param sessionId - session to forget.
   */
  clear(sessionId: string): void { this.sessions.clear(sessionId) }

  /**
   * The strategy one session would run under right now.
   * @param sessionId - session to read.
   * @returns The effective mode.
   */
  mode(sessionId: string | undefined): IoTMode {
    return this.deps.settings().iotThinking
  }

  /**
   * Detached counters of one session.
   * @param sessionId - session to read.
   * @returns The snapshot, or undefined when nothing was recorded yet.
   */
  metrics(sessionId: string): SessionIoTMetrics | undefined { return this.sessions.metrics(sessionId) }

  /**
   * The one place eligibility is decided.
   *
   * Every fact here is required, and the agent-loop marker is what makes the feature safe against
   * itself: an auxiliary call is a hand-built request with no session id, so it can never satisfy
   * this check — no recursion, no double counting. The opt-in route is the last fact: no matching
   * target means no work at all, so enabling a provider cannot spend another provider's credential.
   * The plugin's review-tools switch is NOT one of them: this feature stands on its own level, so
   * turning the review tools off must not silently stop it (D15).
   * @param options - the request entering the waterfall.
   * @returns The session and strategy, or undefined to delegate untouched.
   */
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

  /**
   * The buffering body of one eligible request.
   * @param options - the request, unchanged (its route and signal are reused for the auxiliary call).
   * @param eligible - the resolved session and strategy.
   * @param next - the rest of the waterfall.
   * @returns The main stream, with compacted reasoning blocks.
   */
  private async *compacting(
    options: GenerateOptions,
    eligible: EligibleRequest,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncGenerator<StreamChunk> {
    const metrics = this.sessions.metricsFor(eligible.sessionId, eligible.strategy.mode)
    const buffers = new Map<number, ReasoningBuffer>()
    const open: number[] = []

    const close = (index: number): void => {
      buffers.delete(index)
      const at = open.indexOf(index)
      if (at >= 0) open.splice(at, 1)
    }
    /** Relay what is buffered for one block, in the order it arrived, and empty the buffer. */
    const relay = function* (buffer: ReasoningBuffer, index: number): Generator<StreamChunk> {
      for (const text of buffer.deltas) yield { type: 'reasoning-delta', index, text }
      buffer.deltas = []
      buffer.chars = 0
    }
    /** Relay every open buffer before a terminal chunk, so no text is ever lost. */
    const relayOpen = function* (): Generator<StreamChunk> {
      for (const index of [...open]) {
        const buffer = buffers.get(index)
        if (buffer === undefined) continue
        yield* relay(buffer, index)
        buffer.flushed = true
      }
    }

    try {
      for await (const chunk of next()) {
        switch (chunk.type) {
          case 'block-start':
            if (chunk.blockType === 'reasoning' && !buffers.has(chunk.index)) {
              buffers.set(chunk.index, { deltas: [], chars: 0, overflowed: false, flushed: false })
              open.push(chunk.index)
            }
            yield chunk
            break
          case 'reasoning-delta': {
            const buffer = buffers.get(chunk.index)
            if (buffer === undefined || buffer.overflowed) {
              yield chunk
              break
            }
            buffer.deltas.push(chunk.text)
            buffer.chars += chunk.text.length
            if (buffer.chars > IOT_MAX_CHARS) {
              // Too large to be worth a prompt: stop compacting THIS block and keep the stream live.
              buffer.overflowed = true
              yield* relay(buffer, chunk.index)
            }
            break
          }
          case 'block-end': {
            const buffer = buffers.get(chunk.index)
            if (buffer === undefined) {
              yield chunk
              break
            }
            close(chunk.index)
            if (buffer.deltas.length === 0) {
              if (!buffer.flushed) metrics.skips += 1
              yield chunk
              break
            }
            const original = buffer.deltas.join('')
            if (chunk.block.type !== 'reasoning' || original.length < IOT_MIN_CHARS || original.length > IOT_MAX_CHARS) {
              metrics.skips += 1
              this.keepBlock(metrics, original.length)
              yield* relay(buffer, chunk.index)
              yield chunk
              break
            }
            const outcome = await this.compact(options, eligible.strategy, original, options.signal, metrics, eligible.target)
            if (outcome.text === undefined) {
              metrics.failures += 1
              this.deps.logger?.warn('llm-iot: kept the original reasoning block (' + (outcome.reason ?? 'refused') + ')')
              this.keepBlock(metrics, original.length)
              yield* relay(buffer, chunk.index)
              yield chunk
              break
            }
            this.replaceBlock(metrics, original.length, outcome.text.length)
            this.deps.logger?.info?.('llm-iot: replaced a reasoning block (' + original.length + ' -> ' + outcome.text.length + ' chars)')
            // One delta carrying the whole replacement, then the block-end with the new text. Every
            // other field (index, and any adapter-private extension) is carried over untouched.
            yield { type: 'reasoning-delta', index: chunk.index, text: outcome.text }
            yield { ...chunk, block: { ...chunk.block, text: outcome.text } }
            break
          }
          case 'usage':
            yield* relayOpen()
            this.recordMainUsage(metrics, chunk.usage)
            yield chunk
            break
          case 'finish':
            yield* relayOpen()
            yield chunk
            break
          default:
            yield chunk
        }
      }
    } catch (error) {
      // The source died: hand out what it already produced before the failure reaches the host.
      yield* relayOpen()
      throw error
    }
    yield* relayOpen()
  }

  /**
   * One auxiliary compaction call: no retry, no tools, no session identity, one deadline.
   *
   * Collected through `BlockAssembler` so the answer is judged exactly like any other model reply,
   * and consumed here so none of its chunks can leak into the main stream.
   * @param options - the main request whose route is reused.
   * @param strategy - budget the answer must satisfy.
   * @param original - reasoning text being replaced.
   * @param signal - the main request's cancellation.
   * @param metrics - counters that receive the auxiliary spend even when the call fails.
   * @returns Accepted text, or the reason the original must be kept.
   */
  private async compact(
    options: GenerateOptions,
    strategy: IoTStrategy,
    original: string,
    signal: AbortSignal | undefined,
    metrics: SessionIoTMetrics,
    target?: IoTThinkingTarget,
  ): Promise<CompactionOutcome> {
    const controller = new AbortController()
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
      // Only a natural stop finished the answer. A truncated, aborted, failed or tool-calling turn
      // did not, even when the text it managed to write is shaped like a valid answer.
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

  /** Count one block as relayed unchanged. */
  private keepBlock(metrics: SessionIoTMetrics, chars: number): void {
    metrics.kept += 1
    metrics.chars.original += chars
    metrics.chars.emitted += chars
  }

  /** Count one block as replaced. */
  private replaceBlock(metrics: SessionIoTMetrics, before: number, after: number): void {
    metrics.replacements += 1
    metrics.chars.original += before
    metrics.chars.emitted += after
  }

  /** Add the main request's token counts; the chunk itself is relayed unaltered. */
  private recordMainUsage(metrics: SessionIoTMetrics, usage: TokenUsage): void {
    metrics.main.inputTokens += usage.inputTokens
    metrics.main.cacheReadTokens += usage.cacheReadTokens ?? 0
    metrics.main.outputTokens += usage.outputTokens
    metrics.main.reasoningTokens += usage.reasoningTokens ?? 0
  }

}

/** Add one auxiliary call's tokens to a session's auxiliary counters. */
function addAuxiliaryTokens(metrics: SessionIoTMetrics, usage: TokenUsage): void {
  metrics.auxiliary.inputTokens += usage.inputTokens
  metrics.auxiliary.cacheReadTokens += usage.cacheReadTokens ?? 0
  metrics.auxiliary.outputTokens += usage.outputTokens
  metrics.auxiliary.reasoningTokens += usage.reasoningTokens ?? 0
}
