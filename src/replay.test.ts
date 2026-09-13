import { describe, expect, it } from 'vitest'
import { parseStatisticsRecords, replayDecisionScores, sweepThresholds } from './replay.ts'

const statistics = JSON.stringify({
  version: 1,
  records: [
    { toolName: 'verifier_current_session', startedAt: 1, success: true, verdict: { phase: 'final', score: 1, baselineScore: 0, winner: 'A', criteria: [{ id: 'a', score: 1 }, { id: 'b', score: 1 }], threshold: 0.65 } },
    { toolName: 'verifier_current_session', startedAt: 2, success: true, verdict: { phase: 'final', score: 0.6, baselineScore: 0, winner: 'A', criteria: [{ id: 'a', score: 1 }, { id: 'b', score: 0.2 }], threshold: 0.65 } },
    { toolName: 'verifier_current_session', startedAt: 3, success: false },
    { toolName: 'verifier_compare', startedAt: 4, success: true, verdict: { phase: 'compare', score: 0.9, scoreB: 0.1, winner: 'A' } },
  ],
})

describe('parseStatisticsRecords', () => {
  it('reads the verdict fields a sweep needs and survives a malformed document', () => {
    const records = parseStatisticsRecords(statistics)
    expect(records).toHaveLength(4)
    expect(records[0]).toMatchObject({ toolName: 'verifier_current_session', score: 1, winner: 'A' })
    expect(records[0]!.criteria).toEqual([{ id: 'a', score: 1 }, { id: 'b', score: 1 }])
    // A failed invocation has no verdict at all: it must still parse, with no score.
    expect(records[2]).toMatchObject({ success: false, criteria: [] })
    expect(records[2]!.score).toBeUndefined()
    expect(parseStatisticsRecords('not json')).toEqual([])
    expect(parseStatisticsRecords('{"version":1}')).toEqual([])
  })
})

describe('sweepThresholds', () => {
  it('reports what each threshold decides, including the per-criterion floor', () => {
    const records = parseStatisticsRecords(statistics)
    const rows = sweepThresholds(records, [0.5, 0.65, 0.9])
    // Only the two session acceptances are gate decisions: compare uses another threshold.
    expect(rows.every(row => row.total === 3)).toBe(true)
    // At 0.5 the second record's mean (0.6) clears the bar, but its criterion b = 0.2 does not:
    // that is exactly the failure the mean alone used to hide.
    expect(rows.find(row => row.threshold === 0.5)).toMatchObject({ accepted: 1, rejectedVerdict: 0, rejectedMean: 0, rejectedCriterion: 1, unscored: 1 })
    // At 0.65 the mean itself is short, so the floor never comes into play for that record.
    expect(rows.find(row => row.threshold === 0.65)).toMatchObject({ accepted: 1, rejectedMean: 1, rejectedCriterion: 0, unscored: 1 })
    expect(rows.find(row => row.threshold === 0.9)).toMatchObject({ accepted: 1, rejectedVerdict: 0, rejectedMean: 1, rejectedCriterion: 0, unscored: 1 })
  })

  it('bounds the sweep at the extremes instead of producing NaN', () => {
    const records = parseStatisticsRecords(statistics)
    // A threshold of 0 disables the floor as well: every scored acceptance passes (the one
    // unscored record is never an acceptance, at any threshold).
    expect(sweepThresholds(records, [0])[0]).toMatchObject({ accepted: 2, rejectedCriterion: 0, unscored: 1 })
    expect(sweepThresholds(records, [1])[0]).toMatchObject({ accepted: 1, rejectedMean: 1 })
    expect(sweepThresholds([], [0.65])[0]).toMatchObject({ total: 0, accepted: 0 })
  })
})

describe('replayDecisionScores', () => {
  it('re-parses a stored explicit-tag answer and flags drift and unparseable answers', () => {
    const rows = replayDecisionScores([
      // K is the 10th letter: (20 - 10) - 1 over 19 = 9/19.
      { label: 'clean', channel: 'explicit-tag', output: '<score_A> K </score_A>\n<score_B> T </score_B>', score: 9 / 19 },
      { label: 'changed', channel: 'explicit-tag', output: '<score_A> A </score_A>\n<score_B> T </score_B>', score: 0.5 },
      // A tag that is present but carries no valid letter is a real parser failure.
      { label: 'broken', channel: 'explicit-tag', output: '<score_A> ZZ </score_A>', score: 0.5 },
      { label: 'distribution', channel: 'top-logprobs', output: '<score_A> A </score_A>', score: 0.83 },
    ])
    expect(rows[0]).toMatchObject({ mode: 'match', reparsed: 9 / 19 })
    expect(rows[1]).toMatchObject({ mode: 'drift', reparsed: 1 })
    expect(rows[2]!.mode).toBe('unreadable')
    // A top-logprobs score is an expectation over a distribution the snapshot does not keep.
    expect(rows[3]).toMatchObject({ mode: 'drift', stored: 0.83 })
  })

  it('replays a progress answer against the last checkpoint, inverted, and ignores non-scoring calls', () => {
    const rows = replayDecisionScores([
      // Track stores the LAST checkpoint and progresses A(=0) .. T(=1): <c2> T </c2> is 1.0.
      { label: 'progress repeat 1/3', channel: 'explicit-tag', output: '<c1> K </c1>\n<c2> T </c2>', score: 1 },
      { label: 'progress repeat 2/3', channel: 'explicit-tag', output: '<c1> K </c1>\n<c2> T </c2>', score: 0.5 },
      // A route classification answers strict JSON — no score tag exists by design, and counting
      // it as unreadable made every routing snapshot look like a regression.
      { label: 'route classify', channel: 'explicit-tag', output: '{"kind":"none","confidence":0.9}', score: undefined },
    ])
    expect(rows[0]).toMatchObject({ mode: 'match', reparsed: 1 })
    expect(rows[1]).toMatchObject({ mode: 'drift', reparsed: 1 })
    expect(rows[2]!.mode).toBe('not-scored')
  })
})
