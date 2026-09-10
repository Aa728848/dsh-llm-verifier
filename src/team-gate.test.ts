import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { inspectTeamTasks, buildTeamTaskVerificationPrompt } from './team-gate.ts'

describe('team-gate', () => {
  it('inspects team tasks and detects recently completed tasks', () => {
    const session = Session.create('session-team-1' as never)
    session.append('team/task' as never, { task: { id: 'task-1', revision: 1, subject: 'Write unit tests', status: 'in_progress' } } as never)
    session.append('team/task' as never, { task: { id: 'task-2', revision: 1, subject: 'Update docs', status: 'pending' } } as never)
    session.append('team/task' as never, { task: { id: 'task-1', revision: 2, subject: 'Write unit tests', description: 'Ensure 100% coverage', status: 'completed' } } as never)

    const inspection = inspectTeamTasks(session.events, 0)
    expect(inspection.hasRecentCompletedTask).toBe(true)
    expect(inspection.latestCompletedTask?.id).toBe('task-1')
    expect(inspection.latestCompletedTask?.status).toBe('completed')
    expect(inspection.latestCompletedTask?.description).toBe('Ensure 100% coverage')
    expect(inspection.activeTasks).toHaveLength(2)
    expect(inspection.completedTasks).toHaveLength(1)
    expect(inspection.completedTasks[0]?.seq).toBe(2)
  })

  it('lists every completed task once, oldest first', () => {
    const session = Session.create('session-team-order' as never)
    session.append('team/task' as never, { task: { id: 'task-a', revision: 1, subject: 'A', status: 'completed' } } as never)
    session.append('team/task' as never, { task: { id: 'task-b', revision: 1, subject: 'B', status: 'in_progress' } } as never)
    session.append('team/task' as never, { task: { id: 'task-b', revision: 2, subject: 'B', status: 'completed' } } as never)
    session.append('team/task' as never, { task: { id: 'task-a', revision: 2, subject: 'A', status: 'in_progress' } } as never)
    session.append('team/task' as never, { task: { id: 'task-a', revision: 3, subject: 'A', status: 'completed' } } as never)

    const inspection = inspectTeamTasks(session.events, 0)
    expect(inspection.completedTasks.map(entry => entry.task.id)).toEqual(['task-b', 'task-a'])
    expect(inspection.completedTasks.map(entry => entry.seq)).toEqual([2, 4])
    // A reopened task is verified once, at its newest completion.
    expect(inspection.latestCompletedTask?.id).toBe('task-a')
    expect(inspection.latestCompletedTask?.revision).toBe(3)
  })

  it('drops a completion that was reopened or deleted afterwards', () => {
    const session = Session.create('session-team-ghost' as never)
    session.append('team/task' as never, { task: { id: 'task-x', revision: 1, subject: 'X', status: 'completed' } } as never)
    session.append('team/task' as never, { task: { id: 'task-x', revision: 2, subject: 'X', status: 'in_progress' } } as never)
    const reopened = inspectTeamTasks(session.events, 0)
    expect(reopened.completedTasks).toEqual([])
    expect(reopened.latestCompletedTask).toBeUndefined()
    expect(reopened.hasRecentCompletedTask).toBe(false)

    session.append('team/task' as never, { task: { id: 'task-x', revision: 3, subject: 'X', status: 'deleted' } } as never)
    expect(inspectTeamTasks(session.events, 0).completedTasks).toEqual([])

    session.append('team/task' as never, { task: { id: 'task-x', revision: 4, subject: 'X', status: 'completed' } } as never)
    expect(inspectTeamTasks(session.events, 0).completedTasks.map(entry => entry.seq)).toEqual([3])
  })

  it('filters deleted tasks from active tasks', () => {
    const session = Session.create('session-team-2' as never)
    session.append('team/task' as never, { task: { id: 'task-1', revision: 1, subject: 'Task A', status: 'in_progress' } } as never)
    session.append('team/task' as never, { task: { id: 'task-2', revision: 1, subject: 'Task B', status: 'pending' } } as never)
    session.append('team/task' as never, { task: { id: 'task-2', revision: 2, subject: 'Task B', status: 'deleted' } } as never)

    const inspection = inspectTeamTasks(session.events, 0)
    expect(inspection.activeTasks).toHaveLength(1)
    expect(inspection.activeTasks[0]?.id).toBe('task-1')
    expect(inspection.hasRecentCompletedTask).toBe(false)
    expect(inspection.completedTasks).toEqual([])
  })

  it('respects fromSeq boundary for recent completed task', () => {
    const session = Session.create('session-team-3' as never)
    session.append('team/task' as never, { task: { id: 'task-1', revision: 1, subject: 'Initial setup', status: 'completed' } } as never)
    // seq 0 is task-1 completed
    session.append('team/task' as never, { task: { id: 'task-2', revision: 1, subject: 'Next step', status: 'in_progress' } } as never)

    const inspection = inspectTeamTasks(session.events, 1)
    expect(inspection.hasRecentCompletedTask).toBe(false)
    expect(inspection.latestCompletedTask).toBeUndefined()
    expect(inspection.completedTasks).toEqual([])
  })

  it('builds verification prompt containing task metadata and trace evidence', () => {
    const prompt = buildTeamTaskVerificationPrompt(
      { id: 'task-100', revision: 2, subject: 'Build Artifact Bundle', description: 'Produce dist/index.js and dist/client.js', status: 'completed' },
      'Executed pnpm build: completed in 1.2s with zero errors.',
      10000
    )
    expect(prompt).toContain('You are an expert independent technical verifier reviewing a completed Agent Teams task')
    expect(prompt).toContain('ID: task-100')
    expect(prompt).toContain('Subject: Build Artifact Bundle')
    expect(prompt).toContain('Description: Produce dist/index.js')
    expect(prompt).toContain('Executed pnpm build: completed in 1.2s')
    expect(prompt).toContain('Verdict: <single uppercase letter A-T>')
  })
})
