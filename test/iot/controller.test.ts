import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isAgentLoopRequest, markAgentLoopRequest, ReasoningEffortId,
  type GenerateOptions, type LlmRuntime, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  IOT_AUX_TIMEOUT_MS, IOT_MAX_CHARS, IOT_MAX_SESSIONS, IOT_MIN_CHARS, IOT_STRATEGIES,
  IoTController, type IoTMode, type IoTSettings,
} from '../../src/iot/index.ts'

const COMPACTED = '- [goal] Fix the parser\n- [open] Whether a retry is needed'

/** Reasoning text of an exact length, distinct enough to look like a real trace. */
function reasoning(length: number): string {
  const unit = 'I will inspect the parser and the failing fixture first; '
  let text = ''
  while (text.length < length) text += unit
  return text.slice(0, length)
}

function reasoningChunks(index: number, text: string, shape: { start?: boolean; end?: boolean } = {}): StreamChunk[] {
  const chunks: StreamChunk[] = []
  if (shape.start !== false) chunks.push({ type: 'block-start', index, blockType: 'reasoning' })
  chunks.push({ type: 'reasoning-delta', index, text })
  if (shape.end !== false) chunks.push({ type: 'block-end', index, block: { type: 'reasoning', text } })
  return chunks
}

function textChunks(index: number, text: string): StreamChunk[] {
  return [
    { type: 'block-start', index, blockType: 'text' },
    { type: 'text-delta', index, text },
    { type: 'block-end', index, block: { type: 'text', text } },
  ]
}

function tail(kind: 'stop' | 'tool-calls' = 'stop', usage = { inputTokens: 100, outputTokens: 40 }): StreamChunk[] {
  return [
    { type: 'usage', usage },
    { type: 'finish', reason: { kind } },
  ] as StreamChunk[]
}

function auxReply(text: string, options: { finish?: 'stop' | 'max-tokens' | 'tool-calls' | 'error' | 'aborted'; usage?: Record<string, number>; noFinish?: boolean } = {}): StreamChunk[] {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
  ]
  if (options.usage !== undefined) chunks.push({ type: 'usage', usage: options.usage } as StreamChunk)
  if (options.noFinish !== true) {
    chunks.push({
      type: 'finish',
      reason: options.finish === undefined || options.finish === 'stop'
        ? { kind: 'stop' }
        : options.finish === 'max-tokens'
          ? { kind: 'max-tokens' }
          : options.finish === 'tool-calls'
            ? { kind: 'tool-calls' }
            : { kind: options.finish, failure: { message: 'provider said no' } as never },
    } as StreamChunk)
  }
  return chunks
}

type AuxBehaviour = (request: GenerateOptions, call: number) => AsyncIterable<StreamChunk>

