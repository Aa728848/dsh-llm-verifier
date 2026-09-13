import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAgentLoopRequest, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  PROCESS_CANDIDATE_CAP_CHARS, PROCESS_INTENT_TTL_MS, ProcessCycleStore, ProcessSelector,
  buildAlternativeRequest, candidateIdentity, finishKind, measureChunk, renderCandidate, renderCandidateView,
  usageFromChunks, type ProcessCycleReport, type ProcessIntent, type ProcessSelectorDeps,
} from './process-selection.ts'
import type { AutoVerifierRouter, Reservation, RouterPolicy } from './router.ts'
import { emptyUsage } from './caller.ts'

const tempDirs: string[] = []
function tempPath(name = 'process.json'): string { const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-process-')); tempDirs.push(dir); return join(dir, name) }
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function textChunks(text: string, kind: 'stop' | 'tool-calls' | 'error' = 'stop', usage = true): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    ...(usage ? [{ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } } as StreamChunk] : []),
    { type: 'finish', reason: kind === 'error' ? { kind: 'error', failure: { message: 'boom' } as never } : { kind } } as StreamChunk,
  ]
}
function toolCallChunks(id: string, name: string, args: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: id as never, name, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: id as never, name, arguments: args } },
    { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] as StreamChunk[]
}
async function* streamOf(chunks: readonly StreamChunk[]) { for (const chunk of chunks) yield chunk }

function compareResult(winner: 'A' | 'B' | 'tie', overrides: Record<string, unknown> = {}) {
  return {
    scoreA: winner === 'B' ? 0.2 : 0.8,
    scoreB: winner === 'B' ? 0.8 : 0.2,
    winner,
    criteria: [],
    calls: 6,
    stats: { ...emptyUsage(), calls: 6, attempts: 6, inputTokens: 60, outputTokens: 30, cacheHits: 0, cacheMisses: 6, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 6 },
    judges: [],
    agreement: 1,
    ...overrides,
  } as never
}

interface Harness {
  selector: ProcessSelector
  reports: ProcessCycleReport[]
  warnings: string[]
  store: ProcessCycleStore
  reserved: Reservation[]
  committed: number
  failed: number
  advance(ms: number): void
}

function harness(overrides: Partial<ProcessSelectorDeps> = {}, storeFile = tempPath()): Harness {
  const reports: ProcessCycleReport[] = []
  const warnings: string[] = []
  const store = new ProcessCycleStore(storeFile)
  const reserved: Reservation[] = []
  let committed = 0
  let failed = 0
  let clock = 1000
  const router = {
    reserve: (_agent: unknown, phase: string, fingerprint: string, expectedCalls: number) => {
      const reservation: Reservation = { id: 'cycle-' + (reserved.length + 1), phase: phase as never, fingerprint, taskStartSeq: 5, expectedCalls, attempt: reserved.length + 1 }
      reserved.push(reservation)
      return reservation
    },
    commit: () => { committed += 1; return true },
    fail: () => { failed += 1 },
  } as unknown as AutoVerifierRouter
  const deps: ProcessSelectorDeps = {
    settings: () => ({ active: true, smart: true, timeoutMs: 5000, maxItemChars: 20_000, maxInputChars: 60_000 }),
    policy: async () => ({ mode: 'smart' } as RouterPolicy),
    router: () => router,
    store: () => store,
    taskStatement: async () => 'Fix the failing parser test.',
    current: () => true,
    stream: () => streamOf(textChunks('alternative')),
    compare: async () => compareResult('A'),
    record: async report => { reports.push(report) },
    judges: () => 1,
    logger: { warn: message => warnings.push(message) },
    now: () => clock,
    diagnosticCycleId: () => 'diag-1',
    ...overrides,
  }
  return { selector: new ProcessSelector(deps), reports, warnings, store, reserved, get committed() { return committed }, get failed() { return failed }, advance(ms: number) { clock += ms } } as Harness
}

