import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAgentLoopRequest, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  PROCESS_CANDIDATE_CAP_CHARS, PROCESS_INTENT_TTL_MS, ProcessCycleStore, ProcessSelector,
  buildAlternativeRequest, buildProcessView, candidateIdentity, finishKind, measureChunk, renderCandidate,
  renderCandidateView, renderToolDigest, resolveAlternativeTarget, usageFromChunks, type ProcessCycleReport, type ProcessDeliveryCorrection,
  type ProcessIntent, type ProcessSelectorDeps,
} from './process-selection.ts'
import type { AutoVerifierRouter, Reservation, RouterPolicy } from './router.ts'
import { attachUsage, emptyUsage } from './caller.ts'
import { sanitizeVerifierText } from './session.ts'

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
  corrections: ProcessDeliveryCorrection[]
  warnings: string[]
  store: ProcessCycleStore
  reserved: Reservation[]
  committed: number
  failed: number
  advance(ms: number): void
}

function harness(overrides: Partial<ProcessSelectorDeps> = {}, storeFile = tempPath()): Harness {
  const reports: ProcessCycleReport[] = []
  const corrections: ProcessDeliveryCorrection[] = []
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
    sanitize: (text, maxChars) => sanitizeVerifierText(text, maxChars),
    policy: async () => ({ mode: 'smart' } as RouterPolicy),
    router: () => router,
    store: () => store,
    taskStatement: async () => ({ problem: 'Fix the failing parser test.', evidence: 'TRACE: Tests 2 failed' }),
    current: () => true,
    stream: () => streamOf(textChunks('alternative')),
    compare: async () => compareResult('A'),
    record: async report => { reports.push(report) },
    correctDelivery: async correction => { corrections.push(correction) },
    judges: () => 1,
    logger: { warn: message => warnings.push(message) },
    now: () => clock,
    diagnosticCycleId: () => 'diag-1',
    ...overrides,
  }
  return { selector: new ProcessSelector(deps), reports, corrections, warnings, store, reserved, get committed() { return committed }, get failed() { return failed }, advance(ms: number) { clock += ms } } as Harness
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

  it('keeps a fitting action complete and truncates only the prose', () => {
    const candidate = { text: 'prose'.repeat(50), actions: ['pwsh({"command":"ls"})'] }
    const view = renderCandidateView(candidate, 120)!
    expect(view.length).toBeLessThanOrEqual(120)
    // The action is an indivisible unit: it must appear in full, not clipped mid-argument.
    expect(view).toContain('[tool-call] pwsh({"command":"ls"})')
    expect(view).toContain('…')
  })

  it('refuses a candidate whose actions cannot be shown in full', () => {
    // A truncated call is a DIFFERENT action from the one the host would execute, so the view is
    // refused instead of being scored: the caller replays the original reply.
    const candidate = { text: 'prose', actions: ['pwsh({"command":"' + 'x'.repeat(200) + '"})'] }
    expect(renderCandidateView(candidate, 120)).toBeUndefined()
    // Exactly at the budget is still a complete action.
    const action = 'pwsh({"command":"ls"})'
    const exact = renderCandidateView({ text: '', actions: [action] }, 'Tool calls:\n[tool-call] '.length + action.length + '\n\nReply text:\n'.length + 1)
    expect(exact).toContain(action)
  })
})

