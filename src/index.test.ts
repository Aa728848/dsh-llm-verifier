import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from './index.ts'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { partialStats } from './engine.ts'
import { PROPOSAL_CRITERIA } from './core.ts'

const tempDirs: string[] = []
function tempDir(): string { const dir = mkdtempSync(join(tmpdir(), 'dsh-verifier-assembly-')); tempDirs.push(dir); return dir }
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * Assembly-level contract for the four registered tools.
 *
 * Deliberately narrow: it exercises registration and the argument caps that must
 * reject a model-driven call BEFORE any model/topic work happens, both of which
 * were previously uncovered (every other module has a sibling spec).
 */
function assemble(config: Record<string, unknown> = {}, options: { root?: string; initiator?: unknown; sessions?: unknown[]; stream?: (options: { messages: readonly unknown[] }) => AsyncIterable<unknown> } = {}) {
  const tools = new Map<string, { output: { schema: { properties: Record<string, unknown> } }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const warnings: string[] = []
  const rpc = new Map<string, (endpoint: string, payload: unknown) => unknown>()
  // The lifecycle hooks are the highest-risk wiring in the plugin and `on() {}` never ran
  // them. Capturing the callbacks lets a focused test drive the real turn-stopping gate.
  const handlers = new Map<string, (payload: unknown, next?: () => unknown) => unknown>()
  const ctx = {
    inject() {}, on(name: string, handler: (payload: unknown, next?: () => unknown) => unknown) { handlers.set(name, handler) }, effect() {},
    get() { return undefined },
    logger: { warn(value: unknown) { warnings.push(String(value)) }, info() {}, error() {}, debug() {} },
    tools: { register(definition: never) { tools.set((definition as unknown as { name: string }).name, definition as never) } },
    agents: { currentInitiator() { return options.initiator } },
    llm: { resolveCallConfig: async () => ({}), ...(options.stream === undefined ? {} : { stream: options.stream }) },
    attachments: {},
    sessionPersistence: { root: options.root ?? tempDir(), list: async () => options.sessions ?? [] },
    // Older hosts answer statistics over the plugin RPC channel; capturing the handler
    // lets the payload contract be tested without any host I/O.
    connection: { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown) => unknown) { rpc.set(channel, handler) } } },
  } as unknown as Context
  apply(ctx, config as never)
  return { tools, warnings, rpc, handlers }
}

/** A session whose model is already logged: the normal case for best-of-N. */
const exec = { agent: { id: 'agent-1', session: { header: { id: 'session-1' }, requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model', reasoningEffort: 'high' } }) } }, signal: new AbortController().signal }
/** A session with no logged request header: the tool cannot know which model should draft. */
const bareExec = { agent: { id: 'agent-2', session: { header: { id: 'session-2' }, requestHeader: () => undefined } }, signal: new AbortController().signal }

describe('plugin assembly', () => {
  it('registers exactly the four verifier tools with ensemble-aware output schemas', () => {
    const { tools } = assemble()
    expect([...tools.keys()].sort()).toEqual(['verifier_best_of_n', 'verifier_compare', 'verifier_current_session', 'verifier_select', 'verifier_track'])
    for (const [name, definition] of tools) {
      expect(definition.output.schema.properties.judges, name + ' must report the judge ensemble').toBeDefined()
    }
    for (const name of ['verifier_compare', 'verifier_current_session']) {
      expect(tools.get(name)!.output.schema.properties.agreement, name + ' must report judge agreement').toBeDefined()
    }
  })

  it('answers the chat chip\'s process query from memory, and only with a session', async () => {
    // The client dock polls this while a cycle buffers the reply. It must be a pure read: no sidecar,
    // no model call, and an explicit refusal when the caller forgot which session it means.
    const { rpc } = assemble()
    const handler = rpc.get('/llm-verifier')!
    expect(await handler('process', {})).toMatchObject({ ok: false, error: { message: expect.stringMatching(/sessionId is required/) } })
    expect(await handler('process', undefined)).toMatchObject({ ok: false })
    // A session that never bought a cycle answers with nothing to render, not an error.
    expect(await handler('process', { sessionId: 'session-1' })).toEqual({ ok: true, value: { sessionId: 'session-1' } })
  })

  it('rejects out-of-range explicit evidence before any model call', async () => {
    const { tools } = assemble()
    const session = tools.get('verifier_current_session')!
    // Above the shared explicit-repeat ceiling (MAX_EXPLICIT_REPEATS).
    await expect(session.execute({ repeats: 9 }, exec)).rejects.toThrow(/repeats must be at most 8/)
    // Above MAX_SESSION_CHARS.
    await expect(session.execute({ max_chars: 2_000_001 }, exec)).rejects.toThrow(/max_chars must be at most 2000000/)
    // A non-positive repeat count is rejected too.
    await expect(session.execute({ repeats: 0 }, exec)).rejects.toThrow(/repeats must be a positive integer/)
  })

  it('rejects a malformed statistics range instead of answering an empty success', async () => {
    const { rpc } = assemble()
    const handler = rpc.get('/llm-verifier')
    expect(handler).toBeDefined()
    // Regression: a NaN range used to be swallowed by the per-topic allSettled fan-out
    // and returned as ok with a NaN range, so the caller saw "success, no data".
    expect(await handler!('statistics', { fromMs: Number.NaN, toMs: Number.NaN })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await handler!('statistics', { fromMs: 10, toMs: 5 })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/finite and increasing/) } })
    expect(await handler!('statistics', 'not-an-object')).toMatchObject({ ok: false, error: { message: expect.stringMatching(/must be an object/) } })
    expect(await handler!('other', {})).toMatchObject({ ok: false, error: { message: expect.stringMatching(/unknown llm-verifier endpoint/) } })
  })

  it('runs the judge probe from the global dashboard, attaching to the newest topic when there is no initiator', async () => {
    // The dashboard is a global page: no current initiator, and possibly no session at all. The
    // probe must explain what it needs instead of leaking a message about topic deletion.
    const empty = assemble()
    expect(await empty.rpc.get('/llm-verifier')!('probe', undefined)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/needs one session/) } })

    // With topics it runs for real against the NEWEST one. The stub has no llm.stream, so the
    // single judge must come back as a REPORTED failure — not a crash, not a silent success.
    const { rpc } = assemble({}, { sessions: [{ id: 'older', createdAt: 1 }, { id: 'newest', createdAt: 2 }] })
    const outcome = await rpc.get('/llm-verifier')!('probe', undefined) as { ok: boolean; value: { judges: Array<Record<string, unknown>>; rubric: Record<string, unknown>; channelProbed?: boolean } }
    expect(outcome.ok).toBe(true)
    expect(outcome.value.channelProbed).toBe(true)
    expect(outcome.value.rubric).toMatchObject({ source: 'coding', count: 3 })
    expect(outcome.value.judges).toHaveLength(1)
    expect(outcome.value.judges[0]).toMatchObject({ ok: false })

    // A current initiator still wins over the fallback.
    const withAgent = assemble({}, { sessions: [{ id: 'other', createdAt: 1 }], initiator: exec.agent })
    expect((await withAgent.rpc.get('/llm-verifier')!('probe', undefined) as { ok: boolean }).ok).toBe(true)
  })

  it('resolves the configured rubric through the probe, and degrades a broken custom file instead of failing', async () => {
    const research = assemble({ criteriaPreset: 'research' }, { initiator: exec.agent })
    const researched = await research.rpc.get('/llm-verifier')!('probe', undefined) as { value: { rubric: Record<string, unknown> } }
    expect(researched.value.rubric).toMatchObject({ source: 'research', count: 3 })

    // A custom file that does not exist must fall back to coding WITH the reason, not throw.
    const missing = assemble({ criteriaPreset: 'custom', criteriaFile: join(tempDir(), 'nope.md') }, { initiator: exec.agent })
    const degraded = await missing.rpc.get('/llm-verifier')!('probe', undefined) as { ok: boolean; value: { rubric: Record<string, unknown> } }
    expect(degraded.ok).toBe(true)
    expect(degraded.value.rubric).toMatchObject({ source: 'fallback', count: 3 })
    expect(String(degraded.value.rubric.error)).toMatch(/ENOENT|no such file/u)

    // A real file is parsed, and its note and criteria reach the probe. The stub judge then fails,
    // but only AFTER the rubric was resolved — which is what this asserts.
    const file = join(tempDir(), 'rubric.md')
    writeFileSync(file, '# Rubric\n\n## Criteria\n\n### Only One\n\nScore the only criterion.\n')
    const custom = assemble({ criteriaPreset: 'custom', criteriaFile: file }, { initiator: exec.agent })
    const parsed = await custom.rpc.get('/llm-verifier')!('probe', undefined) as { value: { rubric: Record<string, unknown> } }
    expect(parsed.value.rubric).toMatchObject({ source: 'custom', count: 1 })
  })

  it('rejects an explicit selection that pivots and judges push past the call ceiling', async () => {
    // Regression: the guard assumed exactly two pivots and ignored the judge multiplier,
    // so 16 candidates with 16 pivots passed a 252-call estimate and then issued 816.
    const { tools } = assemble(JUDGE)
    const execute = tools.get('verifier_select')!.execute
    const candidates = Array.from({ length: 16 }, (_, index) => 'candidate ' + index)
    await expect(execute({ problem: 'pick one', candidates, pivots: 16, repeats: 2 }, exec)).rejects.toThrow(/judge calls/u)
  })

  it('survives an unavailable settings service and an unregistered connection', () => {
    const { tools, warnings } = assemble()
    expect(tools.size).toBe(5)
    expect(warnings).toEqual([])
  })
})

/** Minimal text stream in the shape BlockAssembler consumes. */
function textStream(text: string, kind: 'stop' | 'max-tokens' = 'stop') {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind } }
  })()
}

/** The one draft the scripted judges reward, and the two they do not. */
const STRONG_DRAFT = 'The fix is in place. COMPLETE-AND-VERIFIED: ran the test suite, output 42 passed.'
const WEAK_DRAFT = 'I edited the file. It should work now.'
const BASELINE = '(No useful work or verification was performed.)'

