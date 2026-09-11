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
  const ctx = {
    inject() {}, on() {}, effect() {},
    get() { return undefined },
    logger: { warn(value: unknown) { warnings.push(String(value)) }, info() {}, error() {}, debug() {} },
    tools: { register(definition: never) { tools.set((definition as unknown as { name: string }).name, definition as never) } },
    agents: { currentInitiator() { return undefined } },
    llm: { resolveCallConfig: async () => ({}) },
    attachments: {}, connection: {}, sessionPersistence: {},
  } as unknown as Context
  apply(ctx, config as never)
  return { tools, warnings }
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

  it('survives an unavailable settings service and an unregistered connection', () => {
    const { tools, warnings } = assemble()
    expect(tools.size).toBe(4)
    expect(warnings).toEqual([])
  })
})
