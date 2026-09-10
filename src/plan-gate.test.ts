import { describe, expect, it } from 'vitest'
import { buildPlanPreReviewPrompt, parseVerdictLetter, planFromArguments } from './plan-gate.ts'

describe('plan-gate', () => {
  it('reads the plan markdown out of exit_plan_mode arguments', () => {
    expect(planFromArguments({ plan: '  # Plan\nStep 1  ' })).toBe('# Plan\nStep 1')
    expect(planFromArguments({ plan: '   ' })).toBe('')
    expect(planFromArguments({})).toBe('')
    expect(planFromArguments({ plan: 42 })).toBe('')
    expect(planFromArguments('plan')).toBe('')
    expect(planFromArguments(null)).toBe('')
    expect(planFromArguments(undefined)).toBe('')
  })

  it('builds plan review prompt with requirements and an exact verdict line', () => {
    const prompt = buildPlanPreReviewPrompt('Implement Redis cache', '1. Connect redis 2. Cache queries', 5000)
    expect(prompt).toContain('You are an expert independent technical plan verifier')
    expect(prompt).toContain('Implement Redis cache')
    expect(prompt).toContain('1. Connect redis 2. Cache queries')
    expect(prompt).toContain('Verdict: <single uppercase letter A-T>')
  })

  it('parses a whole verdict line into the A-T score scale', () => {
    const perfect = parseVerdictLetter('Verdict: A\nSummary: Outstanding plan.\nVerification is complete.')
    expect(perfect?.verdict).toBe('A')
    expect(perfect?.score).toBe(1.0)
    expect(perfect?.feedback).toContain('Outstanding plan')

    const failed = parseVerdictLetter('Verdict: T\nSummary: Completely unfeasible.')
    expect(failed?.verdict).toBe('T')
    expect(failed?.score).toBe(0.0)

    const middle = parseVerdictLetter('Verdict: C\nSummary: Mostly good.')
    expect(middle?.verdict).toBe('C')
    expect(middle?.score).toBeCloseTo(1 - 2 / 19, 3)

    expect(parseVerdictLetter('Summary: fine\n  verdict:  d  \nNotes: ok')?.score).toBeCloseTo(1 - 3 / 19, 3)
  })

  it('reads a verdict line wrapped in markdown decoration', () => {
    expect(parseVerdictLetter('**Verdict: A**\nSummary: ok')?.verdict).toBe('A')
    expect(parseVerdictLetter('**Verdict**: B')?.score).toBeCloseTo(1 - 1 / 19, 3)
    expect(parseVerdictLetter('- Verdict: C.')?.verdict).toBe('C')
    expect(parseVerdictLetter('1. Verdict: D)')?.verdict).toBe('D')
    expect(parseVerdictLetter('`Verdict: E`')?.verdict).toBe('E')
    expect(parseVerdictLetter('### Verdict: T')?.score).toBe(0)
  })

  it('never scores prose, a missing verdict, or a trailing explanation', () => {
    expect(parseVerdictLetter('Verdict: Failed\nSummary: the plan cannot work')).toBeUndefined()
    expect(parseVerdictLetter('Verdict: Approved')).toBeUndefined()
    expect(parseVerdictLetter('Verdict: A because the plan is great')).toBeUndefined()
    expect(parseVerdictLetter('Summary: no verdict line at all')).toBeUndefined()
    expect(parseVerdictLetter('')).toBeUndefined()
  })
})