/** Concatenated text of every text block in one request. */
function promptText(options: { messages: readonly unknown[] }): string {
  return (options.messages as readonly { content?: readonly { type?: string; text?: string }[] }[])
    .flatMap(message => message.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function section(prompt: string, tag: string): string {
  return new RegExp('<<<' + tag + ':[^>]*>>>\\n([\\s\\S]*?)\\n<<<END_' + tag + ':').exec(prompt)?.[1] ?? ''
}

/** A-T is success quality, so A is the winning letter and T is the empty-work baseline. */
function verdictLetter(block: string): string {
  return block.includes('COMPLETE-AND-VERIFIED') ? 'A' : block.includes(BASELINE) ? 'T' : 'Q'
}

/**
 * Scripted model for a whole best-of-N invocation.
 *
 * Drafting calls are recognised by the drafting prompt's own tail (`Draft N of M.`) and are
 * answered with one strong or weak draft; every other call is a judge, answered by scoring
 * whichever side carries the verification marker.
 * @param strongDraft - 1-based draft number that gets the marker; 0 to make every draft weak.
 * @param failing - 1-based draft numbers whose generation throws.
 * @param calls - receives one record per model call (route and sampling, in order).
 * @param truncating - 1-based draft numbers whose FIRST attempt stops at the output ceiling.
 */
function scriptedStream(strongDraft: number, failing: readonly number[], calls: Array<Record<string, unknown>>, truncating: readonly number[] = []) {
  return (options: { messages: readonly unknown[]; provider?: string; model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: string }) => {
    const prompt = promptText(options)
    calls.push({ provider: options.provider, model: options.model, temperature: options.temperature, maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort })
    const draft = /Draft (\d+) of \d+\./.exec(prompt)
    if (draft !== null) {
      const number = Number(draft[1])
      if (failing.includes(number)) return (async function* () { throw new Error('draft ' + number + ' exploded') })()
      // Distinct per draft number: byte-identical drafts would (correctly) be collapsed by the
      // engine before the tournament, which changes the cost this suite measures.
      return textStream((number === strongDraft ? STRONG_DRAFT : WEAK_DRAFT) + ' Draft ' + number + '.', truncating.includes(number) ? 'max-tokens' : 'stop')
    }
    return textStream('reasoning\n<score_A> ' + verdictLetter(section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + verdictLetter(section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')) + ' </score_B>')
  }
}

const JUDGE = { provider: 'judge-provider', model: 'judge-model' }

/**
 * Recursive check that a rendered tool value satisfies its declared output schema.
 *
 * The host validates tool output against this schema, and a mismatch would only surface there —
 * never in a unit test that just inspects fields it happens to know about. `required` sits on the
 * property spec (the DSH shape), so an omitted required field and an undeclared extra field are
 * both caught here.
 */
function assertMatchesSchema(value: unknown, schema: Record<string, any>, path: string): void {
  if (schema.enum !== undefined) expect(schema.enum, path).toContain(value)
  if (schema.type === 'object') {
    const row = (value ?? {}) as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, Record<string, any>>
    for (const [key, spec] of Object.entries(properties)) {
      if (spec.required === true) expect(row[key], path + '.' + key + ' is required').toBeDefined()
      if (row[key] !== undefined) assertMatchesSchema(row[key], spec, path + '.' + key)
    }
    if (schema.additionalProperties === false) expect(Object.keys(row).filter(key => !(key in properties)), path + ' has undeclared keys').toEqual([])
    return
  }
  if (schema.type === 'array') {
    expect(Array.isArray(value), path + ' is an array').toBe(true)
    ;(value as unknown[]).forEach((entry, index) => assertMatchesSchema(entry, schema.items as Record<string, any>, path + '[' + index + ']'))
    return
  }
  if (schema.type === 'integer') expect(Number.isSafeInteger(value), path + ' is an integer').toBe(true)
  else if (schema.type === 'number') expect(typeof value === 'number' && Number.isFinite(value), path + ' is a finite number').toBe(true)
  else if (schema.type === 'string') expect(typeof value === 'string', path + ' is a string').toBe(true)
  else if (schema.type === 'boolean') expect(typeof value === 'boolean', path + ' is a boolean').toBe(true)
}

describe('verifier_best_of_n', () => {
  it('records generation usage when too few drafts survive', async () => {
    const definition = assemble(JUDGE, { stream: scriptedStream(1, [2, 3], []), sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const error = await definition.execute({ task: 'do the thing', n: 3 }, exec).catch(reason => reason)
    const partial = partialStats(error)
    // Draft 1 was generated and billed; the failure must not erase it.
    expect(partial?.calls ?? 0).toBeGreaterThanOrEqual(1)
    expect(partial?.inputTokens ?? 0).toBeGreaterThan(0)
    // Both failed drafts still made one request each, and the survivor one: 3 attempts in total.
    expect(partial?.attempts).toBe(3)
  })

  it('keeps a survivor usageIncomplete when an earlier attempt lost its usage', async () => {
    const draftAttempts = new Map<number, number>()
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      const draft = /Draft (\d+) of \d+\./.exec(prompt)
      if (draft !== null) {
        const number = Number(draft[1])
        const seen = (draftAttempts.get(number) ?? 0) + 1
        draftAttempts.set(number, seen)
        if (number === 1 && seen === 1) return (async function* () { throw new Error('network hiccup') })()
        return textStream('draft ' + number + ' body')
      }
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const definition = assemble({ ...JUDGE, maxRetries: 2, retryBaseDelayMs: 1 }, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing', n: 3 }, exec) as Record<string, any>
    expect(result.failed).toBe(0)
    // Draft 1's first attempt failed with unknown usage; the surviving attempt's tokens are a
    // floor, and addUsage() used to drop that flag.
    expect(result.stats.usageIncomplete).toBe(true)
  })

  it('keeps generation and tournament usage when the baseline comparison fails', async () => {
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      const draft = /Draft (\d+) of \d+\./.exec(prompt)
      if (draft !== null) return textStream('draft ' + draft[1] + ' body')
      if (prompt.includes(BASELINE)) return (async function* () { throw new Error('baseline judge exploded') })()
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const error = await definition.execute({ task: 'do the thing', n: 2 }, exec).catch(reason => reason)
    const partial = partialStats(error)
    // Drafts were generated and the tournament ran before the baseline blew up.
    expect(partial?.calls ?? 0).toBeGreaterThan(0)
    expect(partial?.inputTokens ?? 0).toBeGreaterThan(0)
  })

  it('registers a gate-shaped output schema', () => {
    const definition = assemble().tools.get('verifier_best_of_n')!
    const properties = definition.output.schema.properties
    for (const key of [
      'best', 'index', 'sources', 'scores', 'ranking', 'comparisons', 'pivots', 'generated', 'failed',
      'failures', 'score', 'baselineScore', 'winner', 'criteria', 'threshold', 'passesThreshold',
      'failedCriteria', 'calls', 'stats', 'generatorProvider', 'generatorModel', 'provider', 'model', 'judges',
    ]) expect(properties[key], key).toBeDefined()
  })

  it('rejects an out-of-range draft count and a blank task before any model call', async () => {
    const calls: Array<Record<string, unknown>> = []
    const execute = assemble(JUDGE, { stream: scriptedStream(1, [], calls) }).tools.get('verifier_best_of_n')!.execute
    await expect(execute({ task: 'do it', n: 5 }, exec)).rejects.toThrow(/n must be an integer between 2 and 4/u)
    await expect(execute({ task: 'do it', n: 1 }, exec)).rejects.toThrow(/n must be an integer between 2 and 4/u)
    await expect(execute({ task: '   ', n: 2 }, exec)).rejects.toThrow(/task\[0\] must be a non-empty string/u)
    expect(calls).toHaveLength(0)
  })

  it('drafts with the session model, ranks the drafts, and reports the gate-comparable score', async () => {
    const calls: Array<Record<string, unknown>> = []
    const result = await assemble(JUDGE, { stream: scriptedStream(2, [], calls) }).tools.get('verifier_best_of_n')!
      .execute({ task: 'Fix the parser and prove it passes.' }, exec) as Record<string, any>
    expect(result.generated).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.failures).toEqual([])
    expect(result.sources).toEqual([1, 2, 3])
    // Draft 2 is the only one that shows verification, so it must win the tournament.
    expect(result.index).toBe(1)
    expect(result.best).toContain('COMPLETE-AND-VERIFIED')
    expect(result.scores[1]).toBeGreaterThan(result.scores[0]!)
    // The absolute score comes from the winner-vs-baseline comparison in the acceptance
    // threshold's units, NOT from the relative tournament shares.
    expect(result.score).toBe(1)
    expect(result.baselineScore).toBe(0)
    expect(result.winner).toBe('A')
    expect(result.threshold).toBe(0.65)
    expect(result.passesThreshold).toBe(true)
    expect(result.failedCriteria).toEqual([])
    expect(result.provider).toBe('judge-provider')
    expect(result.model).toBe('judge-model')
    expect(result.generatorProvider).toBe('session-provider')
    expect(result.generatorModel).toBe('session-model')
    // Generation used the session route with diversity sampling; judging used the judge route.
    const drafted = calls.filter(call => call.model === 'session-model')
    expect(drafted).toHaveLength(3)
    for (const call of drafted) {
      expect(call.provider).toBe('session-provider')
      expect(call.temperature).toBe(1)
      expect(call.maxTokens).toBe(16384)
      expect(call.reasoningEffort).toBe('high')
    }
    expect(calls.filter(call => call.model === 'judge-model').length).toBeGreaterThan(3)
    // The reported cost covers the drafts as well as every judge call.
    expect(result.calls).toBe(calls.length)
    // judges[].calls covers the WHOLE invocation: the tournament (18) plus the baseline (6).
    expect(result.judges[0].calls).toBe(24)
    expect(result.judges[0].calls + result.generated).toBe(result.calls)
  })

  it('keeps a truncated draft, retries it once, and reports it instead of returning nothing', async () => {
    // Regression from the first real end-to-end acceptance: every draft of a long task hit the
    // output ceiling and the tool failed with "0 usable draft(s)" — the judge contract's
    // max-tokens error had leaked into the generator.
    const calls: Array<Record<string, unknown>> = []
    const result = await assemble(JUDGE, { stream: scriptedStream(1, [], calls, [1]) }).tools.get('verifier_best_of_n')!
      .execute({ task: 'do the thing' }, exec) as Record<string, any>
    expect(result.generated).toBe(3)
    expect(result.truncated).toEqual([1])
    // One capped attempt per draft, no hidden second generation.
    const ceilings = calls.filter(call => call.model === 'session-model').map(call => call.maxTokens)
    expect(ceilings).toEqual([16384, 16384, 16384])
    // A truncated draft is still judged on its text, so the strong one can still win.
    expect(result.index).toBe(0)
    expect(result.best).toContain('COMPLETE-AND-VERIFIED')
    expect(result.passesThreshold).toBe(true)
  })

  it('renders a result that satisfies the declared output schema', async () => {
    const definition = assemble(JUDGE, { stream: scriptedStream(2, [], []) }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing' }, exec)
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'best_of_n')
  })

  it('fails closed when fewer than two drafts survive, naming every failure', async () => {
    const execute = assemble(JUDGE, { stream: scriptedStream(1, [1, 3], []) }).tools.get('verifier_best_of_n')!.execute
    await expect(execute({ task: 'do the thing' }, exec)).rejects.toThrow(/produced 1 usable draft\(s\) out of 3; at least 2 are required/u)
    await expect(execute({ task: 'do the thing' }, exec)).rejects.toThrow(/draft 1: draft 1 exploded; draft 3: draft 3 exploded/u)
  })

  it('reports a failing absolute score when every draft is weak', async () => {
    const result = await assemble(JUDGE, { stream: scriptedStream(0, [], []) }).tools.get('verifier_best_of_n')!
      .execute({ task: 'do the thing' }, exec) as Record<string, any>
    expect(result.generated).toBe(3)
    expect(result.winner).toBe('A')
    expect(result.score).toBeLessThan(0.65)
    expect(result.passesThreshold).toBe(false)
    expect(result.failedCriteria).toHaveLength(3)
  })

  it('stays inside the documented cost envelope', async () => {
    // The README and the tool description publish these numbers, so they are locked here:
    // 2 drafts + 6 tournament calls + 6 baseline calls; 3 + 18 + 6; n=4 adds 1..5 extra
    // tournament pairs (36..54 judge calls) because the pivot round de-duplicates against the ring.
    const measured: Record<number, { calls: number; comparisons: number }> = {}
    for (const n of [2, 3, 4]) {
      const result = await assemble(JUDGE, { stream: scriptedStream(2, [], []) }).tools.get('verifier_best_of_n')!
        .execute({ task: 'do the thing', n }, exec) as Record<string, any>
      measured[n] = { calls: result.calls, comparisons: result.comparisons }
    }
    expect(measured[2]).toEqual({ calls: 14, comparisons: 1 })
    expect(measured[3]).toEqual({ calls: 27, comparisons: 3 })
    expect(measured[4]!.calls).toBeGreaterThanOrEqual(40)
    expect(measured[4]!.calls).toBeLessThanOrEqual(64)
  })

  it('explains what to do when the session model is not logged yet', async () => {
    const execute = assemble(JUDGE, { stream: scriptedStream(1, [], []) }).tools.get('verifier_best_of_n')!.execute
    await expect(execute({ task: 'do the thing' }, bareExec)).rejects.toThrow(/no logged request header/u)
  })
})

/**
 * The explicit session verifier once returned a field its own output schema did not declare.
 * The host rejects that whole call with INVALID_TOOL_OUTPUT long before the model sees a
 * verdict, and because the failure does not depend on the arguments, a retry makes the same
 * model call and fails identically — it reads like a transient tool error. This suite asserts
 * the REAL return value against the declared schema instead of the fields the test knows about.
 */
describe('verifier_current_session', () => {
  /** A session with a real event log: the tool has to extract its own task, trace and image refs. */
  const sessionExec = {
    agent: {
      id: 'agent-3',
      session: {
        header: { id: 'session-3' },
        requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model', reasoningEffort: 'high' } }),
        snapshotEvents: () => [
          { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix the failing parser test.' }] } },
          { type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Patched the separator handling.' }] } } },
          { type: 'tool/result', seq: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '1 passed' }] } } },
        ],
      },
    },
    signal: new AbortController().signal,
  }

  it('declares every field its verdict returns', () => {
    const definition = assemble().tools.get('verifier_current_session')!
    for (const key of [
      'sessionId', 'problem', 'score', 'baselineScore', 'winner', 'criteria', 'fromSeq', 'toSeq',
      'omittedCharacters', 'agreement', 'calls', 'stats', 'provider', 'model', 'judges',
    ]) expect(definition.output.schema.properties[key], key).toBeDefined()
  })

  it('surfaces located findings on the verdict and satisfies the schema', async () => {
    const stream = () => textStream('reasoning\n<finding criterion="Specification Adherence" evidence="A" action="run the parser test">the header is never validated</finding>\n<score_A> Q </score_A>\n<score_B> T </score_B>')
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_current_session')!
    const result = await definition.execute({}, sessionExec) as Record<string, any>
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]).toMatchObject({ criterion: 'Specification Adherence', evidence: 'A', action: 'run the parser test', finding: 'the header is never validated' })
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'current_session')
  })

  it('renders a verdict that satisfies the declared output schema', async () => {
    const definition = assemble(JUDGE, { stream: scriptedStream(0, [], []) }).tools.get('verifier_current_session')!
    const result = await definition.execute({}, sessionExec) as Record<string, any>
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'current_session')
    // The acceptance-facing per-criterion shape, not compare's {scoreA, scoreB}: the host rejects
    // undeclared keys, so reusing criterionResultSchema here is exactly the regression to guard.
    expect(result.criteria.length).toBeGreaterThan(0)
    for (const row of result.criteria) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.score).toBe('number')
      expect(row.scoreA).toBeUndefined()
      expect(row.scoreB).toBeUndefined()
    }
  })
})

