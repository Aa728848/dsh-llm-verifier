import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { extractSession, sessionEvents } from './session.ts'

describe('current session extraction', () => {
  it('keeps direct evidence, skips plugin instructions, and redacts secrets', async () => {
    const session = Session.create('session-00000000-0000-4000-8000-000000000001' as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Fix task token = abc123 Bearer live-secret' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hidden plugin instruction' }], source: { kind: 'plugin', plugin: 'test' } }), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: 'running checks' }], source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }) }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: 'call-1' as never, name: 'pwsh', arguments: '{"command":"test"}' })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'call-1' as never, content: [{ type: 'text', text: 'exit 0 password=hunter2' }], isError: false }) }, { surfaceOp: 'append' })
    const agent = { id: session.id, session } as never
    const result = await extractSession(agent, async () => { throw new Error('no image expected') })
    expect(result.problem).toContain('Fix task')
    expect(result.problem).toContain('[REDACTED]')
    expect(result.problem).not.toContain('abc123')
    expect(result.problem).not.toContain('live-secret')
    expect(result.trace).not.toContain('hidden plugin instruction')
    expect(result.trace).toContain('exit 0')
    expect(result.trace).not.toContain('hunter2')
  })

  it('extracts PTC mode tool/code-dispatch events and redacts content', async () => {
    const session = Session.create('session-00000000-0000-4000-8000-000000000002' as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Run PTC task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('tool/code-dispatch', { subCallId: 'code-1' as never, name: 'edit', arguments: { file: 'src/main.ts' }, isError: false, content: [{ type: 'text', text: 'updated file api_key=secret-value' }] })
    const agent = { id: session.id, session } as never
    const result = await extractSession(agent, async () => { throw new Error('no image expected') })
    expect(result.trace).toContain('--- Code Dispatch edit')
    expect(result.trace).toContain('src/main.ts')
    expect(result.trace).toContain('[REDACTED]')
    expect(result.trace).not.toContain('secret-value')
  })

  it('extracts Session V3 tool/ptc-dispatch, file content blocks, and team messages', async () => {
    const session = Session.create('session-00000000-0000-4000-8000-000000000003' as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Team task instructions' }, { type: 'file' as never, path: 'src/config.ts' } as never], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('tool/ptc-dispatch' as never, { subCallId: 'ptc-1', name: 'run_test', arguments: { target: 'unit' }, isError: false, content: [{ type: 'text', text: 'all tests passed' }] } as never)
    session.append('team/message/queued' as never, { message: { senderName: 'Alice', content: [{ type: 'text', text: 'Reviewed PR #123' }] } } as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Follow-up from Bob' }], source: { kind: 'team-message' as never } as never }), { surfaceOp: 'append' })
    const agent = { id: session.id, session } as never
    const result = await extractSession(agent, async () => { throw new Error('no image expected') })
    expect(result.trace).toContain('[File] src/config.ts')
    expect(result.trace).toContain('--- PTC Dispatch run_test')
    expect(result.trace).toContain('all tests passed')
    expect(result.trace).toContain('--- Team Message Queued from Alice')
    expect(result.trace).toContain('Reviewed PR #123')
    expect(result.trace).toContain('--- Team Message seq')
    expect(result.trace).toContain('Follow-up from Bob')
  })
})

describe('session extraction bounds', () => {
  async function longSession(id: string) {
    const session = Session.create(id as never)
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Long running task' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    for (let index = 0; index < 20; index += 1) {
      const callId = ('c-' + index) as never
      session.append('tool/call', { turn: 1, step: index + 1, callId, name: 'pwsh', arguments: '{"command":"echo ' + 'x'.repeat(200) + '"}' })
      session.append('tool/result', { turn: 1, step: index + 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'line-' + index + ' ' + 'y'.repeat(300) }], isError: false }) }, { surfaceOp: 'append' })
    }
    // A short newest event, so "the tail is what survives" can be asserted exactly.
    session.append('tool/call', { turn: 1, step: 99, callId: 'c-final' as never, name: 'pwsh', arguments: '{"command":"final check"}' })
    session.append('tool/result', { turn: 1, step: 99, message: createToolResultMessage({ callId: 'c-final' as never, content: [{ type: 'text', text: 'NEWEST-EVIDENCE' }], isError: false }) }, { surfaceOp: 'append' })
    return { id: session.id, session }
  }

  it('never returns a trace longer than maxChars, truncation notice included', async () => {
    const agent = await longSession('session-00000000-0000-4000-8000-000000000004')
    for (const maxChars of [1, 10, 55, 120, 2000]) {
      const result = await extractSession(agent as never, async () => { throw new Error('no image expected') }, { maxChars })
      expect(result.trace.length, 'maxChars=' + maxChars).toBeLessThanOrEqual(maxChars)
    }
  })

  it('keeps the newest evidence and reports the omitted characters', async () => {
    const agent = await longSession('session-00000000-0000-4000-8000-000000000005')
    const result = await extractSession(agent as never, async () => { throw new Error('no image expected') }, { maxChars: 200 })
    expect(result.trace).toContain('NEWEST-EVIDENCE')
    expect(result.trace).not.toContain('line-0 ')
    expect(result.omittedCharacters).toBeGreaterThan(0)
  })

  it('rejects a non-positive maxChars instead of returning the whole trace', async () => {
    const agent = await longSession('session-00000000-0000-4000-8000-000000000006')
    await expect(extractSession(agent as never, async () => { throw new Error('no image expected') }, { maxChars: 0 })).rejects.toThrow(/positive integer/)
    await expect(extractSession(agent as never, async () => { throw new Error('no image expected') }, { maxChars: Number.NaN })).rejects.toThrow(/positive integer/)
  })
})

describe('session event accessor', () => {
  it('reads the 0.1.5 snapshotEvents() shape', () => {
    const events = [{ seq: 0, type: 'user/message' }]
    expect(sessionEvents({ snapshotEvents: () => events as never })).toBe(events)
  })

  it('falls back to the legacy events array', () => {
    const events = [{ seq: 0, type: 'user/message' }]
    expect(sessionEvents({ events: events as never })).toBe(events)
  })

  it('returns an empty log instead of throwing on an unknown session shape', () => {
    expect(sessionEvents({})).toEqual([])
    expect(sessionEvents(undefined)).toEqual([])
    expect(sessionEvents({ events: undefined })).toEqual([])
  })
})
