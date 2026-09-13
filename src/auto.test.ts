import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { analyzeAutoTask, automaticFeedback, compareRouteFeedbackDetail, failedAcceptanceCriteria, isSubagentSession, selectRouteFeedbackDetail, sessionAccepted, topScoreIndices, type RoutedCandidateRef } from './auto.ts'

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
/** The acceptance-facing criteria shape `verifySession` actually returns: `{id, name, score}`. */
const passingCriteria = [
  { id: 'specification', name: 'Specification Adherence', score: 1 },
  { id: 'output_match', name: 'Output Match', score: 1 },
  { id: 'error_signals', name: 'Error Signal Detection', score: 1 },
]
const verdict = (score: number, winner = 'A', overrides: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: 's', problem: 'p', score, baselineScore: 0.2, winner,
  criteria: passingCriteria, fromSeq: 0, toSeq: 9, omittedCharacters: 0, calls: 3, stats: {}, ...overrides,
})

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
    sessionVerify(failedCriterion, 'four', JSON.stringify({ sessionId: 's', score: 0.7, baselineScore: 0, winner: 'A', fromSeq: 0, toSeq: 9, criteria: [{ id: 'specification', score: 1 }, { id: 'error_signals', score: 0 }] }))
    expect(analyzeAutoTask(failedCriterion.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false, eligible: true })
    // A breakdown that clears every criterion still counts.
    const cleanCriteria = taskSession()
    call(cleanCriteria, 'edit', 'one'); call(cleanCriteria, 'pwsh', 'two'); call(cleanCriteria, 'read', 'three')
    sessionVerify(cleanCriteria, 'four', JSON.stringify({ sessionId: 's', score: 0.7, baselineScore: 0, winner: 'A', fromSeq: 0, toSeq: 9, criteria: [{ id: 'specification', score: 0.65 }, { id: 'error_signals', score: 0.9 }] }))
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

  it('fails closed on a manual verdict that does not cover the current task', () => {
    // The read-back regression: the tool returns `score` on each criterion, but the parser
    // only read compare's `scoreA`, so every row was filtered out and the empty breakdown
    // passed the per-criterion floor. A malformed payload must not be treated as "all clear".
    const legacyShape = taskSession()
    call(legacyShape, 'edit', 'one'); call(legacyShape, 'pwsh', 'two'); call(legacyShape, 'read', 'three')
    sessionVerify(legacyShape, 'four', JSON.stringify({ sessionId: 's', score: 0.9, winner: 'A', fromSeq: 0, toSeq: 9, criteria: [{ id: 'a', scoreA: 1 }, { id: 'b', scoreA: 1 }] }))
    expect(analyzeAutoTask(legacyShape.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false })

    // Same for a verdict that reports no criteria at all.
    const noCriteria = taskSession()
    call(noCriteria, 'edit', 'one'); call(noCriteria, 'pwsh', 'two'); call(noCriteria, 'read', 'three')
    sessionVerify(noCriteria, 'four', verdict(0.9, 'A', { criteria: [] }))
    expect(analyzeAutoTask(noCriteria.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false })

    // A verdict from a different session never discharges this one's gate.
    const otherSession = taskSession()
    call(otherSession, 'edit', 'one'); call(otherSession, 'pwsh', 'two'); call(otherSession, 'read', 'three')
    sessionVerify(otherSession, 'four', verdict(0.9))
    expect(analyzeAutoTask(otherSession.events, smart, 'a-different-session')).toMatchObject({ manualVerificationAccepted: false })
  })

  it('accepts a verdict exactly at the threshold but rejects one whose reviewed interval is stale', () => {
    const boundary = taskSession()
    call(boundary, 'edit', 'one'); call(boundary, 'pwsh', 'two'); call(boundary, 'read', 'three')
    sessionVerify(boundary, 'four', verdict(0.65, 'A', { criteria: [{ id: 'specification', score: 0.65 }] }))
    expect(analyzeAutoTask(boundary.events, smart)).toMatchObject({ manualVerificationAccepted: true, eligible: false, reason: 'already-verified' })

    // The verdict reviewed only up to seq 2, but the pwsh result at seq 4 is consequential
    // work that happened after it: judging staleness by the verdict's OWN receipt expected
    // this to count, and that is exactly the hole F01 closes.
    const staleInterval = taskSession()
    call(staleInterval, 'edit', 'one'); call(staleInterval, 'pwsh', 'two'); call(staleInterval, 'read', 'three')
    sessionVerify(staleInterval, 'four', verdict(0.9, 'A', { toSeq: 2 }))
    expect(analyzeAutoTask(staleInterval.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false, eligible: true })

    // Covering that same work (toSeq 4) is accepted: the read result that follows is
    // passive, so it does not make the verdict stale.
    const covered = taskSession()
    call(covered, 'edit', 'one'); call(covered, 'pwsh', 'two'); call(covered, 'read', 'three')
    sessionVerify(covered, 'four', verdict(0.9, 'A', { toSeq: 4 }))
    expect(analyzeAutoTask(covered.events, smart)).toMatchObject({ manualVerificationAccepted: true })

    // An operation that completes WHILE the verification runs also invalidates it.
    const during = taskSession()
    call(during, 'edit', 'one'); call(during, 'read', 'two')
    during.append('tool/call', { turn: 1, step: 1, callId: 'verifier' as never, name: 'verifier_current_session', arguments: '{}' })
    call(during, 'pwsh', 'three')
    during.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'verifier' as never, content: [{ type: 'text', text: verdict(0.9, 'A', { toSeq: 4 }) }], isError: false }) }, { surfaceOp: 'append' })
    expect(analyzeAutoTask(during.events, smart)).toMatchObject({ manualVerificationAccepted: false, eligible: true })
  })

  it('treats a FAILED post-pass command as new work that invalidates the pass', () => {
    const value = taskSession()
    call(value, 'edit', 'one'); call(value, 'pwsh', 'two'); call(value, 'read', 'three')
    sessionVerify(value, 'four', verdict(0.9))
    // The reviewed interval ends at seq 9. This command runs afterwards and FAILS after
    // editing a file: it is real work, so the earlier pass no longer covers the session.
    // Collecting only successful results was the hole.
    value.append('tool/call', { turn: 1, step: 1, callId: 'five' as never, name: 'pwsh', arguments: '{}' })
    value.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'five' as never, content: [{ type: 'text', text: 'FAIL 1 test failed', isError: true }], isError: true }) }, { surfaceOp: 'append' })
    expect(analyzeAutoTask(value.events, smart)).toMatchObject({ hasManualSessionVerification: true, manualVerificationAccepted: false, eligible: true })
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