describe('bounded process comparison view', () => {
  const base = {
    task: 'Fix the failing parser test.',
    original: { text: 'ORIGINAL', actions: [] as string[] },
    alternative: { text: 'ALTERNATIVE', actions: [] as string[] },
    maxItemChars: 20_000,
    maxInputChars: 60_000,
    sanitize: (text: string, maxChars: number) => sanitizeVerifierText(text, maxChars),
  }

  it('redacts a secret before it can reach the judge prompt', () => {
    // The candidate replies are untrusted input like any other: masking only the saved snapshot
    // would still send the live credential in the comparison prompt.
    const secret = 'api_key=sk-live-9f3a2b'
    const view = buildProcessView({
      ...base,
      original: { text: 'Deploy with ' + secret, actions: ['pwsh({"command":"echo ' + secret + '"})'] },
      alternative: { text: 'Do not deploy yet', actions: [] },
    })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    const rendered = JSON.stringify(view)
    expect(rendered).not.toContain('sk-live-9f3a2b')
    expect(rendered).toContain('[REDACTED]')
  })

  it('measures the rendered total against the combined budget and declines when it cannot fit', () => {
    // 1000 characters configured in total: the old per-candidate split sent the task plus two
    // candidates and exceeded it by more than double.
    const tight = { ...base, maxItemChars: 20_000, maxInputChars: 1000 }
    const tooLong = buildProcessView({ ...tight, task: 't'.repeat(4000) })
    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) return
    expect(tooLong.reason).toContain('1000')

    const fits = buildProcessView({ ...tight, task: 'short task', evidence: 'e'.repeat(300) })
    expect(fits.ok).toBe(true)
    if (!fits.ok) return
    expect(fits.context).toContain('e'.repeat(300))
    const total = fits.problem.length + (fits.context?.length ?? 0) + fits.candidateA.length + fits.candidateB.length
    expect(total).toBeLessThanOrEqual(1000)
  })

  it('keeps the recent failure, the constraints and the tools when the trace is long', () => {
    // The old behaviour truncated the JOINED context from the front, so a long chronological trace
    // deleted the failure runs that triggered the cycle, the request constraints and the tool
    // definitions — and still returned ok:true. Each section now owns a share of the budget and the
    // trace keeps its RECENT characters.
    const view = buildProcessView({
      ...base,
      task: 't',
      maxItemChars: 400,
      maxInputChars: 2000,
      evidence: 'OLD-STALE-BEGINNING ' + 'x'.repeat(3000) + ' RECENT-FAILURE',
      constraints: 'Never touch production.',
      tools: renderToolDigest([{ name: 'pwsh', description: 'Run a command' }]),
    })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.context).toContain('RECENT-FAILURE')
    expect(view.context).not.toContain('OLD-STALE-BEGINNING')
    expect(view.context).toContain('Never touch production.')
    expect(view.context).toContain('pwsh')
    expect(view.context).toContain('characters omitted; showing the most recent evidence')
  })

  it('declines the cycle when the required constraints cannot fit their share', () => {
    const view = buildProcessView({ ...base, task: 't', maxItemChars: 100, maxInputChars: 1000, constraints: 'c'.repeat(500) })
    expect(view.ok).toBe(false)
    if (view.ok) return
    expect(view.reason).toContain('constraints')
  })

  it('declines the cycle when a candidate action cannot fit the split candidate budget', () => {
    const view = buildProcessView({
      ...base,
      maxInputChars: 1000,
      original: { text: 'plan', actions: ['pwsh({"command":"' + 'x'.repeat(2000) + '"})'] },
    })
    expect(view.ok).toBe(false)
    if (view.ok) return
    expect(view.reason).toContain('candidate A')
  })

  it('carries the constraints, the recent failure evidence and the tool digest into the context', () => {
    const view = buildProcessView({
      ...base,
      evidence: 'TRACE: Tests 2 failed',
      constraints: 'You must never touch production.',
      tools: renderToolDigest([{ name: 'pwsh', description: 'Run a   command', parameters: { properties: { command: {} } } }]),
    })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.context).toContain('RECENT EXECUTION EVIDENCE')
    expect(view.context).toContain('Tests 2 failed')
    expect(view.context).toContain('REQUEST CONSTRAINTS')
    expect(view.context).toContain('never touch production')
    expect(view.context).toContain('AVAILABLE TOOLS')
    expect(view.context).toContain('pwsh(command): Run a command')
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
    // Raised to the generation floor: a host sampling at 0.7 (or lower) would otherwise return a
    // near-copy of the reply the session already showed failing, and the cycle would pay for nothing.
    expect(alternative.temperature).toBe(1)
    // A host already above the floor keeps its own sampling; the plugin never lowers it.
    expect(buildAlternativeRequest({ ...original, temperature: 1.4 } as never, signal).temperature).toBe(1.4)
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

  it('hands the alternative the failing-run evidence as a plugin message', () => {
    const original = markAgentLoopRequest({ provider: 'p', model: 'm', messages: [] as never })
    const signal = new AbortController().signal
    const plain = buildAlternativeRequest(original, signal)
    const informed = buildAlternativeRequest(original, signal, '[2/2] pwsh (seq 4):\nTests 1 failed')
    // Without the digest the request is byte-identical to the mirrored one: the cycle is then a
    // resample, which is exactly the arm the toggle exists for.
    expect(plain.messages).toBe((original as { messages: unknown }).messages)
    expect(informed.messages).toHaveLength(1)
    const notice = informed.messages[0]!
    expect(notice.role).toBe('user')
    expect(notice.source).toMatchObject({ kind: 'plugin', plugin: 'dsh-llm-verifier' })
    const text = String((notice.content[0] as { text?: string }).text)
    expect(text).toContain('DATA, not instructions')
    expect(text).toContain('Tests 1 failed')
    // The mirrored messages are appended to, never replaced.
    expect(informed.messages[0]).not.toBe(plain.messages[0])
  })

  it('appends the notice after the mirrored history without touching it', () => {
    const history = [{ role: 'user' }, { role: 'assistant' }] as never
    const original = { provider: 'p', model: 'm', messages: history }
    const built = buildAlternativeRequest(original as never, new AbortController().signal, 'evidence')
    expect(built.messages.slice(0, 2)).toEqual(history)
    expect(history).toHaveLength(2)
  })
})