/**
 * Both engines short-circuit byte-identical candidates without any model call
 * (`identical: true`, 0.5 everywhere). That flag is optional, so it must be declared on the
 * tool schema too — otherwise the exact case the shortcut exists for fails host validation,
 * and the caller gets INVALID_TOOL_OUTPUT instead of the tie the engine computed.
 */

/**
 * P02: the review stage decides the DEFAULT rubric and the prompt framing, and says so in the
 * verdict. An omitted `review_stage` must keep today's artifact semantics byte for byte.
 */
describe('explicit review stages', () => {
  /** Records every rendered prompt and answers with a fixed A/T verdict. */
  function recording(prompts: string[]) {
    return (options: { messages: readonly unknown[] }) => {
      prompts.push(promptText(options))
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
  }

  it('scores a proposal against the proposal rubric and reports what it used', async () => {
    const prompts: string[] = []
    const { tools } = assemble(JUDGE, { stream: recording(prompts), sessions: [{ id: 'session-1', createdAt: 1 }] })
    const definition = tools.get('verifier_compare')!
    const result = await definition.execute({ problem: 'pick a plan', candidate_a: 'plan STRONG', candidate_b: 'plan WEAK', review_stage: 'proposal' }, exec) as Record<string, any>
    expect(result.reviewStage).toBe('proposal')
    expect(result.criteriaSource).toBe('proposal')
    expect(result.criteria.map((row: any) => row.id)).toEqual(PROPOSAL_CRITERIA.map(row => row.id))
    expect(prompts.length).toBeGreaterThan(0)
    for (const prompt of prompts) {
      expect(prompt).toContain('<<<PROPOSAL_A:')
      expect(prompt).not.toContain('<<<TRAJECTORY_A:')
    }
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'compare')
  })

  it('keeps the omitted stage on the historical artifact path', async () => {
    const prompts: string[] = []
    const { tools } = assemble(JUDGE, { stream: recording(prompts), sessions: [{ id: 'session-1', createdAt: 1 }] })
    const definition = tools.get('verifier_compare')!
    const result = await definition.execute({ problem: 'pick', candidate_a: 'AAA', candidate_b: 'BBB', review_stage: 'artifact' }, exec) as Record<string, any>
    expect(result.reviewStage).toBe('artifact')
    expect(result.criteriaSource).toBe('coding')
    expect(result.criteria.map((row: any) => row.id)).toEqual(['specification', 'output_match', 'error_signals'])
    expect(prompts.every(prompt => prompt.includes('<<<TRAJECTORY_A:'))).toBe(true)
  })

  it('lets an explicit criteria argument keep control of the stage default', async () => {
    const { tools } = assemble(JUDGE, { stream: recording([]), sessions: [{ id: 'session-1', createdAt: 1 }] })
    const definition = tools.get('verifier_select')!
    const result = await definition.execute({
      problem: 'pick a plan',
      candidates: ['plan one', 'plan two', 'plan three'],
      review_stage: 'proposal',
      criteria: [{ id: 'mine', name: 'Mine', description: 'judge only this one thing' }],
    }, exec) as Record<string, any>
    expect(result.reviewStage).toBe('proposal')
    expect(result.criteriaSource).toBe('explicit')
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'select')
  })

  it('refuses an unknown stage before any model call', async () => {
    const calls: string[] = []
    const { tools } = assemble(JUDGE, { stream: recording(calls), sessions: [{ id: 'session-1', createdAt: 1 }] })
    // The registered parameter schema rejects it before execute() ever runs.
    await expect(tools.get('verifier_compare')!.execute({ problem: 'p', candidate_a: 'A', candidate_b: 'B', review_stage: 'draft' }, exec)).rejects.toThrow(/review_stage/u)
    expect(calls).toHaveLength(0)
  })

  it('ranks best-of-N drafts as a proposal but measures the winner with the delivery rubric', async () => {
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      prompts.push(prompt)
      const draft = /Draft (\d+) of \d+\./.exec(prompt)
      if (draft !== null) {
        const number = Number(draft[1])
        return textStream((number === 2 ? STRONG_DRAFT : WEAK_DRAFT) + ' Draft ' + number + '.')
      }
      const sideA = section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')
      const sideB = section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')
      return textStream('<score_A> ' + verdictLetter(sideA) + ' </score_A>\n<score_B> ' + verdictLetter(sideB) + ' </score_B>')
    }
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing' }, exec) as Record<string, any>
    expect(result.rankingStage).toBe('proposal')
    expect(result.rankingCriteriaSource).toBe('proposal')
    expect(result.rankingCriteriaCount).toBe(3)
    expect(result.baselineCriteriaSource).toBe('coding')
    expect(result.baselineCriteriaCount).toBe(3)
    const judges = prompts.filter(prompt => !/Draft \d+ of \d+\./.test(prompt))
    const tournament = judges.filter(prompt => !prompt.includes(BASELINE))
    const baseline = judges.filter(prompt => prompt.includes(BASELINE))
    expect(tournament.length).toBeGreaterThan(0)
    expect(baseline.length).toBeGreaterThan(0)
    // Regression: scoring an unexecuted draft with the artifact rubric fails it by construction,
    // so the tournament must use the proposal rubric while the baseline keeps the gate's own.
    expect(tournament.every(prompt => prompt.includes('<<<PROPOSAL_A:'))).toBe(true)
    expect(baseline.every(prompt => prompt.includes('<<<TRAJECTORY_A:'))).toBe(true)
    // The absolute fields still come only from the baseline comparison.
    expect(result.passesThreshold).toBe(true)
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'best_of_n')
  })

  it('gives every draft and both judge comparisons the same reference context', async () => {
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      prompts.push(prompt)
      const draft = /Draft (\d+) of \d+\./.exec(prompt)
      if (draft !== null) return textStream('draft ' + draft[1] + ' body')
      const sideA = section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')
      const sideB = section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')
      return textStream('<score_A> ' + verdictLetter(sideA) + ' </score_A>\n<score_B> ' + verdictLetter(sideB) + ' </score_B>')
    }
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing', n: 2, context: 'Only stdlib may be used.' }, exec) as Record<string, any>
    expect(result.contextIncluded).toBe(true)
    const blocks = prompts.map(prompt => section(prompt, 'CONTEXT'))
    expect(blocks).toHaveLength(prompts.length)
    // Every call — 2 drafts plus the tournament and the baseline — sees the identical block.
    expect(new Set(blocks).size).toBe(1)
    expect(blocks[0]).toContain('Only stdlib may be used.')
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'best_of_n')
  })

  it('keeps the task-only input when no context is given', async () => {
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      prompts.push(promptText(options))
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing', n: 2 }, exec) as Record<string, any>
    expect(result.contextIncluded).toBe(false)
    expect(prompts.every(prompt => !prompt.includes('<<<CONTEXT:'))).toBe(true)
  })

  it('bounds the context per item and rejects a blank one, like every other evidence field', async () => {
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      prompts.push(promptText(options))
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const definition = assemble(JUDGE, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing', n: 2, context: 'C'.repeat(300_000) }, exec) as Record<string, any>
    expect(result.contextIncluded).toBe(true)
    // Per-item cap (autoRouteMaxItemChars = 20000) plus the block framing, not 300k characters.
    expect(section(prompts[0]!, 'CONTEXT').length).toBeLessThan(20_100)
    // A whitespace-only context is simply "no context", never an error the caller must fix.
    const bare = await definition.execute({ task: 'do the thing', n: 2, context: '   ' }, exec) as Record<string, any>
    expect(bare.contextIncluded).toBe(false)
  })

  it('keeps an explicit best-of-N rubric in control of both phases', async () => {
    const result = await assemble(JUDGE, { stream: scriptedStream(2, [], []) }).tools.get('verifier_best_of_n')!
      .execute({ task: 'do the thing', n: 2, criteria: [{ id: 'mine', name: 'Mine', description: 'judge only this one thing' }] }, exec) as Record<string, any>
    expect(result.rankingCriteriaSource).toBe('explicit')
    expect(result.baselineCriteriaSource).toBe('explicit')
    expect(result.criteria.map((row: any) => row.id)).toEqual(['mine'])
  })
})

