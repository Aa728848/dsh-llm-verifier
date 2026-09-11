import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { analyzeStructuredRoute, AutoVerifierRouter, boundDecision, buildSemanticRoutePrompt, estimateRoutedCalls, latestDirectUserSeq, MAX_ROUTED_CHECKPOINTS, parseSemanticRoute, semanticDecision, semanticRouteHint, type RouterPolicy } from './router.ts'
import { sanitizeVerifierText } from './session.ts'

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
  it('attaches the latest observed tool output to every progress checkpoint', () => {
    const value = session()
    const todos = [{ content: 'Implement', status: 'pending' as const }, { content: 'Test', status: 'pending' as const }]
    value.append('todo/write', { todos })
    tool(value, 'pwsh', 'run', 'all tests passed: 91 passed')
    value.append('todo/write', { todos: [{ content: 'Implement', status: 'completed' }, { content: 'Test', status: 'completed' }] })
    const decision = analyzeStructuredRoute(value.events, 8, 400, 800)
    expect(decision?.kind).toBe('track')
    if (decision?.kind === 'track') {
      // A checkpoint rendered from todo text alone can never clear the threshold.
      // Checkpoint 1 precedes any tool output, so it carries none; checkpoint 2
      // must carry the run that proves the todos were actually completed.
      expect(decision.steps[0]).not.toContain('Latest observed tool output')
      expect(decision.steps[1]).toContain('all tests passed')
      expect(decision.steps.every(step => step.length <= 400)).toBe(true)
    }
  })
  it('deduplicates identical todo snapshots', () => {
    const value = session()
    const todos = [{ content: 'Implement', status: 'in_progress' as const }, { content: 'Test', status: 'pending' as const }]
    value.append('todo/write', { todos }); value.append('todo/write', { todos })
    expect(analyzeStructuredRoute(value.events)).toBeUndefined()
    value.append('todo/write', { todos: [{ content: 'Implement', status: 'completed' }, { content: 'Test', status: 'in_progress' }] })
    expect(analyzeStructuredRoute(value.events)).toMatchObject({ kind: 'track', evidenceSeqs: expect.any(Array) })
  })
  it('keeps a decision whose items were truncated exactly to the per-item cap', () => {
    const value = session()
    const long = 'x'.repeat(900)
    tool(value, 'workflow', 'w', JSON.stringify({ protocol: 'dsh-verifier-candidates', version: 1, groupId: 'g', candidates: [0, 1, 2].map(index => ({ id: 'c' + index, status: 'completed', content: long })) }))
    const decision = analyzeStructuredRoute(value.events, 8, 200)
    expect(decision).toBeDefined()
    // The truncation notice is part of the sanitized value, so it must still fit
    // inside the same cap — otherwise boundDecision() drops the whole route.
    expect(sanitizeVerifierText(long, 200).length).toBeLessThanOrEqual(200)
    expect(boundDecision(decision, { ...policy, maxItemChars: 200 })).toBeDefined()
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
    // A verbose justification is formatting noise, not a routing failure.
    const verbose = parseSemanticRoute(JSON.stringify({ ...JSON.parse(valid), reason: 'because '.repeat(200) }))
    expect(verbose?.kind).toBe('compare')
    expect(verbose!.reason.length).toBe(500)
  })
  it('resolves only real paired call ids', () => {
    const value = session(); tool(value, 'subagent', 'a', 'candidate A'); tool(value, 'subagent', 'b', 'candidate B')
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'compare', confidence: .95, reason: 'same task alternatives', candidateCallIds: ['a', 'b'], checkpointSeqs: [] }))!
    expect(semanticDecision(parsed, value.events)).toMatchObject({ kind: 'compare', source: 'semantic' })
    expect(semanticDecision({ ...parsed, candidateCallIds: ['a', 'missing'] }, value.events)).toBeUndefined()
    expect(buildSemanticRoutePrompt('problem', value.events, 5)).toContain('candidateCallIds')
  })
  it('resolves candidates emitted via PTC mode tool/code-dispatch', () => {
    const value = session()
    value.append('tool/code-dispatch', { subCallId: 'c-1' as never, name: 'subagent', arguments: '{}', isError: false, content: [{ type: 'text', text: 'candidate 1 content' }] })
    value.append('tool/code-dispatch', { subCallId: 'c-2' as never, name: 'subagent', arguments: '{}', isError: false, content: [{ type: 'text', text: 'candidate 2 content' }] })
    expect(semanticRouteHint(value.events)).toBe(true)
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'compare', confidence: 0.92, reason: 'PTC alternatives', candidateCallIds: ['c-1', 'c-2'], checkpointSeqs: [] }))!
    expect(semanticDecision(parsed, value.events)).toMatchObject({ kind: 'compare', source: 'semantic' })
  })

  it('resolves candidates emitted via Session V3 tool/ptc-dispatch', () => {
    const value = session()
    value.append('tool/ptc-dispatch' as never, { subCallId: 'ptc-1', name: 'subagent', arguments: '{}', isError: false, content: [{ type: 'text', text: 'candidate A from ptc' }] } as never)
    value.append('tool/ptc-dispatch' as never, { subCallId: 'ptc-2', name: 'subagent', arguments: '{}', isError: false, content: [{ type: 'text', text: 'candidate B from ptc' }] } as never)
    expect(semanticRouteHint(value.events)).toBe(true)
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'compare', confidence: 0.95, reason: 'V3 PTC alternatives', candidateCallIds: ['ptc-1', 'ptc-2'], checkpointSeqs: [] }))!
    expect(semanticDecision(parsed, value.events)).toMatchObject({ kind: 'compare', source: 'semantic' })
  })

  it('keeps checkpoint evidence within the per-item cap even for long tool names', () => {
    // Regression: a fixed 60-character deduction let a long MCP tool name push the
    // rendered step past maxItemChars, and boundDecision() then dropped the decision.
    const value = session()
    const longName = 'mcp__codegraph__' + 'x'.repeat(60)
    tool(value, longName, 'long-a', 'Y'.repeat(6000))
    value.append('todo/write', { todos: [{ content: 'Implement', status: 'in_progress' }, { content: 'Test', status: 'pending' }] })
    tool(value, longName, 'long-b', 'Z'.repeat(6000))
    value.append('todo/write', { todos: [{ content: 'Implement', status: 'completed' }, { content: 'Test', status: 'completed' }] })
    for (const maxItemChars of [128, 140, 160, 2000, 20000]) {
      const decision = analyzeStructuredRoute(value.events, 8, maxItemChars, Math.max(60000, maxItemChars * 2))
      expect(decision, 'maxItemChars=' + maxItemChars).toMatchObject({ kind: 'track' })
      const bounded = boundDecision(decision, { ...policy, maxItemChars, maxInputChars: Math.max(60000, maxItemChars * 2) })
      expect(bounded, 'maxItemChars=' + maxItemChars).toBeDefined()
      if (decision?.kind === 'track') {
        for (const step of decision.steps) expect(step.length, 'maxItemChars=' + maxItemChars).toBeLessThanOrEqual(maxItemChars)
      }
    }
  })

  it('caps routed checkpoints so a long task keeps its progress route', () => {
    // Regression: every changed todo snapshot used to become a step, and once their
    // combined length passed maxInputChars, boundDecision() dropped the whole route —
    // so long tasks silently lost progress verification (smart mode even paid for a
    // semantic classification that produced the same oversized decision).
    const value = session()
    for (let index = 0; index < 20; index += 1) {
      tool(value, 'pwsh', 'run-' + index, 'output-' + index + ' ' + 'x'.repeat(5000))
      value.append('todo/write', { todos: [{ content: 'Step ' + index, status: index === 19 ? 'completed' : 'in_progress' }, { content: 'Test', status: 'pending' }] })
    }
    const decision = analyzeStructuredRoute(value.events, 8, 20000, 60000)
    expect(decision).toMatchObject({ kind: 'track' })
    if (decision?.kind !== 'track') return
    expect(decision.steps).toHaveLength(MAX_ROUTED_CHECKPOINTS)
    expect(decision.evidenceSeqs).toHaveLength(MAX_ROUTED_CHECKPOINTS)
    // Only the most recent checkpoints survive, and the oldest kept one says so.
    expect(decision.steps.join('\n')).not.toContain('Step 0')
    expect(decision.steps[0]).toContain('Earlier 14 checkpoint(s) omitted')
    expect(decision.steps.at(-1)).toContain('Step 19')
    expect(decision.steps.every(step => step.length <= 20000)).toBe(true)
    expect(decision.steps.reduce((sum, step) => sum + step.length, 0)).toBeLessThanOrEqual(60000)
    expect(boundDecision(decision, { ...policy, maxItemChars: 20000, maxInputChars: 60000 })).toBeDefined()
  })

  it('splits the route input budget across candidates so a wide select survives', () => {
    // Same failure class as the checkpoint cap: 8 candidates x maxItemChars exceeded
    // the combined cap, and boundDecision() dropped the whole select.
    const value = session()
    tool(value, 'workflow', 'w', JSON.stringify({
      protocol: 'dsh-verifier-candidates',
      version: 1,
      groupId: 'wide',
      candidates: Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, label: 'C' + i, status: 'completed', content: 'candidate ' + i + ' ' + 'z'.repeat(20000) })),
    }))
    const decision = analyzeStructuredRoute(value.events, 8, 20000, 60000)
    expect(decision?.kind).toBe('select')
    if (decision?.kind !== 'select') return
    expect(decision.candidates).toHaveLength(8)
    expect(decision.candidates.every(candidate => candidate.content.length <= 20000)).toBe(true)
    expect(decision.candidates.reduce((sum, candidate) => sum + candidate.content.length, 0)).toBeLessThanOrEqual(60000)
    expect(boundDecision(decision, { ...policy, maxItemChars: 20000, maxInputChars: 60000 })).toBeDefined()
  })

  it('splits the route input budget across semantic candidates', () => {
    // The classification call is already paid for here, so dropping the decision
    // instead of routing it is pure waste.
    const value = session()
    const ids = Array.from({ length: 8 }, (_, i) => 'sem-' + i)
    ids.forEach((id, i) => tool(value, 'workflow', id, 'semantic candidate ' + i + ' ' + 'q'.repeat(20000)))
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'select', confidence: 0.95, reason: 'alternatives', candidateCallIds: ids, checkpointSeqs: [] }), 8)
    expect(parsed?.kind).toBe('select')
    const decision = semanticDecision(parsed!, value.events, 20000, 60000)
    expect(decision?.kind).toBe('select')
    if (decision?.kind !== 'select') return
    expect(decision.candidates).toHaveLength(8)
    expect(decision.candidates.reduce((sum, candidate) => sum + candidate.content.length, 0)).toBeLessThanOrEqual(60000)
    expect(boundDecision(decision, { ...policy, maxItemChars: 20000, maxInputChars: 60000 })).toBeDefined()
  })

    it('caps semantic checkpoints with the same budget split', () => {
    const value = session()
    const seqs: number[] = []
    for (let index = 0; index < 9; index += 1) {
      tool(value, 'pwsh', 'run-' + index, 'output-' + index + ' ' + 'y'.repeat(4000))
      value.append('todo/write', { todos: [{ content: 'Step ' + index, status: 'in_progress' }, { content: 'Test', status: 'pending' }] })
      seqs.push(value.events.at(-1)!.seq)
    }
    const parsed = parseSemanticRoute(JSON.stringify({ kind: 'track', confidence: 0.95, reason: 'progress', candidateCallIds: [], checkpointSeqs: seqs }), 8)
    expect(parsed?.kind).toBe('track')
    const decision = semanticDecision(parsed!, value.events, 20000, 60000)
    expect(decision?.kind).toBe('track')
    if (decision?.kind !== 'track') return
    expect(decision.steps).toHaveLength(MAX_ROUTED_CHECKPOINTS)
    expect(decision.steps[0]).toContain('Earlier 3 checkpoint(s) omitted')
    expect(decision.steps.reduce((sum, step) => sum + step.length, 0)).toBeLessThanOrEqual(60000)
    expect(boundDecision(decision, { ...policy, maxItemChars: 20000, maxInputChars: 60000 })).toBeDefined()
  })

  it('routes progress tracking based on changed team/task snapshots', () => {
    const value = session()
    value.append('team/task' as never, { task: { id: 'task-1', revision: 1, subject: 'Backend API', status: 'in_progress' } } as never)
    value.append('team/task' as never, { task: { id: 'task-1', revision: 2, subject: 'Backend API', status: 'completed' } } as never)
    expect(semanticRouteHint(value.events)).toBe(true)
    const decision = analyzeStructuredRoute(value.events)
    expect(decision).toMatchObject({ kind: 'track', source: 'structured', reason: 'changed durable team tasks' })
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
  it('does not arm final verification when a plan pre-review passes', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    const plan = router.reserve(agent, 'plan_review', 'plan', 1, policy)!
    expect(router.commit(agent, plan)).toBe(true)
    // Approving a plan is not completed work: the next stop boundary must go through the
    // normal eligibility check instead of a forced full-session verification.
    expect(router.finalRequired(agent)).toBeUndefined()
    const route = router.reserve(agent, 'compare', 'route', 4, policy)!
    expect(router.commit(agent, route, 9)).toBe(true); expect(router.finalRequired(agent)).toBe(9)
  })
  it('treats a team message as the task boundary so teammate sessions can reserve', () => {
    const value = Session.create('session-00000000-0000-4000-8000-000000000078' as never)
    value.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Implement the assigned team task' }], source: { kind: 'team-message' } as never }), { surfaceOp: 'append' })
    expect(latestDirectUserSeq(value.events)).toBe(value.events.at(-1)!.seq)
    const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    // Without the team-message boundary the router state is undefined and this is refused.
    expect(router.reserve(agent, 'team_task', 'task-1', 1, policy)).toBeDefined()
  })
  it('releases in-flight state after failure and strict remains blocked', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    const first = router.reserve(agent, 'compare', 'route-a', 4, { ...policy, mode: 'strict' })!
    router.fail(agent, first, true); expect(router.strictBlocked(agent)).toBe(true)
    expect(router.reserve(agent, 'compare', 'route-b', 4, { ...policy, mode: 'strict' })).toBeDefined()
  })
  it('delivers the budget-exhaustion notice at most once per task', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    expect(router.claimExhaustedNotice(agent)).toBe(true)
    expect(router.claimExhaustedNotice(agent)).toBe(false)
    // A new direct user task starts a fresh task budget and may notify again.
    value.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'next task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(router.claimExhaustedNotice(agent)).toBe(true)
  })
  it('estimates routed calls from the real tournament shape', () => {
    const candidate = { id: 'c', groupId: 'g', label: 'c', content: 'x', callId: 'a', fromSeq: 1, toSeq: 2 }
    const base = { source: 'structured' as const, confidence: 1, reason: 'r', fingerprint: 'f' }
    expect(estimateRoutedCalls({ ...base, kind: 'compare', candidates: [candidate, candidate] }, 1, 3)).toBe(3)
    expect(estimateRoutedCalls({ ...base, kind: 'track', steps: ['a', 'b'], checkpoints: [1, 2], evidenceSeqs: [1, 2] }, 2, 3)).toBe(2)
    // 8 candidates: 8 ring edges + 10 pivot-round edges = 18 comparisons x 3 criteria.
    const many = Array.from({ length: 8 }, () => candidate)
    expect(estimateRoutedCalls({ ...base, kind: 'select', candidates: many }, 1, 3)).toBe(54)
  })
  it('reports budget exhaustion without touching reservations', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    // policy caps the task at 48 model calls.
    expect(router.budgetExhausted(agent, 48, policy)).toBe(false)
    expect(router.budgetExhausted(agent, 49, policy)).toBe(true)
    // The shipped default (64) covers a full 8-candidate tournament: 54 calls.
    expect(router.budgetExhausted(agent, 54, { ...policy, maxModelCallsPerTask: 64 })).toBe(false)
    expect(router.budgetExhausted(agent, 65, { ...policy, maxModelCallsPerTask: 64 })).toBe(true)
  })
  it('enforces manual mode and unified model-call budgets', () => {
    const value = session(); const agent = { id: value.id, session: value }; const router = new AutoVerifierRouter()
    expect(router.reserve(agent, 'compare', 'manual', 1, { ...policy, mode: 'manual' })).toBeUndefined()
    expect(router.reserve(agent, 'select', 'expensive', 49, policy)).toBeUndefined()
  })
})
