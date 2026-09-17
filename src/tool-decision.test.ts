import { describe, expect, it } from 'vitest'
import { cancelledCall, denyWithInfo } from './tool-decision.ts'

describe('pre-execute decisions across host lines', () => {
  it('carries the structured detail next to the model-facing sentence', () => {
    const decision = denyWithInfo('scored 40.0% against a 60% threshold.', { name: 'VerifierPlanPreReviewDenied', code: 'VERIFIER_PLAN_PRE_REVIEW_DENIED', reason: 'the plan omits a rollback step' })

    expect(decision).toEqual({
      kind: 'deny',
      reason: 'scored 40.0% against a 60% threshold.',
      info: { name: 'VerifierPlanPreReviewDenied', code: 'VERIFIER_PLAN_PRE_REVIEW_DENIED', reason: 'the plan omits a rollback step' },
    })
  })

  it('keeps the detail serializable, because the host persists it as durable error data', () => {
    const decision = denyWithInfo('reason', { name: 'N', code: 'C', reason: undefined })

    expect(JSON.parse(JSON.stringify(decision))).toEqual({ kind: 'deny', reason: 'reason', info: { name: 'N', code: 'C' } })
  })

  it('selects cancellation rather than a refusal', () => {
    expect(cancelledCall()).toEqual({ kind: 'cancel' })
  })
})