describe('identical-candidate verdicts', () => {
  it("declares compare's identical tie on its output schema", async () => {
    const definition = assemble().tools.get('verifier_compare')!
    const result = await definition.execute({ problem: 'choose one', candidate_a: 'same answer', candidate_b: 'same answer' }, exec) as Record<string, any>
    expect(result.identical).toBe(true)
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'compare')
  })

  it("declares select's all-identical ranking on its output schema", async () => {
    const definition = assemble().tools.get('verifier_select')!
    const result = await definition.execute({ problem: 'choose one', candidates: ['same answer', 'same answer'] }, exec) as Record<string, any>
    expect(result.identical).toBe(true)
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'select')
  })
})

/**
 * The optional usage diagnostics must be DECLARED on every tool's stats schema: the host
 * rejects the whole call with INVALID_TOOL_OUTPUT for an undeclared key, so a partial judge
 * failure that correctly set one would otherwise turn a usable verdict into a tool error.
 */
describe('usage diagnostics in tool outputs', () => {
  it('declares the optional usage-completeness and channel-fallback stats fields', () => {
    const definition = assemble().tools.get('verifier_compare')!
    const statsSchema = definition.output.schema.properties.stats as Record<string, any>
    expect(statsSchema.properties.usageIncomplete).toBeDefined()
    expect(statsSchema.properties.channelFallbacks).toBeDefined()
    // Optional: a normal call reports neither.
    expect(statsSchema.properties.usageIncomplete.required).toBeUndefined()
    expect(statsSchema.properties.channelFallbacks.required).toBeUndefined()
  })

  it('keeps the known usage of earlier calls on a failed explicit invocation', async () => {
    const promptOf = (options: { messages: readonly any[] }) => {
      const message = options.messages[0]
      return typeof message.content === 'string' ? message.content : message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    }
    const stream = (options: { messages: readonly any[] }) => promptOf(options).includes('third requirement')
      ? (async function* () { throw new Error('judge exploded') })()
      : textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    // One call at a time: the two successful criteria must resolve before the third fails,
    // so the failure row has to keep their usage (that is the regression).
    const { tools, rpc } = assemble({ ...JUDGE, maxConcurrency: 1 }, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] })
    const definition = tools.get('verifier_compare')!
    const criteria = [
      { id: 'a', name: 'A', description: 'first requirement' },
      { id: 'b', name: 'B', description: 'second requirement' },
      { id: 'c', name: 'C', description: 'third requirement' },
    ]
    await expect(definition.execute({ problem: 'pick', candidate_a: 'AAA', candidate_b: 'BBB', criteria, repeats: 1 }, exec)).rejects.toThrow('judge exploded')
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ success: boolean; stats: { calls: number; attempts: number; usageIncomplete?: boolean } }> } }
    const failed = overview.value.recent.find(row => row.success === false)
    // Two calls completed with their usage, then the third failed: the row must say so.
    expect(failed?.stats.calls).toBe(2)
    expect(failed?.stats.attempts).toBe(3)
    expect(failed?.stats.usageIncomplete).toBe(true)
  })

  it('keeps a partial judge failure schema-valid instead of null counters', async () => {
    // One judge succeeds, one truncates. Merging the failed judge's bare UsageStats used to
    // produce NaN for the RunStats-only counters, which the host serializes as null and rejects.
    const stream = (options: { model?: string }) => textStream(
      '<score_A> A </score_A>\n<score_B> T </score_B>',
      options.model === 'bad-model' ? 'max-tokens' : 'stop',
    )
    const { tools } = assemble({ ...JUDGE, extraJudges: [{ provider: 'bad-provider', model: 'bad-model' }] }, { stream, sessions: [{ id: 'session-1', createdAt: 1 }] })
    const definition = tools.get('verifier_compare')!
    const result = await definition.execute({ problem: 'pick', candidate_a: 'AAA', candidate_b: 'BBB' }, exec) as Record<string, any>
    const roundTripped = JSON.parse(JSON.stringify(result))
    expect(roundTripped.stats.cacheMisses).not.toBeNull()
    assertMatchesSchema(roundTripped, definition.output.schema as Record<string, any>, 'compare')
  })

  it('marks a partial generation failure incomplete and still satisfies the output schema', async () => {
    // Draft 1 dies, drafts 2 and 3 survive: the invocation succeeds, but the failed request
    // really happened. The REAL return value must carry the flag AND satisfy the schema.
    const definition = assemble(JUDGE, { stream: scriptedStream(1, [1], []) }).tools.get('verifier_best_of_n')!
    const result = await definition.execute({ task: 'do the thing' }, exec) as Record<string, any>
    expect(result.failed).toBe(1)
    expect(result.stats.usageIncomplete).toBe(true)
    assertMatchesSchema(result, definition.output.schema as Record<string, any>, 'best_of_n')
  })
})

/**
 * The dashboard's "why did the judge decide that" path.
 *
 * The statistics row and its decision snapshot must share ONE id: the row is listed under it, the
 * snapshot is filed under it, and the decision endpoint resolves "the snapshot of this row" by
 * exactly that value. Two independently generated uuids made every click answer "pruned, never
 * captured, or belongs to a deleted topic" while the snapshot sat in the topic sidecar.
 */
