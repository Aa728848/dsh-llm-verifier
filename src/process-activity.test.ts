import { describe, expect, it } from 'vitest'
import {
  PROCESS_ACTIVITY_SETTLED_TTL_MS,
  ProcessActivities,
  classifyProcessOutcome,
} from './process-activity.ts'

function active(cycleId: string, candidates = 2) {
  return { cycleId, phase: 'generating' as const, candidates, startedAt: 1_000 }
}

describe('classifyProcessOutcome', () => {
  it('reads the delivered stream, not the recorded label', () => {
    // The correction path keeps the optimistic outcome and flips `replayed`: the chip must follow
    // what the host actually received.
    expect(classifyProcessOutcome('candidate-selected', 'candidate')).toBe('replaced')
    expect(classifyProcessOutcome('candidate-not-delivered (canceled)', 'original')).toBe('kept')
  })

  it('separates a real tie from an identical candidate', () => {
    expect(classifyProcessOutcome('tie', 'original')).toBe('kept')
    expect(classifyProcessOutcome('original-selected', 'original')).toBe('kept')
    expect(classifyProcessOutcome('identical-candidate', 'original')).toBe('same')
  })

  it('treats every decline and failure as a failed cycle', () => {
    for (const outcome of ['generation-failed', 'comparison-failed', 'view-over-budget', 'task-unreadable', 'switch-off', 'canceled', 'task-changed', 'original-empty', 'original-incomplete', 'original-over-cap', 'store-unavailable', 'no-process-budget']) {
      expect(classifyProcessOutcome(outcome, 'original')).toBe('failed')
    }
  })
})

describe('ProcessActivities', () => {
  it('publishes one cycle, follows its phase, and settles it', () => {
    const activities = new ProcessActivities()
    activities.begin('s1', active('c1'))
    expect(activities.read('s1', 1_000).active).toMatchObject({ cycleId: 'c1', phase: 'generating', candidates: 2 })
    expect(activities.read('s1', 1_000).settled).toBeUndefined()

    expect(activities.phase('s1', 'c1', 'comparing')).toBe(true)
    expect(activities.read('s1', 1_100).active?.phase).toBe('comparing')

    expect(activities.finish('s1', 'c1', 'candidate-selected', 'candidate', 2_000)).toBe(true)
    const settled = activities.read('s1', 2_100)
    expect(settled.active).toBeUndefined()
    expect(settled.settled).toEqual({ cycleId: 'c1', outcome: 'replaced', candidates: 2, at: 2_000 })
  })

  it('never claims a cycle nobody observed', () => {
    const activities = new ProcessActivities()
    // `store-unavailable` reports before `begin`: there is no cycle to explain.
    expect(activities.finish('s1', 'c1', 'store-unavailable', 'original', 1_000)).toBe(false)
    expect(activities.read('s1', 1_000)).toEqual({})
  })

  it('ignores a late phase or finish for a cycle that already settled', () => {
    const activities = new ProcessActivities()
    activities.begin('s1', active('c2'))
    // A stale step from an older cycle must not resurrect it.
    expect(activities.phase('s1', 'c1', 'comparing')).toBe(false)
    expect(activities.finish('s1', 'c1', 'candidate-selected', 'candidate', 2_000)).toBe(false)
    expect(activities.read('s1', 2_000).active?.cycleId).toBe('c2')
    // The correction path, however, retires the cycle it names while that record is still current.
    expect(activities.finish('s1', 'c2', 'candidate-selected', 'candidate', 3_000)).toBe(true)
    expect(activities.finish('s1', 'c2', 'candidate-not-delivered (canceled)', 'original', 3_100)).toBe(true)
    expect(activities.read('s1', 3_200).settled?.outcome).toBe('kept')
  })

  it('hides a settled cycle after its TTL and keeps sessions apart', () => {
    const activities = new ProcessActivities()
    activities.begin('s1', active('c1', 3))
    activities.begin('s2', active('c9', 4))
    activities.finish('s1', 'c1', 'original-selected', 'original', 2_000)
    expect(activities.read('s2', 2_000).active?.candidates).toBe(4)
    expect(activities.read('s1', 2_000 + PROCESS_ACTIVITY_SETTLED_TTL_MS - 1).settled?.outcome).toBe('kept')
    expect(activities.read('s1', 2_000 + PROCESS_ACTIVITY_SETTLED_TTL_MS).settled).toBeUndefined()
  })

  it('forgets a session on clear and every session on clearAll', () => {
    const activities = new ProcessActivities()
    activities.begin('s1', active('c1'))
    activities.finish('s2', 'never', 'tie', 'original', 1)
    activities.begin('s2', active('c2'))
    activities.finish('s2', 'c2', 'tie', 'original', 1_500)
    activities.clear('s1')
    expect(activities.read('s1', 1_600)).toEqual({})
    expect(activities.read('s2', 1_600).settled?.outcome).toBe('kept')
    activities.clearAll()
    expect(activities.read('s2', 1_600)).toEqual({})
  })
})
