import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { detectPlanExit, buildPlanPreReviewPrompt, parsePlanReviewVerdict } from './plan-gate.ts'

describe('plan-gate', () => {
  it('detects plan exit when plan is in arguments', () => {
    const session = Session.create('session-plan-1' as never)
    session.append('tool/call', { turn: 1, step: 1, callId: 'call-plan-1' as never, name: 'exit_plan_mode', arguments: JSON.stringify({ plan: 'Step 1: Refactor auth\nStep 2: Add test' }) })
    const detection = detectPlanExit(session.events)
    expect(detection.hasExitPlanMode).toBe(true)
    expect(detection.planText).toContain('Step 1: Refactor auth')
    expect(detection.callSeq).toBe(0)
  })

  it('detects plan exit fallback to preceding assistant message', () => {
    const session = Session.create('session-plan-2' as never)
    session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'Implementation Plan:\n- Modify index.ts\n- Run tests' }], source: { provider: 'test', model: 'test' } }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 2, callId: 'call-plan-2' as never, name: 'exit_plan_mode', arguments: '{}' })
    const detection = detectPlanExit(session.events)
    expect(detection.hasExitPlanMode).toBe(true)
    expect(detection.planText).toContain('Implementation Plan:')
    expect(detection.planText).toContain('Run tests')
  })

  it('returns false when exit_plan_mode was not called', () => {
    const session = Session.create('session-plan-3' as never)
    session.append('tool/call', { turn: 1, step: 1, callId: 'call-edit-1' as never, name: 'edit_file', arguments: '{}' })
    const detection = detectPlanExit(session.events)
    expect(detection.hasExitPlanMode).toBe(false)
    expect(detection.planText).toBeUndefined()
  })

  it('builds plan review prompt with requirements and scoring guide', () => {
    const prompt = buildPlanPreReviewPrompt('Implement Redis cache', '1. Connect redis 2. Cache queries', 5000)
    expect(prompt).toContain('You are an expert independent technical plan verifier')
    expect(prompt).toContain('Implement Redis cache')
    expect(prompt).toContain('1. Connect redis 2. Cache queries')
    expect(prompt).toContain('Verdict: <Single uppercase letter A-T>')
  })

  it('parses plan review verdicts and computes continuous scores', () => {
    const perfect = parsePlanReviewVerdict('Verdict: A\nSummary: Outstanding plan.\nVerification is complete.')
    expect(perfect.verdict).toBe('A')
    expect(perfect.score).toBe(1.0)
    expect(perfect.feedback).toContain('Outstanding plan')

    const failed = parsePlanReviewVerdict('Verdict: T\nSummary: Completely unfeasible.')
    expect(failed.verdict).toBe('T')
    expect(failed.score).toBe(0.0)

    const middle = parsePlanReviewVerdict('Verdict: C\nSummary: Mostly good.')
    expect(middle.verdict).toBe('C')
    expect(middle.score).toBeCloseTo(1 - 2 / 19, 3)
  })
})
