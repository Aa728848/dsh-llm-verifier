import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AutoVerificationBudget, analyzeAutoTask, automaticFeedback, isSubagentSession } from './auto.ts'

function taskSession() {
  const session = Session.create('session-00000000-0000-4000-8000-000000000009' as never)
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Implement and test the feature' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return session
}

function call(session: ReturnType<typeof taskSession>, name: string, id: string) {
  session.append('tool/call', { turn: 1, step: 1, callId: id as never, name, arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: id as never, content: [{ type: 'text', text: 'ok' }], isError: false }) }, { surfaceOp: 'append' })
}

const smart = { mode: 'smart' as const, minToolCalls: 3, maxPerTask: 2, maxPerSession: 8, threshold: 0.65 }

/** A completed verifier_current_session call carrying a rendered verdict payload. */
function sessionVerify(session: ReturnType<typeof taskSession>, id: string, payload: string) {
  session.append('tool/call', { turn: 1, step: 1, callId: id as never, name: 'verifier_current_session', arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: id as never, content: [{ type: 'text', text: payload }], isError: false }) }, { surfaceOp: 'append' })
}
const verdict = (score: number, winner = 'A') => JSON.stringify({ sessionId: 's', problem: 'p', score, baselineScore: 0.2, winner, fromSeq: 0, toSeq: 9, omittedCharacters: 0, calls: 3, stats: {} })