describe('decision snapshots behind a dashboard row', () => {
  it('resolves the snapshot from the invocation id the row was listed under', async () => {
    const { tools, rpc } = assemble(JUDGE, {
      stream: () => textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>'),
      sessions: [{ id: 'session-1', createdAt: 1 }],
    })
    await tools.get('verifier_compare')!.execute({ problem: 'pick the better plan', candidate_a: 'AAA', candidate_b: 'BBB', repeats: 1 }, exec)
    const handler = rpc.get('/llm-verifier')!
    const overview = await handler('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ id: string; toolName: string; success: boolean }> } }
    const row = overview.value.recent.find(entry => entry.success)
    expect(row).toBeDefined()

    const found = await handler('decision', { id: row!.id }) as { ok: boolean; value?: { decision: { id: string; toolName: string; calls: Array<{ prompt: string; output: string }> } } }
    expect(found.ok).toBe(true)
    expect(found.value?.decision.id).toBe(row!.id)
    expect(found.value?.decision.toolName).toBe('verifier_compare')
    expect(found.value?.decision.calls.length).toBeGreaterThan(0)
    expect(found.value?.decision.calls[0]?.prompt).toContain('pick the better plan')

    // A genuinely unknown id still fails closed instead of inventing a snapshot.
    expect(await handler('decision', { id: 'never-recorded' })).toMatchObject({ ok: false })
  })
})

/**
 * The turn-stopping gate is the one place a manual pass would previously be honoured even
 * when it reviewed only an older slice of the task. These drive the REAL registered hook
 * through the assembly seam instead of asserting the pure rule twice.
 */

/**
 * P06 through the REAL hooks.
 *
 * The switch is off by default, so the closed path must be indistinguishable from not having the
 * feature: one downstream dispatch, no extra model call, nothing buffered. When it is on, a task
 * stuck in two consecutive verification failures gets ONE alternative reply for its next main
 * request, and only a judge-selected alternative replaces the original.
 */
describe('P06 process selection through the real hooks', () => {
  const user = (seq: number, text: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const call = (seq: number, id: string, name: string) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
  const failed = (seq: number, id: string, text: string) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text, isError: true }] } } })
  /** Two consecutive FAILED verification runs: the only P06 trigger. */
  const stuck = () => [user(0, 'Fix the failing parser test.'), call(1, 't1', 'pwsh'), failed(2, 't1', 'Tests 1 failed'), call(3, 't2', 'pwsh'), failed(4, 't2', 'Tests 2 failed')]
  const recovered = () => [user(0, 'Fix the failing parser test.'), call(1, 't1', 'pwsh'), failed(2, 't1', 'Tests 1 failed'), call(3, 't2', 'pwsh'), { type: 'tool/result', seq: 4, data: { turn: 1, step: 1, message: { source: { callId: 't2' }, content: [{ type: 'text', text: 'Tests 3 passed' }] } } }]

  function agent(events: readonly unknown[]) {
    return {
      id: 'agent-p06',
      session: {
        header: { id: 'agent-p06' },
        snapshotEvents: () => events,
        requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }),
      },
      steer() {},
    }
  }
  const originalChunks = () => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'ORIGINAL-REPLY' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'ORIGINAL-REPLY' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  async function* streamOf(chunks: readonly unknown[]) { for (const chunk of chunks) yield chunk }

  /** A model stub that answers judge prompts with an A/B verdict and everything else with prose. */
  function stubStream(calls: string[]) {
    return (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      if (prompt.includes('**Evaluation Guideline')) {
        calls.push('judge')
        // Content-addressed, exactly like the other scripted judges: the round swaps A/B slots, so
        // a positional answer would average the two candidates into a tie.
        const letter = (block: string) => block.includes('ALTERNATIVE-REPLY') ? 'A' : 'T'
        return textStream('reasoning\n<score_A> ' + letter(section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + letter(section(prompt, 'PROPOSAL_B')) + ' </score_B>')
      }
      calls.push('generation')
      return textStream('ALTERNATIVE-REPLY')
    }
  }
  async function drive(options: { config?: Record<string, unknown>; events: readonly unknown[]; calls: string[]; onGeneration?: (request: unknown) => void }) {
    const scripted = stubStream(options.calls)
    const dispatch = (request: { messages: readonly unknown[] }) => {
      if (!promptText(request).includes('**Evaluation Guideline')) options.onGeneration?.(request)
      return scripted(request)
    }
    const { handlers, rpc } = assemble({ ...JUDGE, ...options.config }, { stream: dispatch, sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent(options.events)
    await handlers.get('agent/pre-step')!({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
    const main = markAgentLoopRequest({ provider: 'session-provider', model: 'session-model', messages: [], sessionId: 'agent-p06' as never })
    const stream = handlers.get('llm/stream')!
    const chunks: unknown[] = []
    for await (const chunk of stream(main, () => streamOf(originalChunks())) as AsyncIterable<unknown>) chunks.push(chunk)
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ route?: { trigger?: string; replayed?: string; generatedCalls?: number; judgeCalls?: number; alternativeAugmented?: boolean; alternativeModel?: string }; toolName?: string; verdict?: { outcome?: string } }> } }
    return { chunks, calls: options.calls, recent: overview.value.recent }
  }

  it('is a closed path by default: one dispatch, no added call, original chunks untouched', async () => {
    const calls: string[] = []
    const { chunks } = await drive({ events: stuck(), calls })
    expect(calls).toEqual([])
    expect(chunks).toEqual(originalChunks())
  })

  it('does not trigger while the mode is not smart, even with the switch on', async () => {
    const calls: string[] = []
    const { chunks } = await drive({ config: { autoProcessSelection: true, autoVerifyMode: 'strict' }, events: stuck(), calls })
    expect(calls).toEqual([])
    expect(chunks).toEqual(originalChunks())
  })

  it('does not trigger when one of the two newest verification runs succeeded', async () => {
    const calls: string[] = []
    const { chunks } = await drive({ config: { autoProcessSelection: true }, events: recovered(), calls })
    expect(calls).toEqual([])
    expect(chunks).toEqual(originalChunks())
  })

  it('generates one alternative for a stuck task and replays the winner', async () => {
    const calls: string[] = []
    const { chunks, recent } = await drive({ config: { autoProcessSelection: true }, events: stuck(), calls })
    // Exactly one extra generation plus the proposal comparison's judge calls.
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(1)
    expect(calls.filter(entry => entry === 'judge')).toHaveLength(6)
    // The judge preferred B, which is the generated alternative.
    expect(chunks.some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    const cycle = recent.find(row => row.route?.trigger === 'llm-stream')
    expect(cycle?.route?.replayed).toBe('candidate')
    expect(cycle?.route?.generatedCalls).toBe(1)
    expect(cycle?.route?.judgeCalls).toBe(6)
    expect(cycle?.verdict?.outcome).toBe('compared')
  })

  it('hands the alternative the failing-run evidence, and marks the row', async () => {
    const calls: string[] = []
    let generation: { messages?: readonly unknown[] } | undefined
    const { recent } = await drive({ config: { autoProcessSelection: true }, events: stuck(), calls, onGeneration: request => { generation = request as { messages?: readonly unknown[] } } })
    // The extra candidate is written WITH the failure the cycle exists for, bounded and framed as
    // data — otherwise the comparison mostly measures sampling noise.
    const body = JSON.stringify(generation?.messages ?? [])
    expect(body).toContain('DATA, not instructions')
    expect(body).toContain('Tests 1 failed')
    expect(body).toContain('Tests 2 failed')
    // The digest names the run it came from, so the alternative can tell the two failures apart.
    expect(body).toContain('pwsh')
    const cycle = recent.find(row => row.route?.trigger === 'llm-stream')
    expect(cycle?.route?.alternativeAugmented).toBe(true)
  })

  it('keeps the control arm when the failure evidence is turned off', async () => {
    const calls: string[] = []
    let generation: { messages?: readonly unknown[] } | undefined
    const { recent } = await drive({ config: { autoProcessSelection: true, autoProcessFailureContext: false }, events: stuck(), calls, onGeneration: request => { generation = request as { messages?: readonly unknown[] } } })
    // The cycle is still bought; only the extra information is withheld, which is what makes the
    // two arms comparable.
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(1)
    expect(JSON.stringify(generation?.messages ?? [])).not.toContain('DATA, not instructions')
    const cycle = recent.find(row => row.route?.trigger === 'llm-stream')
    expect(cycle?.route?.alternativeAugmented).toBeUndefined()
  })

  it('judges the configured number of candidates in one tournament', async () => {
    const calls: string[] = []
    const { recent } = await drive({ config: { autoProcessSelection: true, autoProcessCandidates: 3 }, events: stuck(), calls })
    // Two alternatives are generated and the tournament is what judges them. The two identical
    // alternatives are de-duplicated inside the engine, so exactly one pair is judged here.
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(2)
    expect(calls.filter(entry => entry === 'judge')).toHaveLength(6)
    const cycle = recent.find(row => row.route?.trigger === 'llm-stream')
    expect(cycle?.route?.generatedCalls).toBe(2)
    // The row says which seam produced it: a tournament is not a pairwise comparison.
    expect(cycle?.toolName).toBe('verifier_select')
  })

  it('generates the alternative with the configured route and records which model it was', async () => {
    const calls: string[] = []
    let generation: { provider?: string; model?: string } | undefined
    const { recent } = await drive({
      config: { autoProcessSelection: true, autoProcessAlternativeModel: 'other-provider/other-model' },
      events: stuck(),
      calls,
      onGeneration: request => { generation = request as { provider?: string; model?: string } },
    })
    // The generation is dispatched on the configured route; the judge still runs on the judge model.
    expect(generation?.provider).toBe('other-provider')
    expect(generation?.model).toBe('other-model')
    const cycle = recent.find(row => row.route?.trigger === 'llm-stream')
    expect(cycle?.route?.alternativeModel).toBe('other-provider/other-model')
  })

  it('buys at most one cycle per task', async () => {
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: true }, { stream: stubStream([]), sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent(stuck())
    const preStep = handlers.get('agent/pre-step')!
    const stream = handlers.get('llm/stream')!
    const runOnce = async () => {
      await preStep({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
      const chunks: unknown[] = []
      for await (const chunk of stream(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), async function* () { yield* originalChunks() }) as AsyncIterable<unknown>) chunks.push(chunk)
      return chunks
    }
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    // The second stop boundary must NOT register another intent: the task already bought its cycle.
    const second = await runOnce()
    expect(second).toEqual(originalChunks())
  })

  it('every-step registers without a recovery signal, and keeps selecting while the allowance lasts', async () => {
    // The whole point of the mode: a task that never failed twice still gets a selected next reply,
    // once per main-loop request, up to maxProcessCyclesPerTask.
    const calls: string[] = []
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: 'every-step', maxProcessCyclesPerTask: 2 }, { stream: stubStream(calls), sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    // No verification run at all, let alone two failing ones.
    const target = agent([user(0, 'Add a health endpoint.')])
    const preStep = handlers.get('agent/pre-step')!
    const stream = handlers.get('llm/stream')!
    const runOnce = async () => {
      await preStep({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
      const chunks: unknown[] = []
      for await (const chunk of stream(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), async function* () { yield* originalChunks() }) as AsyncIterable<unknown>) chunks.push(chunk)
      return chunks
    }
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(2)
    // Boundary: the allowance is now spent, so the third request passes straight through. Asserting
    // the exact marker rather than "no alternative" keeps a broken judge from passing this.
    expect(await runOnce()).toEqual(originalChunks())
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(2)
  })

  it('does not register an every-step intent once the per-task allowance is reached', async () => {
    // One cycle allowed: the first request selects, the second is not even registered.
    const calls: string[] = []
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: 'every-step', maxProcessCyclesPerTask: 1 }, { stream: stubStream(calls), sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent([user(0, 'Add a health endpoint.')])
    const preStep = handlers.get('agent/pre-step')!
    const stream = handlers.get('llm/stream')!
    const runOnce = async () => {
      await preStep({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
      const chunks: unknown[] = []
      for await (const chunk of stream(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), async function* () { yield* originalChunks() }) as AsyncIterable<unknown>) chunks.push(chunk)
      return chunks
    }
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    expect(await runOnce()).toEqual(originalChunks())
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(1)
  })

  it('every-step carries the failure evidence only when the recovery signal happens to hold', async () => {
    // The digest is optional context in this mode, not the trigger: with a stuck task it must still
    // reach the alternative, and with a healthy one the cycle must run without it.
    const stuckCalls: string[] = []
    let stuckGeneration: { messages?: readonly unknown[] } | undefined
    await drive({
      config: { autoProcessSelection: 'every-step' },
      events: stuck(),
      calls: stuckCalls,
      onGeneration: request => { stuckGeneration = request as { messages?: readonly unknown[] } },
    })
    expect(JSON.stringify(stuckGeneration?.messages ?? [])).toContain('DATA, not instructions')

    const healthyCalls: string[] = []
    let healthyGeneration: { messages?: readonly unknown[] } | undefined
    const { recent } = await drive({
      config: { autoProcessSelection: 'every-step' },
      events: [user(0, 'Add a health endpoint.')],
      calls: healthyCalls,
      onGeneration: request => { healthyGeneration = request as { messages?: readonly unknown[] } },
    })
    // The cycle ran (one extra generation plus the judged pair)...
    expect(healthyCalls.filter(entry => entry === 'generation')).toHaveLength(1)
    expect(healthyCalls.filter(entry => entry === 'judge')).toHaveLength(6)
    // ...and the row does not claim the alternative was augmented.
    expect(recent.find(row => row.route?.trigger === 'llm-stream')?.route?.alternativeAugmented).toBeUndefined()
    expect(JSON.stringify(healthyGeneration?.messages ?? [])).not.toContain('DATA, not instructions')
  })

  it('keeps the recovery mode at one cycle per task, still gated on two failed runs', async () => {
    // Regression guard for the mode split: 'recovery' must not inherit the every-step allowance.
    const calls: string[] = []
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: 'recovery', maxProcessCyclesPerTask: 8 }, { stream: stubStream(calls), sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent(stuck())
    const preStep = handlers.get('agent/pre-step')!
    const stream = handlers.get('llm/stream')!
    const runOnce = async () => {
      await preStep({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
      const chunks: unknown[] = []
      for await (const chunk of stream(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), async function* () { yield* originalChunks() }) as AsyncIterable<unknown>) chunks.push(chunk)
      return chunks
    }
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    // The raised every-step ceiling must not apply: recovery still buys exactly one.
    expect(await runOnce()).toEqual(originalChunks())
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(1)

    // And it is still gated on the two-failure signal: a healthy task in recovery mode does nothing.
    const healthyCalls: string[] = []
    const { chunks } = await drive({ config: { autoProcessSelection: 'recovery' }, events: [user(0, 'Add a health endpoint.')], calls: healthyCalls })
    expect(healthyCalls).toEqual([])
    expect(chunks).toEqual(originalChunks())
  })

  it('buys its own cycle for a second task of the same session', async () => {
    // The plan allows ONE cycle per task, bounded by the shared route allowance — not one per
    // session. A private per-session process counter made the second task unable to buy at all.
    const calls: string[] = []
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: true }, { stream: stubStream(calls), sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const events: unknown[] = [...stuck()]
    const target = { ...agent(events) }
    const preStep = handlers.get('agent/pre-step')!
    const stream = handlers.get('llm/stream')!
    const runOnce = async () => {
      await preStep({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
      const chunks: unknown[] = []
      for await (const chunk of stream(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), async function* () { yield* originalChunks() }) as AsyncIterable<unknown>) chunks.push(chunk)
      return chunks
    }
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    // A NEW direct task, again stuck in two consecutive failed verification runs.
    events.push(user(10, 'Now fix the lexer.'), call(11, 't3', 'pwsh'), failed(12, 't3', 'Tests 4 failed'), call(13, 't4', 'pwsh'), failed(14, 't4', 'Tests 5 failed'))
    expect((await runOnce()).some(chunk => JSON.stringify(chunk).includes('ALTERNATIVE-REPLY'))).toBe(true)
    expect(calls.filter(entry => entry === 'generation')).toHaveLength(2)
  })

  it('sends a redacted, bounded view carrying constraints, failure evidence and tool definitions', async () => {
    const prompts: string[] = []
    const secret = 'api_key=sk-live-9f3a2b'
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      if (prompt.includes('**Evaluation Guideline')) {
        prompts.push(prompt)
        const letter = (block: string) => block.includes('ALTERNATIVE-REPLY') ? 'A' : 'T'
        return textStream('reasoning\n<score_A> ' + letter(section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + letter(section(prompt, 'PROPOSAL_B')) + ' </score_B>')
      }
      return textStream('ALTERNATIVE-REPLY deploy with ' + secret)
    }
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: true }, { stream, sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent(stuck())
    await handlers.get('agent/pre-step')!({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
    const main = markAgentLoopRequest({
      provider: 'session-provider',
      model: 'session-model',
      messages: [],
      sessionId: 'agent-p06' as never,
      system: 'Never touch production.',
      tools: [{ name: 'pwsh', description: 'Run a command', parameters: { properties: { command: {} } } }] as never,
    })
    const chunks: unknown[] = []
    for await (const chunk of handlers.get('llm/stream')!(main, () => streamOf(originalChunks())) as AsyncIterable<unknown>) chunks.push(chunk)
    expect(prompts.length).toBeGreaterThan(0)
    const judgePrompt = prompts[0]!
    // The candidate reply is untrusted input: the credential must be masked before it is judged.
    expect(judgePrompt).not.toContain('sk-live-9f3a2b')
    expect(judgePrompt).toContain('[REDACTED]')
    // The judge can only judge "does the next step address the real failure" with these.
    expect(judgePrompt).toContain('Never touch production.')
    expect(judgePrompt).toContain('pwsh(command): Run a command')
    expect(judgePrompt).toContain('Tests 2 failed')
    // Only the JUDGE view is sanitized: the winning reply is replayed exactly as the model sent it.
    expect(chunks.some(chunk => JSON.stringify(chunk).includes('sk-live-9f3a2b'))).toBe(true)
  })

  it('measures the rendered evidence against the configured total instead of estimating it', async () => {
    // The repro: a 1000-character total was exceeded by more than double because the task was not
    // counted at all. Every evidence block the judge actually saw must now fit that total.
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      if (prompt.includes('**Evaluation Guideline')) {
        prompts.push(prompt)
        const letter = (block: string) => block.includes('ALTERNATIVE-REPLY') ? 'A' : 'T'
        return textStream('reasoning\n<score_A> ' + letter(section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + letter(section(prompt, 'PROPOSAL_B')) + ' </score_B>')
      }
      return textStream('ALTERNATIVE-REPLY ' + 'y'.repeat(5000))
    }
    const { handlers } = assemble({ ...JUDGE, autoProcessSelection: true, autoRouteMaxItemChars: 100, autoRouteMaxInputChars: 1000 }, { stream, sessions: [{ id: 'agent-p06', createdAt: 1 }] })
    const target = agent(stuck())
    await handlers.get('agent/pre-step')!({ agent: target, signal: new AbortController().signal, messages: [], step: 2 }, () => ({ kind: 'enter', messages: [] }))
    const chunks: unknown[] = []
    for await (const chunk of handlers.get('llm/stream')!(markAgentLoopRequest({ provider: 'p', model: 'm', messages: [], sessionId: 'agent-p06' as never }), () => streamOf(originalChunks())) as AsyncIterable<unknown>) chunks.push(chunk)
    // Six judge calls: three proposal criteria x two repeats. Every one of them must fit.
    expect(prompts.length).toBeGreaterThan(0)
    for (const prompt of prompts) {
      const evidence = section(prompt, 'TASK').length + section(prompt, 'CONTEXT').length + section(prompt, 'PROPOSAL_A').length + section(prompt, 'PROPOSAL_B').length
      expect(evidence).toBeLessThanOrEqual(1000)
    }
    // The prose was clipped (never the whole 5000-character reply), and the cycle still decided.
    expect(section(prompts[0]!, 'PROPOSAL_B')).toContain('ALTERNATIVE-REPLY')
    expect(section(prompts[0]!, 'PROPOSAL_B').length).toBeLessThan(200)
  })
})

describe('automatic gate lifecycle', () => {
  const user = (seq: number, text: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const call = (seq: number, id: string, name: string) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
  const result = (seq: number, id: string, text: string) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text }] } } })
  const manualVerdict = (toSeq: number) => JSON.stringify({ sessionId: 'agent-hook', score: 0.9, baselineScore: 0, winner: 'A', fromSeq: 0, toSeq, criteria: [{ id: 'a', score: 1 }, { id: 'b', score: 1 }, { id: 'c', score: 1 }] })
  function agent(events: readonly unknown[], steered: unknown[]) {
    return {
      id: 'agent-hook',
      session: { header: { id: 'agent-hook' }, snapshotEvents: () => events, requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }) },
      steer(message: unknown) { steered.push(message) },
    }
  }
  const workingEvents = (toSeq: number) => [
    user(0, 'Implement it'),
    call(1, 'e', 'edit'), result(2, 'e', 'edited the file'),
    call(3, 'p', 'pwsh'), result(4, 'p', 'Tests 3 passed'),
    call(5, 'r', 'read'), result(6, 'r', 'ok'),
    call(7, 'v', 'verifier_current_session'), result(8, 'v', manualVerdict(toSeq)),
  ]

  it('runs the final gate when the manual verdict only covered an older interval', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'topic-1', createdAt: 1 }] })
    const steered: unknown[] = []
    await handlers.get('agent/turn-stopping')!({ agent: agent(workingEvents(2), steered), signal: new AbortController().signal })
    // toSeq=2 misses the pwsh result at seq 4, so the verdict is stale and the gate runs.
    expect(calls.length).toBeGreaterThan(0)
  })

  it('records a low-confidence classification so "not routed" has a reason', async () => {
    // Diagnostics gap named by the review: a task that was never routed showed nothing on the
    // dashboard. The classification decision itself is now stored with its reason.
    const stream = () => textStream(JSON.stringify({ kind: 'compare', confidence: 0.2, reason: 'unclear', candidateCallIds: ['s1', 's2'], checkpointSeqs: [] }))
    const { handlers, rpc } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-hook', createdAt: 1 }] })
    const events = [
      user(0, 'Implement it'),
      call(1, 's1', 'subagent'), result(2, 's1', 'frontend analysis'),
      call(3, 's2', 'subagent'), result(4, 's2', 'backend analysis'),
      call(5, 'e', 'edit'), result(6, 'e', 'edited the file'),
    ]
    await handlers.get('agent/turn-stopping')!({ agent: agent(events, []), signal: new AbortController().signal })
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { ok: boolean; value: { recent: Array<{ toolName: string; verdict?: { outcome?: string } }> } }
    expect(overview.ok).toBe(true)
    expect(overview.value.recent.some(row => row.toolName === 'verifier_route_classify' && row.verdict?.outcome === 'low-confidence')).toBe(true)
  })

  it('records a confident "none" classification too', async () => {
    // A high-confidence none is still a decision; previously only the low-confidence
    // branch recorded anything, so kind=none/confidence=1 left only "classified".
    const stream = () => textStream(JSON.stringify({ kind: 'none', confidence: 1, reason: 'final delivery only', candidateCallIds: [], checkpointSeqs: [] }))
    const { handlers, rpc } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-hook', createdAt: 1 }] })
    const events = [
      user(0, 'Implement it'),
      call(1, 's1', 'subagent'), result(2, 's1', 'frontend analysis'),
      call(3, 'e', 'edit'), result(4, 'e', 'edited the file'),
    ]
    await handlers.get('agent/turn-stopping')!({ agent: agent(events, []), signal: new AbortController().signal })
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { ok: boolean; value: { recent: Array<{ toolName: string; verdict?: { outcome?: string } }> } }
    expect(overview.value.recent.some(row => row.toolName === 'verifier_route_classify' && row.verdict?.outcome === 'none')).toBe(true)
  })

  it('steers and still runs the final gate when strict routing cites invisible evidence', async () => {
    // Regression: the strict invalid-reference branch set strictBlocked and returned,
    // ending the review with no steering and no final acceptance.
    const calls: Array<Record<string, unknown>> = []
    const stream = () => { calls.push({}); return textStream(JSON.stringify({ kind: 'compare', confidence: 1, reason: 'r', candidateCallIds: ['missing-a', 'missing-b'], checkpointSeqs: [] })) }
    const { handlers } = assemble({ ...JUDGE, autoVerifyMode: 'strict' }, { stream, sessions: [{ id: 'agent-hook', createdAt: 1 }] })
    const steered: unknown[] = []
    const events = [
      user(0, 'Implement it'),
      call(1, 's1', 'subagent'), result(2, 's1', 'frontend analysis'),
      call(3, 's2', 'subagent'), result(4, 's2', 'backend analysis'),
      call(5, 'e', 'edit'), result(6, 'e', 'edited the file'),
    ]
    await handlers.get('agent/turn-stopping')!({ agent: agent(events, steered), signal: new AbortController().signal })
    expect(steered.length).toBeGreaterThan(0)
    // One classification call plus the final acceptance — the gate was not skipped.
    expect(calls.length).toBeGreaterThan(1)
  })

  it('records an unreadable evidence read and still attempts the final gate', async () => {
    // Regression: the semantic view-build catch returned, so a failed image read produced no
    // record, no steering and no final acceptance — indistinguishable from a budget stop.
    const calls: Array<Record<string, unknown>> = []
    const steered: unknown[] = []
    const imageOnly = { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'missing', mediaType: 'image/png' } }] } }
    const events = [
      imageOnly,
      call(1, 's1', 'subagent'), result(2, 's1', 'analysis'),
      call(3, 'e', 'edit'), result(4, 'e', 'edited the file'),
      call(5, 'p', 'pwsh'), result(6, 'p', 'Tests 3 passed'),
    ]
    const { handlers, rpc } = assemble({ ...JUDGE, autoVerifyMode: 'strict' }, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-hook', createdAt: 1 }] })
    await handlers.get('agent/turn-stopping')!({ agent: agent(events, steered), signal: new AbortController().signal })
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ route?: { skipReason?: string } }> } }
    const reasons = overview.value.recent.map(row => row.route?.skipReason).filter((reason): reason is string => reason !== undefined)
    expect(reasons).toContain('evidence-unreadable')
    // The boundary still reached the mandatory final acceptance, which failed for the same reason.
    expect(reasons).toContain('failed')
    expect(steered.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })

  it('does not re-verify when the manual verdict covers the whole current task', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'topic-2', createdAt: 1 }] })
    const steered: unknown[] = []
    await handlers.get('agent/turn-stopping')!({ agent: agent(workingEvents(6), steered), signal: new AbortController().signal })
    expect(calls).toHaveLength(0)
    expect(steered).toHaveLength(0)
  })
})