async function* streamOf(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

interface Harness {
  controller: IoTController
  calls: GenerateOptions[]
  warnings: string[]
  infos: string[]
  settings: IoTSettings
}

/** The opt-in route these tests run under: no route, no work — there is no provider exemption. */
const OFFICIAL_TARGET = { provider: 'deepseek-official' }

function makeController(
  settings: IoTSettings = { iotThinking: 'compact', iotThinkingTargets: [OFFICIAL_TARGET] },
  reply?: AuxBehaviour,
): Harness {
  const calls: GenerateOptions[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const llm = {
    stream: (request: GenerateOptions) => {
      calls.push(request)
      return reply === undefined ? streamOf(auxReply(COMPACTED)) : reply(request, calls.length)
    },
  } as unknown as LlmRuntime
  const controller = new IoTController({
    llm,
    settings: () => settings,
    logger: { warn: message => warnings.push(message), info: message => infos.push(message) },
  })
  return { controller, calls, warnings, infos, settings }
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({ provider: 'deepseek-official', model: 'deepseek-reasoner', messages: [], sessionId: 's-1' as never, ...overrides })
}

function mainOf(chunks: readonly StreamChunk[]) {
  let calls = 0
  return { next: () => { calls += 1; return streamOf(chunks) }, calls: () => calls }
}

function deltas(chunks: readonly StreamChunk[], index: number): string {
  return chunks.filter(chunk => chunk.type === 'reasoning-delta' && chunk.index === index).map(chunk => chunk.text).join('')
}

function blockEndOf(chunks: readonly StreamChunk[], index: number) {
  const found = chunks.filter(chunk => chunk.type === 'block-end' && chunk.index === index)
  expect(found).toHaveLength(1)
  return found[0]
}

const LONG = reasoning(600)

afterEach(() => { vi.useRealTimers() })

describe('eligibility', () => {
  it('does nothing without an opt-in route, even on deepseek-official', async () => {
    const { controller, calls } = makeController({ iotThinking: 'compact' })
    const source = [...reasoningChunks(0, LONG), ...tail()]
    const main = mainOf(source)
    const out = await collect(controller.stream(request(), main.next))
    expect(out).toEqual(source)
    expect(calls).toHaveLength(0)
    // Passed through untouched means unbuffered too: the source was consumed exactly once.
    expect(main.calls()).toBe(1)
    expect(controller.metrics('s-1')).toBeUndefined()
  })

  it('never compacts a request from another provider', async () => {
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request({ provider: 'openrouter' }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
  })

  it('never compacts a request the agent loop did not build', async () => {
    const { controller, calls } = makeController()
    const unmarked: GenerateOptions = { provider: 'deepseek-official', model: 'deepseek-reasoner', messages: [], sessionId: 's-1' as never }
    expect(isAgentLoopRequest(unmarked)).toBe(false)
    const out = await collect(controller.stream(unmarked, mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
  })

  it('never compacts a request without a session id', async () => {
    const { controller, calls } = makeController()
    const anonymous = markAgentLoopRequest({ provider: 'deepseek-official', model: 'deepseek-reasoner', messages: [] })
    const out = await collect(controller.stream(anonymous, mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
  })

  it('passes everything through when the effective strategy is off', async () => {
    const { controller, calls } = makeController({ iotThinking: 'off' })
    const source = [...reasoningChunks(0, LONG), ...tail()]
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(out).toEqual(source)
    expect(calls).toHaveLength(0)
  })
})

describe('replacement', () => {
  it('replaces one reasoning block with a single delta and a rewritten block-end', async () => {
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    const reasoningOut = out.filter(chunk => chunk.type === 'reasoning-delta')
    expect(reasoningOut).toHaveLength(1)
    expect(deltas(out, 0)).toBe(COMPACTED)
    expect(blockEndOf(out, 0).block).toEqual({ type: 'reasoning', text: COMPACTED })
    expect(out[0]).toEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(calls).toHaveLength(1)
    expect(controller.metrics('s-1')?.replacements).toBe(1)
  })

  it('compacts every eligible block and keeps the block order', async () => {
    const { controller, calls } = makeController()
    const source = [...reasoningChunks(0, reasoning(500)), ...reasoningChunks(1, reasoning(700)), ...tail()]
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(COMPACTED)
    expect(deltas(out, 1)).toBe(COMPACTED)
    expect(calls).toHaveLength(2)
  })

  it('keeps interleaved blocks apart and relays non-reasoning chunks unchanged', async () => {
    const first = reasoning(500).replace(/x/g, 'a')
    const second = reasoning(520).replace(/x/g, 'b')
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 2, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'reasoning-delta', index: 0, text: first.slice(0, 250) },
      { type: 'text-delta', index: 1, text: 'visible ' },
      { type: 'reasoning-delta', index: 2, text: second.slice(0, 260) },
      { type: 'reasoning-delta', index: 0, text: first.slice(250) },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'reasoning-delta', index: 2, text: second.slice(260) },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: first } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'visible answer' } },
      { type: 'block-end', index: 2, block: { type: 'reasoning', text: second } },
      ...tail(),
    ]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(COMPACTED)
    expect(deltas(out, 2)).toBe(COMPACTED)
    expect(out.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text)).toEqual(['visible ', 'answer'])
    expect(blockEndOf(out, 1).block).toEqual({ type: 'text', text: 'visible answer' })
    // Every replacement delta still precedes its own block-end.
    const endAt = out.findIndex(chunk => chunk.type === 'block-end' && chunk.index === 2)
    const lastDeltaAt = out.map(chunk => chunk.type === 'reasoning-delta' && chunk.index === 2).lastIndexOf(true)
    expect(lastDeltaAt).toBeLessThan(endAt)
    expect(calls).toHaveLength(2)
  })

  it('makes no call for a block that ends without deltas', async () => {
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } },
      ...tail(),
    ]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(out.filter(chunk => chunk.type === 'block-end')).toHaveLength(1)
    expect(out.filter(chunk => chunk.type === 'reasoning-delta')).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(controller.metrics('s-1')?.skips).toBe(1)
  })

  it('skips a block one character below the minimum and compacts one exactly at it', async () => {
    const below = reasoning(IOT_MIN_CHARS - 1)
    const atMin = reasoning(IOT_MIN_CHARS)
    const source = [...reasoningChunks(0, below), ...reasoningChunks(1, atMin), ...tail()]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(below)
    expect(blockEndOf(out, 0).block).toEqual({ type: 'reasoning', text: below })
    expect(deltas(out, 1)).toBe(COMPACTED)
    expect(calls).toHaveLength(1)
    expect(controller.metrics('s-1')?.skips).toBe(1)
    expect(controller.metrics('s-1')?.kept).toBe(1)
  })

  it('compacts a block exactly at the maximum and skips one character above it', async () => {
    const atMax = reasoning(IOT_MAX_CHARS)
    const above = reasoning(IOT_MAX_CHARS + 1)
    const { controller, calls } = makeController()
    const first = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, atMax), ...tail()]).next))
    expect(deltas(first, 0)).toBe(COMPACTED)
    expect(calls).toHaveLength(1)

    const second = await collect(controller.stream(request({ sessionId: 's-2' as never }), mainOf([...reasoningChunks(0, above), ...tail()]).next))
    expect(deltas(second, 0)).toBe(above)
    expect(blockEndOf(second, 0).block).toEqual({ type: 'reasoning', text: above })
    expect(calls).toHaveLength(1)
  })

  it('relays a block that overran the cap while it is still streaming', async () => {
    const chunk = reasoning(2000)
    const source: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'reasoning' }]
    for (let at = 0; at < IOT_MAX_CHARS + chunk.length; at += chunk.length) source.push({ type: 'reasoning-delta', index: 0, text: chunk })
    source.push({ type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning(IOT_MAX_CHARS + 2000) } }, ...tail())
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(chunk.repeat(Math.ceil((IOT_MAX_CHARS + 2000) / chunk.length)))
    expect(calls).toHaveLength(0)
    expect(controller.metrics('s-1')?.skips).toBe(1)
  })

  it('flushes an open buffer when the source ends without a block-end', async () => {
    const source = [...reasoningChunks(0, LONG, { end: false })]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(out.filter(chunk => chunk.type === 'block-end')).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('flushes before the finish chunk of an unterminated block', async () => {
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: LONG },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { controller } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(out.map(chunk => chunk.type)).toEqual(['block-start', 'reasoning-delta', 'finish'])
    expect(deltas(out, 0)).toBe(LONG)
  })

  it('flushes before an early usage chunk and relays it unchanged', async () => {
    const usage = { inputTokens: 12, outputTokens: 3, cacheReadTokens: 5, reasoningTokens: 7 }
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: LONG },
      { type: 'usage', usage },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { controller } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(out.map(chunk => chunk.type)).toEqual(['block-start', 'reasoning-delta', 'usage', 'finish'])
    expect(out[2]).toEqual({ type: 'usage', usage })
    expect(controller.metrics('s-1')?.main).toEqual({ inputTokens: 12, cacheReadTokens: 5, outputTokens: 3, reasoningTokens: 7 })
  })

  it('relays the main usage chunk unaltered and records it', async () => {
    const usage = { inputTokens: 9, outputTokens: 4, cacheReadTokens: 2, reasoningTokens: 1 }
    const source = [...reasoningChunks(0, LONG), { type: 'usage', usage } as StreamChunk, { type: 'finish', reason: { kind: 'stop' } } as StreamChunk]
    const { controller } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    const usageOut = out.filter(chunk => chunk.type === 'usage')
    expect(usageOut).toHaveLength(1)
    expect(usageOut[0]).toEqual({ type: 'usage', usage })
    expect(controller.metrics('s-1')?.main).toEqual({ inputTokens: 9, cacheReadTokens: 2, outputTokens: 4, reasoningTokens: 1 })
  })

  it('relays a late block-end after a barrier flush without a second skip', async () => {
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: LONG },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: LONG } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(out.map(chunk => chunk.type)).toEqual(['block-start', 'reasoning-delta', 'usage', 'block-end', 'finish'])
    expect(calls).toHaveLength(0)
    expect(controller.metrics('s-1')?.skips).toBe(0)
  })

  it('never mutates the request it was given', async () => {
    const { controller } = makeController()
    const frozen = Object.freeze(request())
    await expect(collect(controller.stream(frozen, mainOf([...reasoningChunks(0, LONG), ...tail()]).next))).resolves.toBeDefined()
    expect(frozen.provider).toBe('deepseek-official')
  })

  it('passes a stream with no reasoning blocks through unchanged', async () => {
    const source = [...textChunks(0, 'plain answer'), ...tail()]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(out).toEqual(source)
    expect(calls).toHaveLength(0)
  })

  it('relays deltas of a block that never announced itself', async () => {
    const source: StreamChunk[] = [
      { type: 'reasoning-delta', index: 0, text: LONG },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: LONG } },
      ...tail(),
    ]
    const { controller, calls } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
  })

  it('preserves the finish replay metadata and every extra block-end field', async () => {
    const replayState = { response: { kind: 'deepseek-messages', version: 1, model: 'deepseek-reasoner' }, blocks: [{ type: 'reasoning', signature: 'sig-1' }] }
    const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' }, replayState }
    const source: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: LONG },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: LONG }, meta: { signature: 'sig-1' } } as unknown as StreamChunk,
      finish,
    ]
    const { controller } = makeController()
    const out = await collect(controller.stream(request(), mainOf(source).next))
    const finishOut = out.filter(chunk => chunk.type === 'finish')
    expect(finishOut).toHaveLength(1)
    expect(finishOut[0]).toBe(finish)
    expect((finishOut[0] as never as { replayState: unknown }).replayState).toEqual(replayState)
    const end = blockEndOf(out, 0) as unknown as { meta?: unknown; block: { text: string } }
    expect(end.block.text).toBe(COMPACTED)
    expect(end.meta).toEqual({ signature: 'sig-1' })
  })
})

