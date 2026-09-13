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
function assemble(config: Record<string, unknown> = {}, options: { root?: string; initiator?: unknown; sessions?: unknown[] } = {}) {
  const tools = new Map<string, { output: { schema: { properties: Record<string, unknown> } }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const warnings: string[] = []
  const rpc = new Map<string, (endpoint: string, payload: unknown) => unknown>()
  const ctx = {
    inject() {}, on() {}, effect() {},
    get() { return undefined },
    logger: { warn(value: unknown) { warnings.push(String(value)) }, info() {}, error() {}, debug() {} },
    tools: { register(definition: never) { tools.set((definition as unknown as { name: string }).name, definition as never) } },
    agents: { currentInitiator() { return options.initiator } },
    llm: { resolveCallConfig: async () => ({}) },
    attachments: {},
    sessionPersistence: { root: options.root ?? tempDir(), list: async () => options.sessions ?? [] },
    // Older hosts answer statistics over the plugin RPC channel; capturing the handler
    // lets the payload contract be tested without any host I/O.
    connection: { rpc: { handle(channel: string, handler: (endpoint: string, payload: unknown) => unknown) { rpc.set(channel, handler) } } },
  } as unknown as Context
  apply(ctx, config as never)
  return { tools, warnings, rpc }
}

const exec = { agent: { id: 'agent-1', session: { header: { id: 'session-1' } } }, signal: new AbortController().signal }

describe('plugin assembly', () => {
  it('registers exactly the four verifier tools with ensemble-aware output schemas', () => {
    const { tools } = assemble()
    expect([...tools.keys()].sort()).toEqual(['verifier_compare', 'verifier_current_session', 'verifier_select', 'verifier_track'])
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
    expect(tools.size).toBe(4)
    expect(warnings).toEqual([])
  })
})
