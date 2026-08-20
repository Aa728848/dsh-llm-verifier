import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { analyzeStructuredRoute, AutoVerifierRouter, buildSemanticRoutePrompt, parseSemanticRoute, semanticDecision, semanticRouteHint, type RouterPolicy } from './router.ts'

function session() {
  const value = Session.create('session-00000000-0000-4000-8000-000000000077' as never)
  value.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Choose and implement the best solution' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return value
}
function tool(value: ReturnType<typeof session>, name: string, id: string, text: string, turn = 1, step = 1) {
  value.append('tool/call', { turn, step, callId: id as never, name, arguments: '{}' })
  value.append('tool/result', { turn, step, message: createToolResultMessage({ callId: id as never, content: [{ type: 'text', text }], isError: false }) }, { surfaceOp: 'append' })
}
const policy: RouterPolicy = { mode: 'smart', minConfidence: .9, maxCandidates: 8, maxPerTask: 5, maxPerSession: 20, maxModelCallsPerTask: 48, maxModelCallsPerSession: 160, maxInputChars: 60000, maxItemChars: 20000 }
const envelope = (count: number) => JSON.stringify({ protocol: 'dsh-verifier-candidates', version: 1, groupId: 'auth', candidates: Array.from({ length: count }, (_, i) => ({ id: String(i + 1), label: 'C' + (i + 1), status: 'completed', content: 'candidate ' + (i + 1) })) })

describe('production structured routing', () => {
  it('requires a trusted versioned workflow envelope', () => {
    const value = session(); tool(value, 'workflow', 'w', envelope(3))
    expect(analyzeStructuredRoute(value.events)).toMatchObject({ kind: 'select', source: 'structured' })
    const untrusted = session(); tool(untrusted, 'workflow', 'w', JSON.stringify({ verifier_candidates: ['a', 'b'] }))
    expect(analyzeStructuredRoute(untrusted.events)).toBeUndefined()
  })
  it('does not guess that unrelated synchronous subagents are alternatives', () => {
    const value = session(); tool(value, 'subagent', 'a', 'frontend analysis', 1, 2); tool(value, 'subagent', 'b', 'backend analysis', 1, 2)
    expect(analyzeStructuredRoute(value.events)).toBeUndefined()
    expect(semanticRouteHint(value.events)).toBe(true)
  })
  it('deduplicates identical todo snapshots', () => {
    const value = session()
    const todos = [{ content: 'Implement', status: 'in_progress' as const }, { content: 'Test', status: 'pending' as const }]
    value.append('todo/write', { todos }); value.append('todo/write', { todos })
    expect(analyzeStructuredRoute(value.events)).toBeUndefined()
    value.append('todo/write', { todos: [{ content: 'Implement', status: 'completed' }, { content: 'Test', status: 'in_progress' }] })
    expect(analyzeStructuredRoute(value.events)).toMatchObject({ kind: 'track', evidenceSeqs: expect.any(Array) })
  })
  it('redacts and bounds trusted candidate content', () => {
    const value = session(); tool(value, 'workflow', 'w', JSON.stringify({ protocol: 'dsh-verifier-candidates', version: 1, groupId: 'g', candidates: [{ id: 'a', status: 'completed', content: 'token = abc ' + 'x'.repeat(100) }, { id: 'b', status: 'completed', content: 'password: secret ' + 'y'.repeat(100) }] }))
    const decision = analyzeStructuredRoute(value.events, 8, 40)
    expect(decision?.kind).toBe('compare')
    if (decision?.kind === 'compare') { expect(decision.candidates[0].content).not.toContain('abc'); expect(decision.candidates[0].content.length).toBeLessThan(80) }
  })
})

describe('semantic evidence references', () => {
  it('accepts exact strict JSON references and rejects prose/unknown keys', () => {
    const valid = JSON.stringify({ kind: 'compare', confidence: .95, reason: 'alternatives', candidateCallIds: ['a', 'b'], checkpointSeqs: [] })
    expect(parseSemanticRoute(valid)).toMatchObject({ kind: 'compare', candidateCallIds: ['a', 'b'] })
    expect(parseSemanticRoute('```json\n' + valid + '\n```')).toBeUndefined()
    expect(parseSemanticRoute(JSON.stringify({ ...JSON.parse(valid), extra: true }))).toBeUndefined()
  })
  it('resolves only real paired call ids', () => {
    const value = session(); tool(value, 'subagent', 'a', 'candidate A'); tool(value, 'subagent', 'b', 'candidate B')
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'compare', confidence: .95, reason: 'same task alternatives', candidateCallIds: ['a', 'b'], checkpointSeqs: [] }))!
    expect(semanticDecision(parsed, value.events)).toMatchObject({ kind: 'compare', source: 'semantic' })
    expect(semanticDecision({ ...parsed, candidateCallIds: ['a', 'missing'] }, value.events)).toBeUndefined()
    expect(buildSemanticRoutePrompt('problem', value.events, 5)).toContain('candidateCallIds')
  })
})

describe('transactional router state', () => {
  it('commits, requires final verification, and clears it only after final commit', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    const route = router.reserve(agent, 'compare', 'route', 4, policy)!
    expect(router.commit(agent, route, 9)).toBe(true); expect(router.finalRequired(agent)).toBe(9)
    const final = router.reserve(agent, 'final', 'final', 4, policy)!
    expect(router.commit(agent, final)).toBe(true); expect(router.finalRequired(agent)).toBeUndefined()
  })
  it('releases in-flight state after failure and strict remains blocked', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    const first = router.reserve(agent, 'compare', 'route-a', 4, { ...policy, mode: 'strict' })!
    router.fail(agent, first, true); expect(router.strictBlocked(agent)).toBe(true)
    expect(router.reserve(agent, 'compare', 'route-b', 4, { ...policy, mode: 'strict' })).toBeDefined()
  })
  it('enforces manual mode and unified model-call budgets', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    expect(router.reserve(agent, 'compare', 'manual', 1, { ...policy, mode: 'manual' })).toBeUndefined()
    expect(router.reserve(agent, 'select', 'expensive', 49, policy)).toBeUndefined()
  })
})