describe('auxiliary request', () => {
  it('is one plugin-owned auxiliary call on the same route with no session and no tools', async () => {
    const { controller, calls } = makeController()
    const main = request({ temperature: 0.3, maxTokens: 4096, tools: [{ name: 'read', description: 'read', parameters: {} }] })
    await collect(controller.stream(main, mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(calls).toHaveLength(1)
    const aux = calls[0]
    expect(aux.provider).toBe('deepseek-official')
    expect(aux.model).toBe('deepseek-reasoner')
    expect(aux.reasoningEffort).toBe(ReasoningEffortId('low'))
    expect(aux.purpose).toBe('compaction')
    expect(aux.maxTokens).toBe(IOT_STRATEGIES.compact.maxTokens)
    expect(aux.sessionId).toBeUndefined()
    expect(aux.tools).toBeUndefined()
    expect(isAgentLoopRequest(aux)).toBe(false)
    expect(aux.signal).toBeInstanceOf(AbortSignal)
    const prompt = (aux.messages[0] as unknown as { content: { text: string }[] }).content[0].text
    expect(prompt).toContain(LONG)
    expect(prompt).toContain('goal')
  })

  it('cannot recurse: the auxiliary request itself passes straight through', async () => {
    const { controller, calls } = makeController()
    await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    const aux = calls[0]
    const source = [...reasoningChunks(0, LONG), ...tail()]
    const out = await collect(controller.stream(aux, mainOf(source).next))
    expect(out).toEqual(source)
    expect(calls).toHaveLength(1)
  })

  it('never lets an auxiliary chunk into the main stream', async () => {
    const sentinel = 'AUX-ONLY-TEXT'
    const { controller } = makeController(undefined, () => streamOf([
      { type: 'text-delta', index: 0, text: sentinel },
      ...auxReply(COMPACTED),
    ]))
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(out.some(chunk => chunk.type === 'text-delta')).toBe(false)
    expect(JSON.stringify(out)).not.toContain(sentinel)
  })
})

describe('failure handling', () => {
  it('keeps the original when the auxiliary stream throws', async () => {
    const failing: AuxBehaviour = async function* () { throw new Error('aux unavailable') }
    const { controller, calls, warnings } = makeController(undefined, failing)
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(blockEndOf(out, 0).block).toEqual({ type: 'reasoning', text: LONG })
    expect(calls).toHaveLength(1)
    const metrics = controller.metrics('s-1')
    expect(metrics?.failures).toBe(1)
    expect(metrics?.kept).toBe(1)
    expect(metrics?.replacements).toBe(0)
    expect(warnings.join('\n')).not.toContain(LONG.slice(0, 60))
  })

  it('keeps the original when the answer is malformed', async () => {
    const { controller } = makeController(undefined, () => streamOf(auxReply('here is a shorter summary without labels')))
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(controller.metrics('s-1')?.failures).toBe(1)
  })

  it('keeps the original when the answer is not shorter', async () => {
    const { controller } = makeController(undefined, () => streamOf(auxReply('- [goal] ' + LONG)))
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(controller.metrics('s-1')?.failures).toBe(1)
  })

  it('keeps the original when the answer uses a label outside the strategy', async () => {
    const { controller } = makeController(undefined, () => streamOf(auxReply('- [risk] something risks breaking')))
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(controller.metrics('s-1')?.failures).toBe(1)
  })

  it('keeps the original when the auxiliary answer hit the output ceiling', async () => {
    const { controller } = makeController(undefined, () => streamOf(auxReply(COMPACTED, { finish: 'max-tokens' })))
    const out = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(controller.metrics('s-1')?.failures).toBe(1)
  })

  it('keeps the original when the auxiliary answer stopped for tool calls or any other reason', async () => {
    // The text below IS a valid compaction; the finish reason alone must reject it.
    const toolCalls = makeController(undefined, () => streamOf(auxReply(COMPACTED, { finish: 'tool-calls' })))
    const first = await collect(toolCalls.controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(first, 0)).toBe(LONG)
    expect(blockEndOf(first, 0).block).toEqual({ type: 'reasoning', text: LONG })
    expect(toolCalls.controller.metrics('s-1')?.replacements).toBe(0)
    expect(toolCalls.controller.metrics('s-1')?.failures).toBe(1)

    const adapterKind = makeController(undefined, () => streamOf([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: COMPACTED },
      { type: 'block-end', index: 0, block: { type: 'text', text: COMPACTED } },
      { type: 'finish', reason: { kind: 'safety' } } as unknown as StreamChunk,
    ]))
    const second = await collect(adapterKind.controller.stream(request({ sessionId: 's-2' as never }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(second, 0)).toBe(LONG)
    expect(adapterKind.controller.metrics('s-2')?.replacements).toBe(0)
    expect(adapterKind.controller.metrics('s-2')?.failures).toBe(1)
  })

  it('keeps the original when the auxiliary answer was aborted or ended early', async () => {
    const aborted = makeController(undefined, () => streamOf(auxReply(COMPACTED, { finish: 'aborted' })))
    const first = await collect(aborted.controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(first, 0)).toBe(LONG)
    expect(aborted.controller.metrics('s-1')?.failures).toBe(1)

    const truncated = makeController(undefined, () => streamOf(auxReply(COMPACTED, { noFinish: true })))
    const second = await collect(truncated.controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(second, 0)).toBe(LONG)
    expect(truncated.controller.metrics('s-1')?.failures).toBe(1)
  })

  it('aborts the auxiliary call at the fixed deadline, once, without retry', async () => {
    vi.useFakeTimers()
    const hanging: AuxBehaviour = async function* (auxRequest) {
      await new Promise<never>((_, reject) => {
        if (auxRequest.signal === undefined) throw new Error('the auxiliary call must carry a signal')
        auxRequest.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    const { controller, calls } = makeController(undefined, hanging)
    const pending = collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    await vi.advanceTimersByTimeAsync(IOT_AUX_TIMEOUT_MS)
    const out = await pending
    expect(deltas(out, 0)).toBe(LONG)
    expect(calls).toHaveLength(1)
    expect(controller.metrics('s-1')?.failures).toBe(1)
  })

  it('does not dispatch at all when the main request is already cancelled', async () => {
    const controller = new IoTController({
      llm: { stream: () => { throw new Error('must not be called') } } as unknown as LlmRuntime,
      settings: () => ({ iotThinking: 'compact', iotThinkingTargets: [OFFICIAL_TARGET] }),
    })
    const cancelled = new AbortController()
    cancelled.abort(new Error('user cancelled'))
    const main = request({ signal: cancelled.signal })
    const out = await collect(controller.stream(main, mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(deltas(out, 0)).toBe(LONG)
    expect(controller.metrics('s-1')?.failures).toBe(1)
    expect(controller.metrics('s-1')?.auxiliary.calls).toBe(0)
  })

  it('propagates a source failure after relaying what was already buffered', async () => {
    let step = 0
    async function* source(): AsyncIterable<StreamChunk> {
      step += 1
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: LONG }
      throw new Error('transport died')
    }
    const { controller } = makeController()
    const out: StreamChunk[] = []
    await expect((async () => { for await (const chunk of controller.stream(request(), source)) out.push(chunk) })()).rejects.toThrow('transport died')
    expect(out.map(chunk => chunk.type)).toEqual(['block-start', 'reasoning-delta'])
    expect(deltas(out, 0)).toBe(LONG)
    expect(step).toBe(1)
  })
})

describe('usage accounting', () => {
  it('records main and auxiliary tokens separately', async () => {
    const usage = { inputTokens: 50, outputTokens: 20, cacheReadTokens: 8, reasoningTokens: 30 }
    const { controller } = makeController(undefined, () => streamOf(auxReply(COMPACTED, { usage: { inputTokens: 300, outputTokens: 60, reasoningTokens: 10 } })))
    const source = [...reasoningChunks(0, LONG), ...tail('stop', usage)]
    await collect(controller.stream(request(), mainOf(source).next))
    const metrics = controller.metrics('s-1')
    expect(metrics?.main).toEqual({ inputTokens: 50, cacheReadTokens: 8, outputTokens: 20, reasoningTokens: 30 })
    expect(metrics?.auxiliary).toEqual({ calls: 1, inputTokens: 300, cacheReadTokens: 0, outputTokens: 60, reasoningTokens: 10 })
  })

  it('counts the auxiliary call even when it fails, and never mixes sessions', async () => {
    const failing: AuxBehaviour = async function* () { throw new Error('down') }
    const { controller } = makeController(undefined, failing)
    await collect(controller.stream(request({ sessionId: 's-a' as never }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    const ok = makeController()
    await collect(ok.controller.stream(request({ sessionId: 's-b' as never }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(controller.metrics('s-a')?.auxiliary.calls).toBe(1)
    expect(controller.metrics('s-a')?.failures).toBe(1)
    expect(controller.metrics('s-b')).toBeUndefined()
    expect(ok.controller.metrics('s-b')?.replacements).toBe(1)
    expect(controller.metrics('s-a')?.chars.original).toBe(LONG.length)
    expect(controller.metrics('s-a')?.chars.emitted).toBe(LONG.length)
    expect(ok.controller.metrics('s-b')?.chars.emitted).toBe(COMPACTED.length)
  })

  it('evicts the least recently used session past the cap', async () => {
    const { controller } = makeController()
    for (let at = 0; at < IOT_MAX_SESSIONS; at += 1) {
      await collect(controller.stream(request({ sessionId: ('s-' + at) as never }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    }
    expect(controller.metrics('s-0')?.replacements).toBe(1)
    await collect(controller.stream(request({ sessionId: ('s-' + IOT_MAX_SESSIONS) as never }), mainOf([...reasoningChunks(0, LONG), ...tail()]).next))
    expect(controller.metrics('s-1')).toBeUndefined()
    expect(controller.metrics('s-' + IOT_MAX_SESSIONS)?.replacements).toBe(1)
  })
})

describe('global settings and provider routes', () => {
  it('follows live global changes without any session override', async () => {
    const settings = { iotThinking: 'compact' as IoTMode, iotThinkingTargets: [OFFICIAL_TARGET] }
    const { controller, calls } = makeController(settings)
    settings.iotThinking = 'off'
    const closed = await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(deltas(closed, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
    settings.iotThinking = 'full'
    await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.maxTokens).toBe(1600)
  })

  it('uses the global auxiliary DeepSeek model override', async () => {
    const { controller, calls } = makeController({
      iotThinking: 'compact',
      iotThinkingTargets: [OFFICIAL_TARGET],
      iotThinkingProvider: 'opendesign',
      iotThinkingModel: 'deepseek-v4.1-flash',
      iotThinkingEffort: 'high',
    })
    await collect(controller.stream(request(), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'opendesign', model: 'deepseek-v4.1-flash', reasoningEffort: 'high', purpose: 'compaction' })
    expect(calls[0]?.sessionId).toBeUndefined()
    expect(calls[0]?.tools).toBeUndefined()
  })

  it('enables a configured main route and applies its auxiliary override', async () => {
    const { controller, calls } = makeController({
      iotThinking: 'balanced',
      iotThinkingTargets: [{ provider: 'opendesign', model: 'deepseek-v4.1-flash', rewriteProvider: 'kimi-code', rewriteModel: 'k3', rewriteEffort: 'max' }],
    })
    await collect(controller.stream(request({ provider: 'opendesign', model: 'deepseek-v4.1-flash' }), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'kimi-code', model: 'k3', reasoningEffort: 'max', maxTokens: 1200 })
  })

  it('follows the enabled route itself when no auxiliary route is configured', async () => {
    const { controller, calls } = makeController({
      iotThinking: 'compact',
      iotThinkingTargets: [{ provider: 'deepseek-account' }],
    })
    await collect(controller.stream(request({ provider: 'deepseek-account', model: 'deepseek-reasoner' }), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low', purpose: 'compaction' })
  })

  it('passes through an unconfigured main provider even when auxiliary thinking is on', async () => {
    const { controller, calls } = makeController({ iotThinking: 'compact' })
    const chunks = await collect(controller.stream(request({ provider: 'opendesign', model: 'deepseek-v4.1-flash' }), mainOf([...reasoningChunks(0, LONG)]).next))
    expect(deltas(chunks, 0)).toBe(LONG)
    expect(calls).toHaveLength(0)
  })
})