describe('automatic verification policy', () => {
  it('requires consequential work and enough evidence in smart mode', () => {
    const session = taskSession()
    call(session, 'read', 'one')
    call(session, 'grep', 'two')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: false, reason: 'no-consequential-work' })
    call(session, 'edit', 'three')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: true, toolCalls: 3, consequentialToolCalls: 1 })
  })

  it('does not count a failed consequential call paired with an unrelated success', () => {
    const session = taskSession()
    session.append('tool/call', { turn: 1, step: 1, callId: 'bad' as never, name: 'edit', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'bad' as never, content: [{ type: 'text', text: 'failed' }], isError: true }), error: { name: 'Error', code: 'FAILED' } }, { surfaceOp: 'append' })
    call(session, 'read', 'good')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ consequentialToolCalls: 0, eligible: false, reason: 'no-consequential-work' })
  })

  it('strict mode accepts one completed consequential call', () => {
    const session = taskSession()
    call(session, 'ssh_exec', 'one')
    expect(analyzeAutoTask(session.events, { ...smart, mode: 'strict' })).toMatchObject({ eligible: true, reason: 'strict-eligible' })
  })

  it('suppresses the gate only for a passing manual verification that is still current', () => {
    // A passing review of the work as it stands clears the task.
    const accepted = taskSession()
    call(accepted, 'edit', 'one'); call(accepted, 'pwsh', 'two'); call(accepted, 'read', 'three')
    sessionVerify(accepted, 'four', verdict(0.81))
    expect(analyzeAutoTask(accepted.events, smart)).toMatchObject({ eligible: false, reason: 'already-verified', hasManualSessionVerification: true, manualVerificationAccepted: true })

    // A FAILING verdict must not disarm the gate (the old behaviour let it through).
    const failing = taskSession()
    call(failing, 'edit', 'one'); call(failing, 'pwsh', 'two'); call(failing, 'read', 'three')
    sessionVerify(failing, 'four', verdict(0.2, 'B'))
    expect(analyzeAutoTask(failing.events, smart)).toMatchObject({ eligible: true, hasManualSessionVerification: true, manualVerificationAccepted: false })

    // A pass below the configured threshold does not count either.
    const belowThreshold = taskSession()
    call(belowThreshold, 'edit', 'one'); call(belowThreshold, 'pwsh', 'two'); call(belowThreshold, 'read', 'three')
    sessionVerify(belowThreshold, 'four', verdict(0.5))
    expect(analyzeAutoTask(belowThreshold.events, smart)).toMatchObject({ eligible: true, manualVerificationAccepted: false })

    // A pass followed by more consequential work is stale.
    const stale = taskSession()
    call(stale, 'edit', 'one'); call(stale, 'pwsh', 'two'); call(stale, 'read', 'three')
    sessionVerify(stale, 'four', verdict(0.9))
    call(stale, 'edit', 'five')
    expect(analyzeAutoTask(stale.events, smart)).toMatchObject({ eligible: true, manualVerificationAccepted: false })

    // An unreadable result is never a pass.
    const unreadable = taskSession()
    call(unreadable, 'edit', 'one'); call(unreadable, 'pwsh', 'two'); call(unreadable, 'read', 'three')
    call(unreadable, 'verifier_current_session', 'four')
    expect(analyzeAutoTask(unreadable.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false })
  })

  it('treats a team message as the task boundary for teammate sessions', () => {
    const session = Session.create('session-00000000-0000-4000-8000-000000000010' as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Implement the assigned team task' }], source: { kind: 'team-message' } as never }), { surfaceOp: 'append' })
    call(session, 'edit', 'one'); call(session, 'pwsh', 'two'); call(session, 'read', 'three')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: true, consequentialToolCalls: 2 })
  })

  it('resets per-task attempts for a new direct user message and enforces the session cap', () => {
    const session = taskSession()
    call(session, 'edit', 'one')
    call(session, 'read', 'two')
    call(session, 'pwsh', 'three')
    const agent = { id: session.id, session } as never
    const budget = new AutoVerificationBudget()
    const policy = { ...smart, maxPerTask: 1, maxPerSession: 2 }
    expect(budget.claim(agent, analyzeAutoTask(session.events, policy), policy)).toBe(true)
    expect(budget.claim(agent, analyzeAutoTask(session.events, policy), policy)).toBe(false)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Do another task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    call(session, 'write', 'four')
    call(session, 'read', 'five')
    call(session, 'pwsh', 'six')
    expect(budget.claim(agent, analyzeAutoTask(session.events, policy), policy)).toBe(true)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Third task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    call(session, 'edit', 'seven')
    call(session, 'read', 'eight')
    call(session, 'pwsh', 'nine')
    expect(budget.claim(agent, analyzeAutoTask(session.events, policy), policy)).toBe(false)
  })

  it('recognizes delegated child sessions that must not be gated by default', () => {
    expect(isSubagentSession(undefined)).toBe(false)
    expect(isSubagentSession({ session: {} })).toBe(false)
    expect(isSubagentSession({ session: { header: { id: 's1' } } })).toBe(false)
    expect(isSubagentSession({ session: { header: { id: 's2', origin: 'subagent' } } })).toBe(true)
    expect(isSubagentSession({ session: { header: { id: 's3', parentSession: 's1' } } })).toBe(true)
  })

  it('builds actionable low-score feedback', () => {
    expect(automaticFeedback(0.42, 0.31, 'A', 0.65)).toContain('42.0%')
    expect(automaticFeedback(0.42, 0.31, 'A', 0.65)).toContain('verification command')
  })

  it('recognizes PTC mode tool/code-dispatch events for eligibility', () => {
    const session = taskSession()
    session.append('tool/code-dispatch', { subCallId: 'c1' as never, name: 'read', arguments: '{}', isError: false, content: [{ type: 'text', text: 'data' }] })
    session.append('tool/code-dispatch', { subCallId: 'c2' as never, name: 'grep', arguments: '{}', isError: false, content: [{ type: 'text', text: 'match' }] })
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: false, reason: 'no-consequential-work' })
    session.append('tool/code-dispatch', { subCallId: 'c3' as never, name: 'edit', arguments: '{}', isError: false, content: [{ type: 'text', text: 'done' }] })
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: true, toolCalls: 3, consequentialToolCalls: 1 })
  })

  it('counts DSH 0.1.5 tool/ptc-dispatch events the same way', () => {
    const session = taskSession()
    session.append('tool/ptc-dispatch' as never, { subCallId: 'p1', name: 'read', arguments: '{}', isError: false, content: [{ type: 'text', text: 'data' }] } as never)
    session.append('tool/ptc-dispatch' as never, { subCallId: 'p2', name: 'grep', arguments: '{}', isError: false, content: [{ type: 'text', text: 'match' }] } as never)
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: false, reason: 'no-consequential-work' })
    session.append('tool/ptc-dispatch' as never, { subCallId: 'p3', name: 'edit', arguments: '{}', isError: false, content: [{ type: 'text', text: 'done' }] } as never)
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: true, toolCalls: 3, consequentialToolCalls: 1 })
  })
})
