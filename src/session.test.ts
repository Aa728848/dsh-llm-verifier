import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { extractSession } from './session.ts'

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
