import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from './index.ts'

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
  const ctx = {
    inject() {}, on() {}, effect() {},
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
  return { tools, warnings, rpc }
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

  it('survives an unavailable settings service and an unregistered connection', () => {
    const { tools, warnings } = assemble()
    expect(tools.size).toBe(5)
    expect(warnings).toEqual([])
  })
})

/** Minimal text stream in the shape BlockAssembler consumes. */
function textStream(text: string) {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
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
 */
function scriptedStream(strongDraft: number, failing: readonly number[], calls: Array<Record<string, unknown>>) {
  return (options: { messages: readonly unknown[]; provider?: string; model?: string; temperature?: number; maxTokens?: number; reasoningEffort?: string }) => {
    const prompt = promptText(options)
    calls.push({ provider: options.provider, model: options.model, temperature: options.temperature, maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort })
    const draft = /Draft (\d+) of \d+\./.exec(prompt)
    if (draft !== null) {
      const number = Number(draft[1])
      if (failing.includes(number)) return (async function* () { throw new Error('draft ' + number + ' exploded') })()
      // Distinct per draft number: byte-identical drafts would (correctly) be collapsed by the
      // engine before the tournament, which changes the cost this suite measures.
      return textStream((number === strongDraft ? STRONG_DRAFT : WEAK_DRAFT) + ' Draft ' + number + '.')
    }
    return textStream('reasoning\n<score_A> ' + verdictLetter(section(prompt, 'TRAJECTORY_A')) + ' </score_A>\n<score_B> ' + verdictLetter(section(prompt, 'TRAJECTORY_B')) + ' </score_B>')
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
      expect(call.maxTokens).toBe(4096)
      expect(call.reasoningEffort).toBe('high')
    }
    expect(calls.filter(call => call.model === 'judge-model').length).toBeGreaterThan(3)
    // The reported cost covers the drafts as well as every judge call.
    expect(result.calls).toBe(calls.length)
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