/**
 * S01/S05-A through the REGISTERED hooks.
 *
 * The router's own counters are not the contract: what matters is that the configured
 * attempt budget survives a real plan pre-review and that the classification row and the
 * execution it produced are observable as one cycle.
 */
describe('routing-cycle budget through the real hooks', () => {
  const user = (seq: number, text: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const call = (seq: number, id: string, name: string) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
  const result = (seq: number, id: string, text: string) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text }] } } })
  function agent(events: readonly unknown[], steered: unknown[]) {
    return {
      id: 'agent-cycle',
      session: { header: { id: 'agent-cycle' }, snapshotEvents: () => events, requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }) },
      steer(message: unknown) { steered.push(message) },
    }
  }
  /** Two competing subagent results plus a write: enough for the semantic route to classify compare. */
  const alternatives = [
    user(0, 'Pick the best implementation and build it'),
    call(1, 's1', 'subagent'), result(2, 's1', 'frontend analysis'),
    call(3, 's2', 'subagent'), result(4, 's2', 'backend analysis'),
    call(5, 'e', 'edit'), result(6, 'e', 'edited the file'),
  ]
  /** Plan review, router classification and judge scoring, told apart by their own prompts. */
  function cycleStream(calls: Array<Record<string, unknown>>) {
    return (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      if (prompt.includes('expert independent technical plan verifier')) return textStream('Verdict: A\nSummary: sound plan.')
      if (prompt.includes('conservative verifier router')) return textStream(JSON.stringify({ kind: 'compare', confidence: 1, reason: 'two alternatives', candidateCallIds: ['s1', 's2'], checkpointSeqs: [] }))
      return textStream('reasoning\n<score_A> ' + verdictLetter(section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + verdictLetter(section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')) + ' </score_B>')
    }
  }
  const isPlan = (prompt: string) => prompt.includes('expert independent technical plan verifier')
  const isRouter = (prompt: string) => prompt.includes('conservative verifier router')
  const isJudge = (prompt: string) => prompt.includes('TRAJECTORY_A')

  it('lets a plan pre-review be followed by a classify+compare cycle under the shipped two attempts', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble({ ...JUDGE, autoRouteMaxPerTask: 2, autoVerifyPlanMode: true }, { stream: cycleStream(calls), sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const steered: unknown[] = []
    const signal = new AbortController().signal
    await handlers.get('tools/pre-execute')!({ name: 'exit_plan_mode', arguments: { plan: 'Split the work and verify each part.' }, agent: agent(alternatives, steered), signal }, () => ({ kind: 'allow' }))
    await handlers.get('agent/turn-stopping')!({ agent: agent(alternatives, steered), signal })
    const prompts = calls.map(call => String(call.prompt))
    expect(prompts.filter(isPlan)).toHaveLength(1)
    expect(prompts.filter(isRouter)).toHaveLength(1)
    // The compare really executed: six judge calls (three criteria x two rounds).
    expect(prompts.filter(isJudge)).toHaveLength(6)
    expect(JSON.stringify(steered)).toContain('Automatic verifier routing: compare')
  })

  it('falls through to the eligible final gate when the attempt budget is already spent', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble({ ...JUDGE, autoRouteMaxPerTask: 1, autoVerifyPlanMode: true }, { stream: cycleStream(calls), sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const steered: unknown[] = []
    const signal = new AbortController().signal
    await handlers.get('tools/pre-execute')!({ name: 'exit_plan_mode', arguments: { plan: 'Split the work.' }, agent: agent(alternatives, steered), signal }, () => ({ kind: 'allow' }))
    await handlers.get('agent/turn-stopping')!({ agent: agent(alternatives, steered), signal })
    const prompts = calls.map(call => String(call.prompt))
    // The plan used the only route attempt, so no classification and no routed compare.
    expect(prompts.filter(isRouter)).toHaveLength(0)
    expect(JSON.stringify(steered)).not.toContain('Automatic verifier routing: compare')
    // Work is still eligible, so the mandatory final acceptance runs.
    expect(prompts.filter(isJudge).length).toBeGreaterThan(0)
  })

  it('stores a classification and its promoted execution under one cycle id', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers, rpc } = assemble({ ...JUDGE, autoRouteMaxPerTask: 2 }, { stream: cycleStream(calls), sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const steered: unknown[] = []
    await handlers.get('agent/turn-stopping')!({ agent: agent(alternatives, steered), signal: new AbortController().signal })
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { ok: boolean; value: { recent: Array<{ toolName: string; route?: { cycleId: string; trigger: string; stage: string; destination: string; attempt?: number; reservedCalls?: number } }> } }
    expect(overview.ok).toBe(true)
    const routed = overview.value.recent.filter(row => row.route !== undefined)
    const classification = routed.find(row => row.route!.stage === 'classification')
    const execution = routed.find(row => row.route!.stage === 'execution')
    expect(classification).toBeDefined()
    expect(execution).toBeDefined()
    expect(execution!.route!.cycleId).toBe(classification!.route!.cycleId)
    expect(classification!.route!.trigger).toBe('turn-stopping')
    expect(execution!.route!.destination).toBe('compare')
    // One cycle, one attempt: the classification call and the six compare calls are one reservation.
    expect(execution!.route!.attempt).toBe(1)
    expect(execution!.route!.reservedCalls).toBe(7)
  })

  it('records a successful classification whose execution the budget refused as exactly that', async () => {
    const calls: Array<Record<string, unknown>> = []
    // The classification (1 call) fits with the 6-call final-acceptance floor reserved out of
    // an 8-call task budget, but its 6-call compare does not (1 + 6 + 6 > 8).
    const { handlers, rpc } = assemble({ ...JUDGE, autoRouteMaxPerTask: 3, autoMaxModelCallsPerTask: 8 }, { stream: cycleStream(calls), sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const steered: unknown[] = []
    await handlers.get('agent/turn-stopping')!({ agent: agent(alternatives, steered), signal: new AbortController().signal })
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ toolName: string; verdict?: { outcome?: string }; route?: { skipReason?: string; stage?: string } }> } }
    const skipped = overview.value.recent.find(row => row.toolName === 'verifier_compare' && row.verdict?.outcome === 'classification-only-budget')
    expect(skipped).toBeDefined()
    expect(skipped!.route).toMatchObject({ stage: 'skipped', skipReason: 'classification-only-budget' })
    // It must never be described as a scoreless "none" or as a completed review.
    expect(JSON.stringify(steered)).not.toContain('Automatic verifier routing: compare')
  })

  it('does not re-classify when a narrative message changes only the last sequence', async () => {
    const calls: Array<Record<string, unknown>> = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      if (isRouter(prompt)) return textStream(JSON.stringify({ kind: 'none', confidence: 1, reason: 'same subtask', candidateCallIds: [], checkpointSeqs: [] }))
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const { handlers } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const events: Array<Record<string, unknown>> = [user(0, 'Do it'), call(1, 's1', 'subagent'), result(2, 's1', 'analysis'), call(3, 'e', 'edit'), result(4, 'e', 'edited')]
    const handle = handlers.get('agent/turn-stopping')!
    await handle({ agent: agent(events, []), signal: new AbortController().signal })
    // A pure narrative changes admittedLastSeq but not one byte of the classifier prompt, so
    // the evidence-based fingerprint must still suppress the second classification.
    events.push({ type: 'assistant/message', seq: 5, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'I will continue with the next part.' }] } } })
    await handle({ agent: agent(events, []), signal: new AbortController().signal })
    expect(calls.map(entry => String(entry.prompt)).filter(isRouter)).toHaveLength(1)
  })

  it('classifies one snapshot once even when the stop boundary is reached repeatedly', async () => {
    const calls: Array<Record<string, unknown>> = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      if (isRouter(prompt)) return textStream(JSON.stringify({ kind: 'none', confidence: 1, reason: 'same subtask', candidateCallIds: [], checkpointSeqs: [] }))
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> T </score_B>')
    }
    const { handlers } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-cycle', createdAt: 1 }] })
    const events = [user(0, 'Do it'), call(1, 's1', 'subagent'), result(2, 's1', 'analysis'), call(3, 'e', 'edit'), result(4, 'e', 'edited')]
    const handle = handlers.get('agent/turn-stopping')!
    await handle({ agent: agent(events, []), signal: new AbortController().signal })
    await handle({ agent: agent(events, []), signal: new AbortController().signal })
    expect(calls.map(entry => String(entry.prompt)).filter(isRouter)).toHaveLength(1)
  })
})

