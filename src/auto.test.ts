import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AutoVerificationBudget, analyzeAutoTask, automaticFeedback } from './auto.ts'

function taskSession() {
  const session = Session.create('session-00000000-0000-4000-8000-000000000009' as never)
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Implement and test the feature' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return session
}

function call(session: ReturnType<typeof taskSession>, name: string, id: string) {
  session.append('tool/call', { turn: 1, step: 1, callId: id as never, name, arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: id as never, content: [{ type: 'text', text: 'ok' }], isError: false }) }, { surfaceOp: 'append' })
}

const smart = { mode: 'smart' as const, minToolCalls: 3, maxPerTask: 2, maxPerSession: 8 }

describe('automatic verification policy', () => {
  it('requires consequential work and enough evidence in smart mode', () => {
    const session = taskSession()
    call(session, 'read', 'one')
    call(session, 'grep', 'two')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: false, reason: 'no-consequential-work' })
    call(session, 'edit', 'three')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: true, toolCalls: 3, consequentialToolCalls: 1 })
  })

  it('strict mode accepts one completed consequential call', () => {
    const session = taskSession()
    call(session, 'ssh_exec', 'one')
    expect(analyzeAutoTask(session.events, { ...smart, mode: 'strict' })).toMatchObject({ eligible: true, reason: 'strict-eligible' })
  })

  it('manual verification suppresses the automatic gate', () => {
    const session = taskSession()
    call(session, 'edit', 'one')
    call(session, 'pwsh', 'two')
    call(session, 'verifier_current_session', 'three')
    expect(analyzeAutoTask(session.events, smart)).toMatchObject({ eligible: false, reason: 'already-verified', hasManualSessionVerification: true })
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

  it('builds actionable low-score feedback', () => {
    expect(automaticFeedback(0.42, 0.31, 'A', 0.65)).toContain('42.0%')
    expect(automaticFeedback(0.42, 0.31, 'A', 0.65)).toContain('verification command')
  })
})