/**
 * S04: a tie, a byte-identical pair and a real winner are three different outcomes, and
 * automatic feedback must say which one happened — including the locator the agent needs
 * to find the object it is being told about.
 */
describe('routed selection feedback', () => {
  const ref = (label: string, id?: string, fromSeq?: number, toSeq?: number): RoutedCandidateRef => ({ label, ...(id === undefined ? {} : { id }), ...(fromSeq === undefined ? {} : { fromSeq }), ...(toSeq === undefined ? {} : { toSeq }) })

  it('names a unique winner with a locator and never the loser', () => {
    const text = compareRouteFeedbackDetail([ref('A', 'call-a', 1, 2), ref('B', 'call-b', 3, 4)], { winner: 'A', scoreA: 0.9, scoreB: 0.2 })
    expect(text).toContain('Winner: [1] A (#call-a) @seq 1-2')
    expect(text).toContain('90.0% vs 20.0%')
    expect(text).not.toContain('Winner: B')
    expect(text).toContain('verify the required work')
  })

  it('reports a tie as no unique winner instead of promoting the first entry', () => {
    const text = compareRouteFeedbackDetail([ref('A'), ref('B')], { winner: 'tie', scoreA: 0.5, scoreB: 0.5 })
    expect(text).toContain('NO unique winner')
    expect(text).not.toContain('Winner:')
    expect(text).toContain('Tied candidates:')
  })

  it('says a proposal verdict ranks plans, not results', () => {
    const artifact = compareRouteFeedbackDetail([ref('A'), ref('B')], { winner: 'A', scoreA: 0.9, scoreB: 0.2 })
    expect(artifact).not.toContain('PROPOSAL review')
    // Omitting the stage keeps the historical artifact wording byte for byte.
    expect(compareRouteFeedbackDetail([ref('A'), ref('B')], { winner: 'A', scoreA: 0.9, scoreB: 0.2 }, undefined, 'artifact')).toBe(artifact)

    const proposal = compareRouteFeedbackDetail([ref('A'), ref('B')], { winner: 'A', scoreA: 0.9, scoreB: 0.2 }, undefined, 'proposal')
    expect(proposal).toContain('PROPOSAL review')
    expect(proposal).toContain('neither side has been executed')
    expect(proposal).toContain('NOT more reliable or already done')
    const selected = selectRouteFeedbackDetail([ref('A'), ref('B'), ref('C')], { index: 0, ranking: [0, 1, 2], scores: [0.6, 0.3, 0.1] }, undefined, 'proposal')
    expect(selected).toContain('PROPOSAL review')
  })

  it('reports byte-identical candidates as an unperformed comparison', () => {
    const text = compareRouteFeedbackDetail([ref('A'), ref('B')], { winner: 'tie', scoreA: 0.5, scoreB: 0.5, identical: true })
    expect(text).toContain('byte-identical')
    expect(text).toContain('NO quality comparison')
    expect(text).not.toContain('NO unique winner')
  })

  it('reports a shared top score in a selection as a tie set', () => {
    const text = selectRouteFeedbackDetail([ref('A'), ref('B'), ref('C')], { index: 0, ranking: [0, 1, 2], scores: [0.5, 0.5, 0.25] })
    expect(text).toContain('top score is shared by 2 candidates')
    expect(text).toContain('NO unique best')
    // The stable-sort first entry must not be announced as the pick.
    expect(text).not.toContain('Proceed with')
  })

  it('names a unique best with its relative share and locator', () => {
    const text = selectRouteFeedbackDetail([ref('A', 'x', 1, 2), ref('B', 'y', 3, 4), ref('C', 'z', 5, 6)], { index: 2, ranking: [2, 1, 0], scores: [0.1, 0.3, 0.6] })
    expect(text).toContain('Proceed with [3] C (#z) @seq 5-6')
    expect(text).toContain('relative preference')
  })

  it('reports an all-identical selection without inventing a ranking', () => {
    const text = selectRouteFeedbackDetail([ref('A'), ref('B')], { index: 0, ranking: [0, 1], scores: [0.5, 0.5], identical: true })
    expect(text).toContain('byte-identical')
    expect(text).toContain('NO ranking was computed')
    expect(text).not.toContain('Proceed with')
  })

  it('says there is no result when the judge returned no usable scores', () => {
    expect(selectRouteFeedbackDetail([ref('A'), ref('B')], { index: 0, ranking: [], scores: [] })).toContain('NO result to act on')
  })

  it('bounds every feedback body, long locators included', () => {
    const long = 'x'.repeat(5000)
    const text = selectRouteFeedbackDetail(
      Array.from({ length: 8 }, (_, index) => ref('label-' + index + '-' + long, 'id-' + index, index, index)),
      { index: 0, ranking: [0, 1, 2, 3, 4, 5, 6, 7], scores: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3] },
      400,
    )
    expect(text.length).toBeLessThanOrEqual(400)
  })

  it('keeps the candidate ordinal and event position when labels and ids are long', () => {
    // Same label, ids that only differ after 200 characters: truncating label + id + seq
    // together used to delete both the distinguishing id suffix AND the event position.
    const longA = ref('same-label', 'x'.repeat(200) + '-A', 10, 20)
    const longB = ref('same-label', 'x'.repeat(200) + '-B', 30, 40)
    const text = compareRouteFeedbackDetail([longA, longB], { winner: 'tie', scoreA: 0.5, scoreB: 0.5 }, 500)
    expect(text).toContain('[1]')
    expect(text).toContain('[2]')
    expect(text).toContain('@seq 10-20')
    expect(text).toContain('@seq 30-40')
    expect(text.length).toBeLessThanOrEqual(500)
  })

  it('finds the tied-for-top set and refuses to name one for unusable scores', () => {
    expect(topScoreIndices([0.2, 0.9, 0.9])).toEqual([1, 2])
    expect(topScoreIndices([0.5, 0.5, 0.5])).toEqual([0, 1, 2])
    expect(topScoreIndices([])).toEqual([])
    expect(topScoreIndices([Number.NaN, Number.NaN])).toEqual([])
  })

  it('locates the reviewed range and admits a missing or truncated breakdown', () => {
    const withLocator = automaticFeedback(0.2, 0.1, 'B', 0.65, [], { sessionId: 's-1', fromSeq: 4, toSeq: 9, omittedCharacters: 1200 }, 0)
    expect(withLocator).toContain('no per-criterion breakdown')
    expect(withLocator).toContain('session s-1 seq 4-9')
    expect(withLocator).toContain('1200 characters of earlier evidence were omitted')
    const failed = automaticFeedback(0.2, 0.1, 'A', 0.65, [{ id: 'spec', name: 'Spec', score: 0 }], { sessionId: 's', fromSeq: 0, toSeq: 3 })
    expect(failed).toContain('Spec 0.0%')
    expect(failed).not.toContain('no per-criterion breakdown')
  })

  it('does not claim a missing breakdown when every reported criterion passed', () => {
    // A tie (or a wrong winner) with all criteria passing is not "no breakdown".
    const tie = automaticFeedback(0.7, 0.5, 'tie', 0.65, [], { sessionId: 's', fromSeq: 0, toSeq: 3 }, 3)
    expect(tie).not.toContain('no per-criterion breakdown')
    const missing = automaticFeedback(0.7, 0.5, 'tie', 0.65, [], { sessionId: 's', fromSeq: 0, toSeq: 3 }, 0)
    expect(missing).toContain('no per-criterion breakdown')
  })
})