/**
 * S03/S04 through the registered stop hook.
 *
 * S03: a task whose todos are complete AND that carries a real verification run must go
 * straight to the final acceptance instead of buying a progress score that cannot change
 * the next action — but only once per finished state, and never in place of an unprocessed
 * candidate selection.
 *
 * S04: a judge tie must reach the agent as a tie, not as "the first-listed candidate won".
 */
describe('delivery-phase scheduling and tie feedback', () => {
  const user = (seq: number, text: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const call = (seq: number, id: string, name: string) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
  const result = (seq: number, id: string, text: string, ok = true) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text, ...(ok ? {} : { isError: true }) }] } } })
  const todo = (seq: number, todos: unknown[]) => ({ type: 'todo/write', seq, data: { todos } })
  function agent(events: unknown[], steered: unknown[]) {
    return {
      id: 'agent-delivery',
      session: { header: { id: 'agent-delivery' }, snapshotEvents: () => events, requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }) },
      steer(message: unknown) { steered.push(message) },
    }
  }
  /** A finished-looking task: two changed todo snapshots, the second all-completed, plus a verification run. */
  const deliveryEvents = (verification = 'Tests 3 passed', ok = true) => [
    user(0, 'Implement and test it'),
    call(1, 'e', 'edit'), result(2, 'e', 'edited the file'),
    call(3, 't1', 'todo_write'), result(4, 't1', 'Updated todo list (2 items)'),
    todo(5, [{ content: 'Implement', status: 'in_progress' }, { content: 'Test', status: 'pending' }]),
    call(6, 'p', 'pwsh'), result(7, 'p', verification, ok),
    call(8, 't2', 'todo_write'), result(9, 't2', 'Updated todo list (0 pending)'),
    todo(10, [{ content: 'Implement', status: 'completed' }, { content: 'Test', status: 'completed' }]),
  ]
  /** Track prompts carry the progress tags; everything else is a pairwise judge call. */
  function deliveryStream(calls: Array<Record<string, unknown>>) {
    return (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      if (prompt.includes('<c1>')) return textStream('<c1> A </c1>\n<c2> A </c2>')
      return textStream('reasoning\n<score_A> ' + verdictLetter(section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + verdictLetter(section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')) + ' </score_B>')
    }
  }
  const isFinalCall = (prompt: string) => prompt.includes('TRAJECTORY_A')
  const isTrackCall = (prompt: string) => prompt.includes('<c1>')

  it('runs only the final acceptance for a delivery-ready task and records the skipped track', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers, rpc } = assemble(JUDGE, { stream: deliveryStream(calls), sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    const steered: unknown[] = []
    await handlers.get('agent/turn-stopping')!({ agent: agent(deliveryEvents(), steered), signal: new AbortController().signal })
    const prompts = calls.map(entry => String(entry.prompt))
    expect(prompts.filter(isTrackCall)).toHaveLength(0)
    // Exactly the final acceptance: 3 criteria x 2 rounds.
    expect(prompts.filter(isFinalCall)).toHaveLength(6)
    expect(JSON.stringify(steered)).not.toContain('routing: track')
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ toolName: string; verdict?: { outcome?: string }; route?: { skipReason?: string } }> } }
    const skipped = overview.value.recent.find(row => row.toolName === 'verifier_track' && row.verdict?.outcome === 'delivery-phase')
    expect(skipped?.route?.skipReason).toBe('delivery-phase')
  })

  it('does not skip routing twice on the same finished state', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers, rpc } = assemble(JUDGE, { stream: deliveryStream(calls), sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    const steered: unknown[] = []
    const handle = handlers.get('agent/turn-stopping')!
    const events = deliveryEvents()
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    // The completion signal was consumed by the first boundary, so the second BUYS the progress route
    // again instead of skipping it a second time. Under P04 that route then hands the boundary over to
    // the final acceptance (nothing was locatable), so the observable fact is the purchase itself,
    // not the wording of the steering message.
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ toolName: string; route?: { skipReason?: string } }> } }
    expect(overview.value.recent.filter(row => row.route?.skipReason === 'delivery-phase')).toHaveLength(1)
    expect(calls.some(entry => isTrackCall(String(entry.prompt)))).toBe(true)
    // The boundary still ends with a real steer: the gate message, not a generic "keep going".
    expect(JSON.stringify(steered)).toContain('Automatic verifier gate')
  })

  it('steers the located finding a track review reported instead of a generic continuation', async () => {
    const prompts: string[] = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      prompts.push(prompt)
      // A low progress score WITH a locatable finding: the boundary gets the finding, not a nudge.
      if (prompt.includes('<c1>')) return textStream('reasoning\n<finding checkpoint="c1" evidence="c1" action="run the suite">the parser test is still failing</finding>\n<c1> A </c1>\n<c2> A </c2>')
      return textStream('reasoning\n<score_A> T </score_A>\n<score_B> Q </score_B>')
    }
    const { handlers, rpc } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    const steered: unknown[] = []
    const handle = handlers.get('agent/turn-stopping')!
    const events = deliveryEvents()
    // First boundary consumes the delivery signal (final acceptance only); the second buys track.
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    const afterFirst = steered.length
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    const text = JSON.stringify(steered.slice(afterFirst))
    expect(prompts.some(prompt => prompt.includes('<finding checkpoint="c1"'))).toBe(true)
    expect(text).toContain('Located findings from the judge')
    expect(text).toContain('[c1] (evidence: c1) the parser test is still failing')
    expect(text).toContain('try: run the suite')
    // P04: no generic instruction, and the boundary was NOT handed to the gate.
    expect(text).not.toContain('Continue the unfinished work')
    expect(text).not.toContain('Automatic verifier gate')
    const overview = await rpc.get('/llm-verifier')!('statistics', { fromMs: 0, toMs: Date.now() + 60_000 }) as { value: { recent: Array<{ route?: { skipReason?: string } }> } }
    expect(overview.value.recent.some(row => row.route?.skipReason === 'no-diagnostics')).toBe(false)
  })

  it('re-arms the fast path when a NEW verification run appears', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: deliveryStream(calls), sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    const steered: unknown[] = []
    const handle = handlers.get('agent/turn-stopping')!
    const events = deliveryEvents()
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    events.push(call(11, 'p2', 'pwsh'), result(12, 'p2', 'Tests 4 passed'))
    await handle({ agent: agent(events, steered), signal: new AbortController().signal })
    expect(JSON.stringify(steered)).not.toContain('routing: track')
    expect(calls.map(entry => String(entry.prompt)).filter(isTrackCall)).toHaveLength(0)
  })

  it('still shows a FAILED verification run to the final judge', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: deliveryStream(calls), sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    await handlers.get('agent/turn-stopping')!({ agent: agent(deliveryEvents('Tests 3 failed', false), []), signal: new AbortController().signal })
    // Skipping the progress route must not hide the failure: the judge still reads it.
    expect(calls.some(entry => String(entry.prompt).includes('Tests 3 failed'))).toBe(true)
  })

  it('reports a routed comparison tie as a tie, not as a winner', async () => {
    const calls: Array<Record<string, unknown>> = []
    const stream = (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      if (prompt.includes('conservative verifier router')) return textStream(JSON.stringify({ kind: 'compare', confidence: 1, reason: 'two alternatives', candidateCallIds: ['s1', 's2'], checkpointSeqs: [] }))
      // The judge rates both sides identically.
      return textStream('reasoning\n<score_A> A </score_A>\n<score_B> A </score_B>')
    }
    const { handlers } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-delivery', createdAt: 1 }] })
    const steered: unknown[] = []
    const events = [
      user(0, 'Pick the better one and build it'),
      call(1, 's1', 'subagent'), result(2, 's1', 'frontend analysis'),
      call(3, 's2', 'subagent'), result(4, 's2', 'backend analysis'),
      call(5, 'e', 'edit'), result(6, 'e', 'edited the file'),
    ]
    await handlers.get('agent/turn-stopping')!({ agent: agent(events, steered), signal: new AbortController().signal })
    const rendered = JSON.stringify(steered)
    expect(rendered).toContain('NO unique winner')
    expect(rendered).not.toContain('Winner: ')
  })
})

