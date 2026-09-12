import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { analyzeAutoTask, automaticFeedback, failedAcceptanceCriteria, isSubagentSession, sessionAccepted } from './auto.ts'

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

describe('session acceptance', () => {
  const criteria = [
    { id: 'specification', name: 'Specification Adherence', score: 1 },
    { id: 'output_match', name: 'Output Match', score: 1 },
    { id: 'error_signals', name: 'Error Signal Detection', score: 0 },
  ]

  it('rejects a session whose mean passes but one criterion failed', () => {
    // 0.667 clears the 0.65 mean, and the empty-work baseline always scores 0, so
    // without the per-criterion floor a completely failed requirement was invisible.
    expect(sessionAccepted({ score: 0.6667, winner: 'A', criteria }, 0.65)).toBe(false)
    expect(failedAcceptanceCriteria(criteria, 0.65).map(value => value.id)).toEqual(['error_signals'])
    // A criterion exactly at the threshold is accepted; the boundary is not a failure.
    expect(sessionAccepted({ score: 0.65, winner: 'A', criteria: [{ id: 'a', score: 0.65 }] }, 0.65)).toBe(true)
    // Without a breakdown the mean still decides.
    expect(sessionAccepted({ score: 0.6667, winner: 'A' }, 0.65)).toBe(true)
    // Losing to the baseline, or missing the mean, never passes.
    expect(sessionAccepted({ score: 1, winner: 'B' }, 0.65)).toBe(false)
    expect(sessionAccepted({ score: 0.5, winner: 'A', criteria: [] }, 0.65)).toBe(false)
  })

  it('names the failing criteria in the feedback and stays silent without them', () => {
    const message = automaticFeedback(0.6667, 0, 'A', 0.65, [{ id: 'error_signals', name: 'Error Signal Detection', score: 0 }])
    expect(message).toContain('Criteria below the threshold: Error Signal Detection 0.0%.')
    expect(automaticFeedback(0.4, 0, 'A', 0.65)).not.toContain('Criteria below the threshold')
  })
})

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

    // A pass whose MEAN clears the threshold but whose breakdown has a failed
    // requirement does not count: the automatic gate keeps the same floor, so the
    // explicit path must not be a loophole around it.
    const failedCriterion = taskSession()
    call(failedCriterion, 'edit', 'one'); call(failedCriterion, 'pwsh', 'two'); call(failedCriterion, 'read', 'three')
    sessionVerify(failedCriterion, 'four', JSON.stringify({ score: 0.7, baselineScore: 0, winner: 'A', criteria: [{ id: 'specification', scoreA: 1 }, { id: 'error_signals', scoreA: 0 }] }))
    expect(analyzeAutoTask(failedCriterion.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false, eligible: true })
    // A breakdown that clears every criterion still counts.
    const cleanCriteria = taskSession()
    call(cleanCriteria, 'edit', 'one'); call(cleanCriteria, 'pwsh', 'two'); call(cleanCriteria, 'read', 'three')
    sessionVerify(cleanCriteria, 'four', JSON.stringify({ score: 0.7, baselineScore: 0, winner: 'A', criteria: [{ id: 'specification', scoreA: 0.65 }, { id: 'error_signals', scoreA: 0.9 }] }))
    expect(analyzeAutoTask(cleanCriteria.events, smart)).toMatchObject({ manualVerificationAccepted: true, eligible: false, reason: 'already-verified' })

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
