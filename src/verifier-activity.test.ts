import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_ACTIVE_TTL_MS,
  ACTIVITY_SETTLED_TTL_MS,
  VerifierActivities,
  classifyProcessOutcome,
  createActivityObserver,
  reservationActivity,
  reservationPromotion,
  reservationSettled,
} from './verifier-activity.ts'
import type { Reservation, RoutedAgent } from './router.ts'

const AGENT = { id: 's1', session: {} } as unknown as RoutedAgent
function reservation(phase: Reservation['phase'], expectedCalls = 6, id = 'cycle-1'): Reservation {
  return { id, phase, fingerprint: 'f', taskStartSeq: 5, expectedCalls, attempt: 1 }
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

describe('router reservations, as the chip reads them', () => {
  it('announces the routed and final phases and stays silent about the rest', () => {
    expect(reservationActivity(reservation('semantic', 1), 1_000)).toEqual({ cycleId: 'cycle-1', stage: 'route', phase: 'classifying', expectedCalls: 1, startedAt: 1_000 })
    expect(reservationActivity(reservation('select', 30), 1_000)).toEqual({ cycleId: 'cycle-1', stage: 'route', phase: 'reviewing', destination: 'select', expectedCalls: 30, startedAt: 1_000 })
    expect(reservationActivity(reservation('final', 12), 1_000)).toMatchObject({ stage: 'final', phase: 'accepting', expectedCalls: 12 })
    // P06 publishes its own richer record; the plan gate already shows a pending tool row.
    expect(reservationActivity(reservation('process', 25), 1_000)).toBeUndefined()
    expect(reservationActivity(reservation('plan_review', 6), 1_000)).toBeUndefined()
    expect(reservationActivity(reservation('team_task', 6), 1_000)).toBeUndefined()
  })

  it('moves a promoted classification into the decision it resolved', () => {
    expect(reservationPromotion(reservation('compare', 6))).toEqual({ phase: 'reviewing', destination: 'compare', expectedCalls: 6 })
    expect(reservationPromotion(reservation('track', 9))).toEqual({ phase: 'reviewing', destination: 'track', expectedCalls: 9 })
    // Nothing to move while it is still classifying (or for a phase the chip never announced).
    expect(reservationPromotion(reservation('semantic', 1))).toBeUndefined()
    expect(reservationPromotion(reservation('final', 6))).toBeUndefined()
  })

  it('keeps a row only for the final gate', () => {
    expect(reservationSettled(reservation('final'), 'committed')).toEqual({ stage: 'final', outcome: 'accepted' })
    expect(reservationSettled(reservation('final'), 'failed')).toEqual({ stage: 'final', outcome: 'rejected' })
    // A routed verdict steers its own copy into the chat; a second transient line would repeat it.
    expect(reservationSettled(reservation('compare'), 'committed')).toBeUndefined()
    expect(reservationSettled(reservation('semantic'), 'failed')).toBeUndefined()
  })
})

describe('createActivityObserver', () => {
  it('publishes a routed cycle through reservation, promotion and settlement', () => {
    const activities = new VerifierActivities()
    const observer = createActivityObserver(activities, () => 1_000)
    const cycle = reservation('semantic', 1)
    observer.begin?.(AGENT, cycle)
    expect(activities.read('s1', 1_000).active).toMatchObject({ stage: 'route', phase: 'classifying', expectedCalls: 1 })
    // Promotion mutates the SAME reservation (that is what promotion means), so the chip has to move
    // with it instead of leaving a second cycle behind.
    cycle.phase = 'select'
    cycle.expectedCalls = 31
    observer.promoted?.(AGENT, cycle)
    expect(activities.read('s1', 1_000).active).toMatchObject({ phase: 'reviewing', destination: 'select', expectedCalls: 31 })
    observer.settled?.(AGENT, cycle, 'committed')
    // Cleared without a message, and pruned for good: no settled row either.
    expect(activities.read('s1', 1_000)).toEqual({})
  })

  it('leaves a final-gate row behind, and prunes it on its own TTL', () => {
    const activities = new VerifierActivities()
    const observer = createActivityObserver(activities, () => 2_000)
    observer.begin?.(AGENT, reservation('final', 12))
    observer.settled?.(AGENT, reservation('final', 12), 'committed')
    expect(activities.read('s1', 2_000).settled).toEqual({ cycleId: 'cycle-1', stage: 'final', outcome: 'accepted', at: 2_000 })
    expect(activities.read('s1', 2_000 + ACTIVITY_SETTLED_TTL_MS).settled).toBeUndefined()
  })
})

describe('VerifierActivities', () => {
  function active(cycleId: string, candidates = 2) {
    return { cycleId, stage: 'process' as const, phase: 'generating' as const, candidates, startedAt: 1_000 }
  }

  it('publishes one cycle, follows its phase, and settles it', () => {
    const activities = new VerifierActivities()
    activities.begin('s1', active('c1'))
    expect(activities.read('s1', 1_000).active).toMatchObject({ cycleId: 'c1', stage: 'process', phase: 'generating', candidates: 2 })
    expect(activities.read('s1', 1_000).settled).toBeUndefined()

    expect(activities.update('s1', 'c1', { phase: 'comparing' })).toBe(true)
    expect(activities.read('s1', 1_100).active?.phase).toBe('comparing')

    expect(activities.finish('s1', 'c1', 'replaced', 2_000)).toBe(true)
    const settled = activities.read('s1', 2_100)
    expect(settled.active).toBeUndefined()
    expect(settled.settled).toEqual({ cycleId: 'c1', stage: 'process', outcome: 'replaced', candidates: 2, at: 2_000 })
  })

  it('never claims a cycle nobody observed', () => {
    const activities = new VerifierActivities()
    // `store-unavailable` reports before `begin`: there is no cycle to explain.
    expect(activities.finish('s1', 'c1', 'failed', 1_000)).toBe(false)
    expect(activities.read('s1', 1_000)).toEqual({})
  })

  it('ignores a late phase or finish for a cycle that already settled', () => {
    const activities = new VerifierActivities()
    activities.begin('s1', active('c2'))
    // A stale step from an older cycle must not resurrect it.
    expect(activities.update('s1', 'c1', { phase: 'comparing' })).toBe(false)
    expect(activities.finish('s1', 'c1', 'replaced', 2_000)).toBe(false)
    expect(activities.read('s1', 2_000).active?.cycleId).toBe('c2')
    // The correction path, however, retires the cycle it names while that record is still current.
    expect(activities.finish('s1', 'c2', 'replaced', 3_000)).toBe(true)
    expect(activities.finish('s1', 'c2', 'kept', 3_100)).toBe(true)
    expect(activities.read('s1', 3_200).settled?.outcome).toBe('kept')
  })

  it('hides a settled cycle after its TTL and keeps sessions apart', () => {
    const activities = new VerifierActivities()
    activities.begin('s1', active('c1', 3))
    activities.begin('s2', active('c9', 4))
    activities.finish('s1', 'c1', 'kept', 2_000)
    expect(activities.read('s2', 2_000).active?.candidates).toBe(4)
    expect(activities.read('s1', 2_000 + ACTIVITY_SETTLED_TTL_MS - 1).settled?.outcome).toBe('kept')
    expect(activities.read('s1', 2_000 + ACTIVITY_SETTLED_TTL_MS).settled).toBeUndefined()
  })

  it('drops an in-flight record that leaked, so the chip cannot stick', () => {
    const activities = new VerifierActivities()
    activities.begin('s1', active('c1'))
    expect(activities.read('s1', 1_000 + ACTIVITY_ACTIVE_TTL_MS - 1).active).toBeDefined()
    expect(activities.read('s1', 1_000 + ACTIVITY_ACTIVE_TTL_MS).active).toBeUndefined()
  })

  it('forgets a session on clear and every session on clearAll', () => {
    const activities = new VerifierActivities()
    activities.begin('s1', active('c1'))
    activities.begin('s2', active('c2'))
    activities.finish('s2', 'c2', 'kept', 1_500)
    activities.clear('s1')
    expect(activities.read('s1', 1_600)).toEqual({})
    expect(activities.read('s2', 1_600).settled?.outcome).toBe('kept')
    activities.clearAll()
    expect(activities.read('s2', 1_600)).toEqual({})
  })
})