const AGENT = { id: 'agent-1', session: { header: { id: 'agent-1' } } }
function intent(overrides: Partial<ProcessIntent> = {}): ProcessIntent {
  return { sessionId: 'agent-1', agent: AGENT, taskStartSeq: 5, signal: 'sig', registeredAt: 1000, lastSeq: 42, ...overrides }
}
function markedRequest(sessionId = 'agent-1'): GenerateOptions {
  return markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: sessionId as never })
}
async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('candidate rendering', () => {
  it('keeps prose and tool-call actions and drops transport fields', () => {
    const rendered = renderCandidate([...textChunks('hello world'), ...toolCallChunks('call-1', 'pwsh', '{"command":"ls"}')])
    expect(rendered.text).toBe('hello world')
    expect(rendered.actions).toEqual(['pwsh({"command":"ls"})'])
  })

  it('treats a fresh call id as the same candidate', () => {
    // Two replies that differ only in the transport-level call id are the same plan: buying a
    // judge call to separate them cannot produce information.
    const first = renderCandidate(toolCallChunks('call-1', 'pwsh', '{"command":"ls"}'))
    const second = renderCandidate(toolCallChunks('call-2', 'pwsh', '{"command":"ls"}'))
    expect(candidateIdentity(first)).toBe(candidateIdentity(second))
    expect(candidateIdentity(renderCandidate(toolCallChunks('call-1', 'pwsh', '{"command":"pwd"}')))).not.toBe(candidateIdentity(first))
  })

  it('reports the finish kind of the LAST finish chunk', () => {
    expect(finishKind(textChunks('x'))).toBe('stop')
    expect(finishKind(toolCallChunks('c', 'pwsh', '{}'))).toBe('tool-calls')
    expect(finishKind(textChunks('x', 'error'))).toBe('error')
  })

  it('marks usage incomplete when a dispatch reported no usage at all', () => {
    expect(usageFromChunks(textChunks('x', 'stop', false)).usageIncomplete).toBe(true)
    expect(usageFromChunks(textChunks('x')).outputTokens).toBe(5)
    expect(usageFromChunks(textChunks('x')).calls).toBe(1)
  })

  it('bounds one candidate view to its budget without dropping the actions', () => {
    const candidate = { text: 'prose'.repeat(50), actions: ['pwsh({"command":"' + 'x'.repeat(200) + '"})'] }
    const view = renderCandidateView(candidate, 120)
    expect(view.length).toBe(120)
    expect(view).toContain('[tool-call] pwsh')
  })
})

describe('alternative request', () => {
  it('copies the call configuration but not the agent-loop marker or session id', () => {
    const original = markAgentLoopRequest({
      provider: 'p', model: 'm', messages: [] as never, sessionId: 's-1' as never,
      temperature: 0.7, maxTokens: 99, system: 'sys', stop: ['END'],
      tools: [{ name: 'pwsh' } as never],
    })
    const signal = new AbortController().signal
    const alternative = buildAlternativeRequest(original, signal)
    expect(alternative.provider).toBe('p')
    expect(alternative.model).toBe('m')
    expect(alternative.temperature).toBe(0.7)
    expect(alternative.maxTokens).toBe(99)
    expect(alternative.system).toBe('sys')
    expect(alternative.stop).toEqual(['END'])
    expect(alternative.tools).toEqual([{ name: 'pwsh' }])
    expect(alternative.signal).toBe(signal)
    // Neither the host marker nor the session id may travel with a plugin-dispatched request.
    expect(isAgentLoopRequest(original)).toBe(true)
    expect(isAgentLoopRequest(alternative)).toBe(false)
    expect(alternative.sessionId).toBeUndefined()
  })

  it('never mutates the frozen original request', () => {
    const original = markAgentLoopRequest(Object.freeze({ provider: 'p', model: 'm', messages: Object.freeze([]) as never }))
    buildAlternativeRequest(original, new AbortController().signal)
    expect(original.sessionId).toBeUndefined()
  })
})