/**
 * S02 through the registered `agent/pre-step` waterfall.
 *
 * The entry must be narrow: only a completed trusted workflow candidate envelope, only
 * compare/select, injected into the CURRENT step. Everything else — track, semantic
 * classification, the final gate, generation, a fresh user task, a rejected step — either
 * belongs to the stop boundary or is the host's own decision to keep.
 */
describe('early candidate review through agent/pre-step', () => {
  const user = (seq: number, text: string) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const call = (seq: number, id: string, name: string) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
  const result = (seq: number, id: string, text: string) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text }] } } })
  const todo = (seq: number, todos: unknown[]) => ({ type: 'todo/write', seq, data: { todos } })
  function agent(events: unknown[], header: Record<string, unknown> = { id: 'agent-pre' }) {
    return {
      id: 'agent-pre',
      session: { header, snapshotEvents: () => events, requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }) },
      steer() {},
    }
  }
  const envelope = (rows: unknown[]) => JSON.stringify({ protocol: 'dsh-verifier-candidates', version: 1, groupId: 'g', candidates: rows })
  const candidate = (id: string, content: string) => ({ id, label: 'C' + id, status: 'completed', content })
  const workflowEvents = (rows: unknown[]) => [
    user(0, 'Pick one implementation and build it'),
    call(1, 'w', 'workflow'),
    result(2, 'w', 'workflow "w" completed (' + rows.length + ' agents).\nReturn value:\n' + envelope(rows)),
  ]
  const signal = () => new AbortController().signal
  const nextEnter = (messages: unknown[] = []) => async () => ({ kind: 'enter', messages })
  const judgeCalls = (calls: Array<Record<string, unknown>>) => calls.filter(entry => String(entry.prompt).includes('TRAJECTORY_A'))
  /** Records every prompt, unlike scriptedStream (which records route fields for cost assertions). */
  function reviewStream(calls: Array<Record<string, unknown>>) {
    return (options: { messages: readonly unknown[] }) => {
      const prompt = promptText(options)
      calls.push({ prompt })
      return textStream('reasoning\n<score_A> ' + verdictLetter(section(prompt, 'TRAJECTORY_A') || section(prompt, 'PROPOSAL_A')) + ' </score_A>\n<score_B> ' + verdictLetter(section(prompt, 'TRAJECTORY_B') || section(prompt, 'PROPOSAL_B')) + ' </score_B>')
    }
  }

  it('scores a finished candidate envelope and injects the result into the current step', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: reviewStream(calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'candidate one'), candidate('2', 'candidate two')])), messages: [], turn: 1, step: 2, signal: signal() }, nextEnter())
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(1)
    expect(JSON.stringify(decision.messages)).toContain('Automatic verifier routing: compare')
    // The judge ran before the next request: 3 criteria x 2 swapped rounds.
    expect(judgeCalls(calls)).toHaveLength(6)
  })

  it('does not re-buy the same pair at the following stop boundary', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: reviewStream(calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const events = workflowEvents([candidate('1', 'candidate one'), candidate('2', 'candidate two')])
    const target = agent(events)
    const payload = { agent: target, messages: [], turn: 1, step: 2, signal: signal() }
    await handlers.get('agent/pre-step')!(payload, nextEnter())
    const afterPreStep = judgeCalls(calls).length
    await handlers.get('agent/turn-stopping')!({ agent: target, signal: signal() })
    // The router fingerprint is shared, so the stop boundary sees the object as processed.
    expect(judgeCalls(calls)).toHaveLength(afterPreStep)
  })

  it('short-circuits byte-identical candidates without a model call and says so', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: reviewStream(calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const rows = [candidate('1', 'identical body'), candidate('2', 'identical body')]
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents(rows)), messages: [], turn: 1, step: 2, signal: signal() }, nextEnter())
    expect(calls).toHaveLength(0)
    expect(JSON.stringify(decision.messages)).toContain('byte-identical')
  })

  it('stays out of a continuation a downstream listener cleared', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: reviewStream(calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    // The step was OFFERED a message and the deciding listener came back with none: that is a
    // cleared continuation, not an empty tool-follow-up, and injecting would resurrect it.
    const offered = [{ source: { kind: 'goal' }, content: [{ type: 'text', text: 'continue' }] }]
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: offered, turn: 1, step: 2, signal: signal() }, async () => ({ kind: 'enter', messages: [] }))
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(calls).toHaveLength(0)
  })

  it('respects a rejected step and never resurrects it with an injected prompt', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: [], turn: 1, step: 2, signal: signal() }, async () => ({ kind: 'reject' }))
    expect(decision).toEqual({ kind: 'reject' })
    expect(calls).toHaveLength(0)
  })

  it('leaves an empty FIRST step alone (the host would otherwise end the turn)', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const base = { kind: 'enter' as const, messages: [] }
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: [], turn: 1, step: 1, signal: signal() }, async () => base)
    expect(decision).toBe(base)
    expect(calls).toHaveLength(0)
  })

  it('does not rewrite a step carrying a fresh direct or team task', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const hostMessages = [{ source: { kind: 'user' }, content: [] }]
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: hostMessages, turn: 1, step: 2, signal: signal() }, nextEnter(hostMessages))
    expect(decision.messages).toBe(hostMessages)
    expect(calls).toHaveLength(0)
  })

  it('skips child sessions unless they are gated and stays out of strict mode', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const child = agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')]), { id: 'agent-pre', origin: 'subagent' })
    const childDecision = await handlers.get('agent/pre-step')!({ agent: child, messages: [], turn: 1, step: 2, signal: signal() }, nextEnter())
    expect(childDecision.messages).toHaveLength(0)
    expect(calls).toHaveLength(0)

    const strictCalls: Array<Record<string, unknown>> = []
    const strict = assemble({ ...JUDGE, autoVerifyMode: 'strict' }, { stream: scriptedStream(1, [], strictCalls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const strictDecision = await strict.handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: [], turn: 1, step: 2, signal: signal() }, nextEnter())
    expect(strictDecision.messages).toHaveLength(0)
    expect(strictCalls).toHaveLength(0)
  })

  it('leaves a progress-only (track) route to the stop boundary', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { handlers } = assemble(JUDGE, { stream: scriptedStream(1, [], calls), sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const events = [
      user(0, 'Implement it'),
      todo(1, [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }]),
      todo(2, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }]),
    ]
    const base = { kind: 'enter' as const, messages: [] }
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(events), messages: [], turn: 1, step: 2, signal: signal() }, async () => base)
    expect(decision).toBe(base)
    expect(calls).toHaveLength(0)
  })

  it('falls back to the host decision and warns when the early review fails', async () => {
    const stream = () => (async function* () { throw new Error('judge exploded') })()
    const { handlers, warnings } = assemble(JUDGE, { stream, sessions: [{ id: 'agent-pre', createdAt: 1 }] })
    const base = { kind: 'enter' as const, messages: [] }
    const decision = await handlers.get('agent/pre-step')!({ agent: agent(workflowEvents([candidate('1', 'a'), candidate('2', 'b')])), messages: [], turn: 1, step: 2, signal: signal() }, async () => base)
    expect(decision).toBe(base)
    expect(warnings.some(warning => warning.includes('early candidate review failed'))).toBe(true)
  })
})