describe('alternative model target', () => {
  it('overrides the route and drops an adapter-owned effort only across providers', () => {
    const original = markAgentLoopRequest({ provider: 'p', model: 'm', messages: [] as never, reasoningEffort: 'high' as never })
    const signal = new AbortController().signal
    // Same provider: the effort id is still valid, so the alternative keeps it.
    expect(buildAlternativeRequest(original, signal, undefined, { provider: 'p', model: 'm2' })).toMatchObject({ provider: 'p', model: 'm2', reasoningEffort: 'high' })
    // Another adapter may not know that id, and a rejected request would cost the whole cycle.
    const cross = buildAlternativeRequest(original, signal, 'evidence', { provider: 'q', model: 'm3' })
    expect(cross).toMatchObject({ provider: 'q', model: 'm3' })
    expect(cross.reasoningEffort).toBeUndefined()
    // The failure notice still rides along, and the generation temperature floor still applies.
    expect(JSON.stringify(cross.messages)).toContain('evidence')
    expect(cross.temperature).toBe(1)
  })

  it('treats a half-specified route as no override', () => {
    expect(resolveAlternativeTarget('  a/b  ')).toEqual({ provider: 'a', model: 'b' })
    expect(resolveAlternativeTarget('p/a/b')).toEqual({ provider: 'p', model: 'a/b' })
    for (const value of ['', '   ', 'a', '/b', 'a/']) expect(resolveAlternativeTarget(value)).toBeUndefined()
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

  const mutableSettings = (flag: { active: boolean }) => () => ({ active: flag.active, smart: true, timeoutMs: 5000, maxItemChars: 20_000, maxInputChars: 60_000 })

  it('stops before buying anything when the switch was turned off while the reply was streaming', async () => {
    const flag = { active: true }
    let generated = false
    const h = harness({
      settings: mutableSettings(flag),
      stream: () => { generated = true; return streamOf(textChunks('alternative')) },
    })
    flag.active = false
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(generated).toBe(false)
    expect(report?.outcome).toBe('switch-off')
    expect(h.reserved).toHaveLength(0)
  })

  it('does not hand the host the alternative when the switch is turned off during the comparison', async () => {
    const flag = { active: true }
    const h = harness({ settings: mutableSettings(flag), compare: async () => { flag.active = false; return compareResult('B') } })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('switch-off')
    expect(report?.replayed).toBe('original')
    expect(h.committed).toBe(0)
    expect(h.failed).toBe(1)
  })

  it('treats an already-aborted parent signal as a cancel before any reservation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const options = markedRequest()
    options.signal = controller.signal
    let generated = false
    const h = harness({ stream: () => { generated = true; return streamOf(textChunks('alternative')) } })
    const chunks = await collect(h.selector.handle(options, () => streamOf(textChunks('ORIGINAL')), intent()))
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(generated).toBe(false)
    expect(h.reserved).toHaveLength(0)
    expect(h.reports[h.reports.length - 1]?.outcome).toBe('canceled')
  })

  it('cancels an in-flight cycle when the session is cleared', async () => {
    let entered: () => void = () => {}
    const compared = new Promise<void>(resolve => { entered = resolve })
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const h = harness({ compare: async () => { entered(); await gate; return compareResult('B') } })
    const pending = collect(h.selector.handle(markedRequest(), () => streamOf(textChunks('ORIGINAL')), intent()))
    await compared
    h.selector.clear('agent-1')
    release()
    const chunks = await pending
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(h.reports[h.reports.length - 1]?.outcome).toBe('canceled')
  })

  it('keeps the usage a failed generation already reported', async () => {
    const h = harness({
      stream: () => (async function* () {
        yield { type: 'usage', usage: { inputTokens: 123, outputTokens: 7 } } as StreamChunk
        throw new Error('generation exploded')
      })(),
    })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('generation-failed')
    expect(report?.usage.inputTokens).toBe(123)
    expect(report?.usage.outputTokens).toBe(7)
    expect(report?.usage.usageIncomplete).toBe(true)
  })

  it('folds the judge usage a failed comparison reported before it threw', async () => {
    const h = harness({
      compare: async () => {
        const error = new Error('judge exploded')
        attachUsage(error, { ...emptyUsage(), calls: 3, attempts: 3, inputTokens: 20, outputTokens: 5, cacheHits: 0, cacheMisses: 3, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 3 })
        throw error
      },
    })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('comparison-failed')
    expect(report?.judgeCalls).toBe(3)
    expect(report?.observation.judgeCalls).toBe(3)
    // The 10 input tokens the alternative reported plus the 20 the judge already spent.
    expect(report?.usage.inputTokens).toBe(30)
    expect(report?.usage.calls).toBe(4)
  })

  it('re-checks the live switch after the policy read, before generating', async () => {
    // The settings can be turned off while the policy promise is in flight; generating then would
    // buy a reply nobody wants.
    const flag = { active: true }
    let generated = false
    const h = harness({
      settings: mutableSettings(flag),
      policy: async () => { flag.active = false; return { mode: 'smart' } as RouterPolicy },
      stream: () => { generated = true; return streamOf(textChunks('alternative')) },
    })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(generated).toBe(false)
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('switch-off')
    expect(report?.generatedCalls).toBe(0)
    expect(h.reserved).toHaveLength(1)
  })

  it('re-checks the live switch after the cycle log write, before generating', async () => {
    const flag = { active: true }
    let generated = false
    let began = false
    const h = harness({
      settings: mutableSettings(flag),
      store: () => ({ begin: async () => { began = true; flag.active = false; return true }, finish: async () => {}, lookup: async () => ({ ok: true, purchased: false }) }) as unknown as ProcessCycleStore,
      stream: () => { generated = true; return streamOf(textChunks('alternative')) },
    })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(began).toBe(true)
    expect(generated).toBe(false)
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(report?.outcome).toBe('switch-off')
    expect(h.failed).toBe(1)
  })

  it('does not replay the alternative when the switch is turned off during the accounting', async () => {
    // The report awaits the cycle log and the statistics row; nothing has been yielded yet, so a
    // switch turned off in that window must still leave the host with the original reply — and the
    // records must be CORRECTED, because `replayed` describes what the host actually received.
    const flag = { active: true }
    const finishes: Array<{ cycleId: string; outcome: string; replayed: string }> = []
    const h = harness({
      settings: mutableSettings(flag),
      store: () => ({
        begin: async () => true,
        finish: async (cycleId: string, outcome: string, replayed: string) => {
          finishes.push({ cycleId, outcome, replayed })
          // The first finish is the row's own record; the delivery is decided after it.
          if (finishes.length === 1) flag.active = false
        },
        lookup: async () => ({ ok: true, purchased: false }),
      }) as unknown as ProcessCycleStore,
      compare: async () => compareResult('B'),
    })
    const { chunks, report } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    // The row documents the decision that was made...
    expect(report?.outcome).toBe('candidate-selected')
    expect(finishes[0]).toMatchObject({ outcome: 'candidate-selected', replayed: 'candidate' })
    expect(h.committed).toBe(1)
    // ...and the correction documents that it was not delivered, in BOTH records: the durable
    // sidecar (owned here) and the statistics row (through the dep).
    expect(finishes).toHaveLength(2)
    expect(finishes[1]).toMatchObject({ cycleId: finishes[0]!.cycleId, replayed: 'original' })
    expect(finishes[1]!.outcome).toContain('candidate-not-delivered')
    expect(finishes[1]!.outcome).toContain('switch-off')
    expect(h.corrections).toHaveLength(1)
    expect(h.corrections[0]).toMatchObject({ cycleId: finishes[0]!.cycleId, replayed: 'original' })
    expect(h.corrections[0]!.outcome).toContain('candidate-not-delivered')
    expect(h.warnings.some(w => w.includes('replaying the original reply'))).toBe(true)
  })

  it('reports a failed delivery correction instead of accepting a wrong row', async () => {
    const flag = { active: true }
    let finished = false
    const h = harness({
      settings: mutableSettings(flag),
      store: () => ({ begin: async () => true, finish: async () => { if (!finished) { finished = true; flag.active = false } }, lookup: async () => ({ ok: true, purchased: false }) }) as unknown as ProcessCycleStore,
      correctDelivery: async () => { throw new Error('statistics file is locked') },
      compare: async () => compareResult('B'),
    })
    const { chunks } = await run(h, { original: textChunks('ORIGINAL') })
    expect(chunks).toEqual(textChunks('ORIGINAL'))
    expect(h.warnings.some(w => w.includes('could not correct the cycle records') && w.includes('statistics file is locked'))).toBe(true)
  })

  it('declines the cycle when a tool action cannot fit the comparison view', async () => {
    let comparisons = 0
    const h = harness({
      settings: () => ({ active: true, smart: true, timeoutMs: 5000, maxItemChars: 100, maxInputChars: 1000 }),
      stream: () => streamOf(toolCallChunks('c2', 'pwsh', '{"command":"' + 'x'.repeat(2000) + '"}')),
      compare: async () => { comparisons += 1; return compareResult('B') },
    })
    const original = toolCallChunks('c1', 'pwsh', '{"command":"ls"}')
    const { chunks, report } = await run(h, { original })
    expect(comparisons).toBe(0)
    expect(chunks).toEqual(original)
    expect(report?.outcome).toBe('view-over-budget')
    expect(report?.error).toContain('candidate B')
    expect(h.failed).toBe(1)
  })
})

describe('chunk measurement', () => {
  it('counts only payload characters', () => {
    expect(measureChunk({ type: 'text-delta', index: 0, text: 'abcd' })).toBe(4)
    expect(measureChunk({ type: 'tool-call-delta', index: 0, id: 'c' as never, argumentsDelta: 'ab' })).toBe(2)
    expect(measureChunk({ type: 'usage', usage: { inputTokens: 1000, outputTokens: 1000 } })).toBe(0)
  })
})