describe('process cycle log', () => {
  it('records a purchase and reads it back as purchased', async () => {
    const file = tempPath()
    const store = new ProcessCycleStore(file)
    expect(await store.lookup('s', 5)).toEqual({ ok: true, purchased: false })
    expect(await store.begin({ cycleId: 'c1', sessionId: 's', taskStartSeq: 5, signal: 'sig', startedAt: 1 })).toBe(true)
    expect(await store.lookup('s', 5)).toEqual({ ok: true, purchased: true })
    // A different task of the same session is unaffected.
    expect((await store.lookup('s', 9)).purchased).toBe(false)
    await store.finish('c1', 'candidate-selected', 'candidate')
    const reopened = new ProcessCycleStore(file)
    expect((await reopened.lookup('s', 5)).purchased).toBe(true)
  })

  it('treats an unreadable log as unknown rather than as free', async () => {
    // A directory where the file should be: reading throws, and the caller must NOT buy.
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-process-dir-'))
    tempDirs.push(dir)
    const store = new ProcessCycleStore(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub'), 'not a directory')
    const lookup = await store.lookup('s', 5)
    expect(lookup.ok).toBe(false)
    expect(lookup.purchased).toBe(false)
    expect(await store.begin({ cycleId: 'c', sessionId: 's', taskStartSeq: 5, signal: 'x', startedAt: 1 })).toBe(false)
  })
})

describe('intent matching', () => {
  it('binds an intent only to a host main-loop request of the same session, once', () => {
    const { selector } = harness()
    selector.register(intent())
    expect(selector.take({ provider: 'p', model: 'm', messages: [] })).toBeUndefined()
    expect(selector.take(markedRequest('other-session'))).toBeUndefined()
    expect(selector.pending('agent-1')).toBe(true)
    const matched = selector.take(markedRequest())
    expect(matched?.signal).toBe('sig')
    // Consumed: one intent, one request.
    expect(selector.pending('agent-1')).toBe(false)
    expect(selector.take(markedRequest())).toBeUndefined()
  })

  it('keeps an auxiliar dispatch from the plugin itself out of the waterfall', () => {
    const { selector } = harness()
    selector.register(intent())
    const own = { provider: 'p', model: 'm', messages: [] } as Record<string, unknown>
    // Same shape, but the plugin registered it as its own: never a selection subject.
    expect(selector.take(own as never)).toBeUndefined()
    expect(selector.take(markedRequest())).toBeDefined()
  })

  it('drops an expired intent and one whose task changed', () => {
    const expired = harness()
    expired.selector.register(intent())
    expired.advance(PROCESS_INTENT_TTL_MS + 1)
    expect(expired.selector.take(markedRequest())).toBeUndefined()
    expect(expired.warnings.some(w => w.includes('expired'))).toBe(true)

    const moved = harness({ current: () => false })
    moved.selector.register(intent())
    expect(moved.selector.take(markedRequest())).toBeUndefined()
    expect(moved.warnings.some(w => w.includes('current task'))).toBe(true)
  })

  it('does nothing while the switch or the mode is wrong', () => {
    const off = harness({ settings: () => ({ active: false, smart: true, timeoutMs: 1, maxItemChars: 1, maxInputChars: 1 }) })
    off.selector.register(intent())
    expect(off.selector.take(markedRequest())).toBeUndefined()
    const strict = harness({ settings: () => ({ active: true, smart: false, timeoutMs: 1, maxItemChars: 1, maxInputChars: 1 }) })
    strict.selector.register(intent())
    expect(strict.selector.take(markedRequest())).toBeUndefined()
  })
})

describe('process cycle execution', () => {
  const run = async (h: Harness, input: { original: StreamChunk[]; next?: () => AsyncIterable<StreamChunk> }) => {
    const chunks = await collect(h.selector.handle(markedRequest(), input.next ?? (() => streamOf(input.original)), intent()))
    return { chunks, report: h.reports[h.reports.length - 1] }
  }

  it('replays the generated alternative when the judge picks B', async () => {
    const alternative = textChunks('ALTERNATIVE-PLAN')
    const h = harness({ stream: () => streamOf(alternative), compare: async () => compareResult('B') })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(alternative)
    expect(report?.outcome).toBe('candidate-selected')
    expect(report?.replayed).toBe('candidate')
    expect(report?.generatedCalls).toBe(1)
    expect(report?.judgeCalls).toBe(6)
    // A selection is not an acceptance: the cycle commits and arms the ordinary final gate.
    expect(h.committed).toBe(1)
    expect(report?.observation.replayed).toBe('candidate')
  })

  it('replays the original verbatim on a tie, on an A win, and records which', async () => {
    for (const winner of ['A', 'tie'] as const) {
      const original = textChunks('ORIGINAL')
      const h = harness({ compare: async () => compareResult(winner) })
      const { chunks, report } = await run(h, { original })
      expect(chunks).toEqual(original)
      expect(report?.replayed).toBe('original')
      expect(report?.outcome).toBe(winner === 'tie' ? 'tie' : 'original-selected')
    }
  })

  it('skips the judge entirely for an identical candidate and says so', async () => {
    let comparisons = 0
    const h = harness({
      stream: () => streamOf(toolCallChunks('call-2', 'pwsh', '{"command":"ls"}')),
      compare: async () => { comparisons += 1; return compareResult('B') },
    })
    const { chunks, report } = await run(h, { original: toolCallChunks('call-1', 'pwsh', '{"command":"ls"}') })
    expect(comparisons).toBe(0)
    expect(report?.outcome).toBe('identical-candidate')
    expect(report?.sameCandidate).toBe(true)
    expect(chunks).toEqual(toolCallChunks('call-1', 'pwsh', '{"command":"ls"}'))
  })

  it('keeps the host failure semantics when the original did not finish normally', async () => {
    const original = textChunks('partial', 'error')
    const h = harness()
    const { chunks, report } = await run(h, { original })
    expect(chunks).toEqual(original)
    expect(report?.outcome).toBe('original-incomplete')
    expect(report?.purchased).toBe(false)
    expect(h.reserved).toHaveLength(0)
  })

  it('passes the original through untouched once it exceeds the buffer cap', async () => {
    // Two chunks over the cap, then a tail that must arrive in order without a second replay.
    const original: StreamChunk[] = []
    const big = 'x'.repeat(PROCESS_CANDIDATE_CAP_CHARS)
    original.push({ type: 'text-delta', index: 0, text: big })
    original.push({ type: 'text-delta', index: 0, text: 'TAIL' })
    original.push({ type: 'finish', reason: { kind: 'stop' } } as StreamChunk)
    let streamed = false
    const h = harness({ stream: () => { streamed = true; return streamOf(textChunks('alternative')) } })
    const { chunks, report } = await run(h, { original })
    expect(chunks).toEqual(original)
    expect(streamed).toBe(false)
    expect(report?.outcome).toBe('original-over-cap')
    expect(h.reserved).toHaveLength(0)
  })

  it('discards an overflowing alternative and replays the original', async () => {
    const huge = textChunks('y'.repeat(PROCESS_CANDIDATE_CAP_CHARS + 10))
    const h = harness({ stream: () => streamOf(huge) })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('alternative-incomplete')
    expect(h.failed).toBe(1)
  })

  it('falls back to the original when the extra generation throws', async () => {
    const h = harness({ stream: () => (async function* () { throw new Error('generation exploded') })() })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('generation-failed')
    expect(report?.error).toContain('generation exploded')
    expect(h.failed).toBe(1)
  })

  it('does not buy anything when the cycle log cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-process-unwritable-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'sub'), 'not a directory')
    let generated = false
    const h = harness({ store: () => new ProcessCycleStore(join(dir, 'sub')), stream: () => { generated = true; return streamOf(textChunks('x')) } })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(generated).toBe(false)
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('store-unavailable')
    // The reservation was granted (and is released again), but not one added model call happened.
    expect(report?.generatedCalls).toBe(0)
    expect(h.failed).toBe(1)
  })

  it('passes through without added calls when the budget refuses the cycle', async () => {
    const h = harness({ router: () => ({ reserve: () => undefined, commit: () => true, fail: () => {} }) as unknown as AutoVerifierRouter })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.purchased).toBe(false)
    expect(report?.outcome).toBe('no-process-budget')
    expect(report?.replayed).toBe('none')
  })

  it('replays the original and reports cancellation when the phase is aborted', async () => {
    const controller = new AbortController()
    const options = markedRequest()
    options.signal = controller.signal
    const h = harness({
      compare: async () => { controller.abort(new Error('cancelled')); return compareResult('B') },
    })
    const chunks = await collect(h.selector.handle(options, () => streamOf(textChunks('ORIGINAL')), intent()))
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(h.reports[h.reports.length - 1]?.outcome).toBe('canceled')
    expect(h.failed).toBe(1)
  })

  it('carries the generation and judge usage into one cycle report', async () => {
    const h = harness({ compare: async () => compareResult('A') })
    const { report } = await run(h, { original: textChunks('ORIGINAL') })
    // 10 input / 5 output from the alternative plus the judge run's own usage.
    expect(report?.usage.calls).toBe(1 + 6)
    expect(report?.usage.inputTokens).toBeGreaterThan(0)
    expect(report?.usage.cacheMisses).toBe(6)
    expect(report?.observation.generatedCalls).toBe(1)
    expect(report?.observation.judgeCalls).toBe(6)
  })

  it('bills the cap boundary exactly: a candidate at the cap is still usable', async () => {
    // Boundary: the cap is a limit, not a threshold to stay below.
    const boundary = textChunks('z'.repeat(PROCESS_CANDIDATE_CAP_CHARS - 10))
    const h = harness({ stream: () => streamOf(boundary), compare: async () => compareResult('B') })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(report?.outcome).toBe('candidate-selected')
    expect(chunks).toEqual(boundary)
    expect(report?.generatedCalls).toBe(1)
  })
})

describe('chunk measurement', () => {
  it('counts only payload characters', () => {
    expect(measureChunk({ type: 'text-delta', index: 0, text: 'abcd' })).toBe(4)
    expect(measureChunk({ type: 'tool-call-delta', index: 0, id: 'c' as never, argumentsDelta: 'ab' })).toBe(2)
    expect(measureChunk({ type: 'usage', usage: { inputTokens: 1000, outputTokens: 1000 } })).toBe(0)
  })
})
