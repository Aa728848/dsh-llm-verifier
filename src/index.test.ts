import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from './index.ts'

/**
 * Assembly-level contract for the four registered tools.
 *
 * Deliberately narrow: it exercises registration and the argument caps that must
 * reject a model-driven call BEFORE any model/topic work happens, both of which
 * were previously uncovered (every other module has a sibling spec).
 */
function assemble(config: Record<string, unknown> = {}) {
  const tools = new Map<string, { output: { schema: { properties: Record<string, unknown> } }; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const warnings: string[] = []
  const rpc = new Map<string, (endpoint: string, payload: unknown) => unknown>()
  const ctx = {
    inject() {}, on() {}, effect() {},
    get() { return undefined },
    logger: { warn(value: unknown) { warnings.push(String(value)) }, info() {}, error() {}, debug() {} },
    tools: { register(definition: never) { tools.set((definition as unknown as { name: string }).name, definition as never) } },
    agents: { currentInitiator() { return undefined } },
    llm: { resolveCallConfig: async () => ({}) },
    attachments: {}, sessionPersistence: {},
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

  it('survives an unavailable settings service and an unregistered connection', () => {
    const { tools, warnings } = assemble()
    expect(tools.size).toBe(4)
    expect(warnings).toEqual([])
  })
})
