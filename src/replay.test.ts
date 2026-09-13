import { describe, expect, it } from 'vitest'
import { evaluateSample, parseEvaluationSample, parseStatisticsRecords, replayDecisionScores, summarizeEvaluation, summarizeProcessCycles, summarizeRouteCycles, sweepThresholds } from './replay.ts'

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

const routeStatistics = JSON.stringify({
  version: 1,
  records: [
    { toolName: 'verifier_route_classify', startedAt: 1, success: true, stats: { calls: 1 }, verdict: { phase: 'semantic', outcome: 'classified' }, route: { cycleId: 'c1', trigger: 'turn-stopping', stage: 'classification', destination: 'unresolved', attempt: 1, reservedCalls: 1 } },
    { toolName: 'verifier_compare', startedAt: 2, success: true, stats: { calls: 6 }, verdict: { phase: 'compare', outcome: 'compared' }, route: { cycleId: 'c1', trigger: 'turn-stopping', stage: 'execution', destination: 'compare', attempt: 1, reservedCalls: 7 } },
    { toolName: 'verifier_select', startedAt: 3, success: true, stats: { calls: 3 }, verdict: { phase: 'select', outcome: 'ranked' }, route: { cycleId: 'c2', trigger: 'pre-step', stage: 'execution', destination: 'select', attempt: 2, reservedCalls: 3 } },
    { toolName: 'verifier_compare', startedAt: 4, success: true, stats: { calls: 0 }, verdict: { phase: 'semantic', outcome: 'classification-only-budget' }, route: { cycleId: 'c3', trigger: 'turn-stopping', stage: 'skipped', destination: 'compare', attempt: 3, reservedCalls: 1, skipReason: 'classification-only-budget', usageIncomplete: true } },
    { toolName: 'verifier_current_session', startedAt: 5, success: true, stats: { calls: 6 }, verdict: { phase: 'final', outcome: 'passed' }, route: { cycleId: 'c4', trigger: 'turn-stopping', stage: 'final', destination: 'final', attempt: 1, reservedCalls: 6 } },
  ],
})

describe('summarizeRouteCycles', () => {
  it('separates cycles, rows, reserved calls and actual scoring calls', () => {
    const records = parseStatisticsRecords(routeStatistics)
    expect(records[0]!.calls).toBe(1)
    expect(records[0]!.route).toMatchObject({ cycleId: 'c1', trigger: 'turn-stopping', stage: 'classification' })
    const summary = summarizeRouteCycles(records)
    // c1 (classification + execution), c2 (pre-step execution), c3 (skipped), c4 (final).
    expect(summary.cycles).toBe(4)
    expect(summary.classificationRows).toBe(1)
    expect(summary.executionRows).toBe(2)
    expect(summary.finalRows).toBe(1)
    expect(summary.skippedRows).toBe(1)
    expect(summary.classificationOnly).toBe(1)
    expect(summary.usageIncomplete).toBe(1)
    expect(summary.preStepExecutions).toBe(1)
    expect(summary.preStepShare).toBe(0.5)
    // c1 promoted 1 -> 7 calls; the cycle's reservation is 7, not 8.
    expect(summary.reservedCalls).toBe(7 + 3 + 1 + 6)
    expect(summary.actualScoringCalls).toBe(6 + 3 + 6)
    expect(summary.classificationOnlyShare).toBe(1)
    expect(summary.bySkipReason).toEqual({ 'classification-only-budget': 1 })
  })

  it('ignores records without an observation and survives a malformed one', () => {
    const records = parseStatisticsRecords(JSON.stringify({ version: 1, records: [
      { toolName: 'verifier_compare', startedAt: 1, success: true, stats: { calls: 3 } },
      { toolName: 'verifier_compare', startedAt: 2, success: true, stats: { calls: 3 }, route: { cycleId: 'x' } },
    ] }))
    expect(records).toHaveLength(2)
    expect(records[0]!.route).toBeUndefined()
    expect(records[1]!.route).toBeUndefined()
    expect(summarizeRouteCycles(records)).toMatchObject({ cycles: 0, executionRows: 0, reservedCalls: 0 })
  })
})

const processStatistics = JSON.stringify({
  version: 1,
  records: [
    // purchased, winner delivered, augmented arm
    { toolName: 'verifier_compare', startedAt: 1, success: true, stats: { calls: 7 }, verdict: { phase: 'process', outcome: 'candidate-selected' }, route: { cycleId: 'p1', trigger: 'llm-stream', stage: 'process', destination: 'process', replayed: 'candidate', generatedCalls: 1, judgeCalls: 6, alternativeAugmented: true } },
    // purchased, the winner was withheld in the last window and the row was corrected, augmented arm
    { toolName: 'verifier_compare', startedAt: 2, success: true, stats: { calls: 7 }, verdict: { phase: 'process', outcome: 'candidate-not-delivered (switch-off)' }, route: { cycleId: 'p2', trigger: 'llm-stream', stage: 'process', destination: 'process', replayed: 'original', generatedCalls: 1, judgeCalls: 6, alternativeAugmented: true } },
    // purchased, identical candidates so no judge was called, plain arm
    { toolName: 'verifier_compare', startedAt: 3, success: true, stats: { calls: 1 }, verdict: { phase: 'process', outcome: 'identical-candidate' }, route: { cycleId: 'p3', trigger: 'llm-stream', stage: 'process', destination: 'process', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true } },
    // purchased, the generation failed, plain arm
    { toolName: 'verifier_compare', startedAt: 4, success: false, stats: { calls: 1 }, verdict: { phase: 'process', outcome: 'generation-failed' }, route: { cycleId: 'p4', trigger: 'llm-stream', stage: 'process', destination: 'process', replayed: 'original', generatedCalls: 1, judgeCalls: 0 } },
    // declined before any purchase: a diagnostic row, never a cycle
    { toolName: 'verifier_compare', startedAt: 5, success: true, stats: { calls: 0 }, verdict: { phase: 'process', outcome: 'no-process-budget' }, route: { cycleId: 'diagnostic-1', trigger: 'llm-stream', stage: 'skipped', destination: 'process', skipReason: 'no-process-budget', replayed: 'none', generatedCalls: 0, judgeCalls: 0 } },
    // an ordinary routing row must not leak into the process section
    { toolName: 'verifier_track', startedAt: 6, success: true, stats: { calls: 3 }, verdict: { phase: 'routing', outcome: 'compared' }, route: { cycleId: 'r1', trigger: 'turn-stopping', stage: 'execution', destination: 'track' } },
  ],
})

describe('summarizeProcessCycles', () => {
  it('counts purchases, deliveries, identical candidates and both arms', () => {
    const records = parseStatisticsRecords(processStatistics)
    // The P06-only observation fields survive the loose reader, or the whole section reports zero.
    expect(records[0]!.route).toMatchObject({ replayed: 'candidate', generatedCalls: 1, judgeCalls: 6, alternativeAugmented: true })
    expect(records[2]!.route?.sameCandidate).toBe(true)
    expect(records[4]!.route).toMatchObject({ stage: 'skipped', skipReason: 'no-process-budget', replayed: 'none' })
    const summary = summarizeProcessCycles(records)
    expect(summary.purchased).toBe(4)
    expect(summary.skipped).toBe(1)
    expect(summary.byOutcome).toEqual({ 'candidate-selected': 1, 'candidate-not-delivered (switch-off)': 1, 'identical-candidate': 1, 'generation-failed': 1 })
    expect(summary.bySkipReason).toEqual({ 'no-process-budget': 1 })
    // A withheld winner is an ORIGINAL replay: the replacement rate must not count it.
    expect([summary.replayedCandidate, summary.replayedOriginal, summary.replayedNone]).toEqual([1, 3, 0])
    expect(summary.effectiveReplacementRate).toBe(0.25)
    expect(summary.sameCandidate).toBe(1)
    expect(summary.sameCandidateRate).toBe(0.25)
    // Two augmented cycles with one delivery, two plain cycles with none: the arms are separable.
    expect(summary.augmented).toBe(2)
    expect(summary.augmentedReplacementRate).toBe(0.5)
    expect(summary.plainReplacementRate).toBe(0)
    // Added calls exclude the routing row and the unpurchased skip.
    expect(summary.addedCalls).toBe(16)
    expect([summary.generatedCalls, summary.judgeCalls]).toEqual([4, 12])
  })

  it('reports zero rates, never NaN, when nothing was purchased', () => {
    const records = parseStatisticsRecords(JSON.stringify({ version: 1, records: [
      { toolName: 'verifier_track', startedAt: 1, success: true, stats: { calls: 3 }, route: { cycleId: 'r1', trigger: 'turn-stopping', stage: 'execution', destination: 'track' } },
    ] }))
    const summary = summarizeProcessCycles(records)
    expect(summary).toMatchObject({ purchased: 0, skipped: 0, effectiveReplacementRate: 0, sameCandidateRate: 0, augmentedReplacementRate: 0, plainReplacementRate: 0 })
    expect(Number.isNaN(summary.effectiveReplacementRate)).toBe(false)
  })
})
const userEvent = (seq, text) => ({ type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const callEvent = (seq, id, name) => ({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId: id, name, arguments: '{}' } })
const resultEvent = (seq, id, text) => ({ type: 'tool/result', seq, data: { turn: 1, step: 1, message: { source: { callId: id }, content: [{ type: 'text', text }] } } })
const todoEvent = (seq, todos) => ({ type: 'todo/write', seq, data: { todos } })
const candidate = (id, label) => ({ id, label, status: 'completed', content: 'body ' + id })
const workflowText = (rows) => 'workflow "w" completed (' + rows.length + ' agents).\nReturn value:\n' + JSON.stringify({ protocol: 'dsh-verifier-candidates', version: 1, groupId: 'g', candidates: rows })
const envelopeEvents = (rows) => [userEvent(0, 'Pick one and build it'), callEvent(1, 'w', 'workflow'), resultEvent(2, 'w', workflowText(rows))]

const SAMPLE_SET = [
  { id: 'code-compare', category: 'code', shouldReview: true, expectedPhases: ['compare'], events: envelopeEvents([candidate('1', 'C1'), candidate('2', 'C2')]) },
  { id: 'research-subagents', category: 'research', shouldReview: true, expectedPhases: ['compare'], events: [userEvent(0, 'Research both'), callEvent(1, 's', 'subagent'), resultEvent(2, 's', 'findings')] },
  { id: 'long-task-track', category: 'long-task', shouldReview: true, expectedPhases: ['track'], events: [userEvent(0, 'Implement it'), todoEvent(1, [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }]), callEvent(2, 'e', 'edit'), resultEvent(3, 'e', 'edited'), todoEvent(4, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }])] },
  { id: 'candidates-select', category: 'candidates', shouldReview: true, expectedPhases: ['select'], events: envelopeEvents([candidate('1', 'C1'), candidate('2', 'C2'), candidate('3', 'C3')]) },
  { id: 'chat-false-trigger', category: 'conversational', shouldReview: false, events: envelopeEvents([candidate('1', 'C1'), candidate('2', 'C2')]) },
  { id: 'writing-plain', category: 'writing', shouldReview: false, events: [userEvent(0, 'Draft a note'), callEvent(1, 'e', 'edit'), resultEvent(2, 'e', 'drafted')] },
  { id: 'chat-plain', category: 'conversational', shouldReview: false, events: [userEvent(0, 'What does this flag do?')] },
  // Eligible (3 tool calls, real state changes) but no structural artifact and no semantic hint:
  // the final acceptance still grades it, so it must count as a hit rather than a miss.
  { id: 'code-final-only', category: 'code', shouldReview: true, expectedPhases: ['final'], events: [userEvent(0, 'Fix and test it'), callEvent(1, 'e', 'edit'), resultEvent(2, 'e', 'edited'), callEvent(3, 'r', 'read'), resultEvent(4, 'r', 'file'), callEvent(5, 'p', 'pwsh'), resultEvent(6, 'p', 'Tests 3 passed')] },
]

describe('labeled offline evaluation', () => {
  it('scores trigger precision and recall against real labels without a model call', () => {
    const report = summarizeEvaluation(SAMPLE_SET)
    expect(report.samples).toBe(8)
    expect(report.hits).toBe(5)
    expect(report.misses).toBe(0)
    expect(report.falseTriggers).toBe(1)
    expect(report.correctSkips).toBe(2)
    expect(report.precision).toBeCloseTo(5 / 6)
    expect(report.recall).toBe(1)
    // The eligible-only task is the regression: without eligibility in observedTrigger it is a miss.
    const eligibleOnly = report.outcomes.find(entry => entry.id === 'code-final-only')!
    expect(eligibleOnly.eligible).toBe(true)
    expect(eligibleOnly.observedTrigger).toBe(true)
    expect(eligibleOnly.outcome).toBe('hit')
    // Phase coverage counts samples, so a labeled compare that the detector finds is visible.
    // Two samples are labeled "compare", and the detector finds both (one structured, one from
    // the false-trigger sample), so the coverage row counts samples rather than model calls.
    expect(report.phaseMatches.find(row => row.phase === 'compare')).toMatchObject({ expected: 2, observed: 2 })
    expect(report.phaseMatches.find(row => row.phase === 'track')!.observed).toBeGreaterThanOrEqual(1)
  })

  it('uses the production detectors, so a delivery-ready sample is reported as eligible', () => {
    const sample = {
      id: 'delivery', category: 'long-task', shouldReview: true,
      events: [
        userEvent(0, 'Implement and test'), callEvent(1, 'e', 'edit'), resultEvent(2, 'e', 'edited'),
        callEvent(3, 'r', 'read'), resultEvent(4, 'r', 'file contents'),
        callEvent(5, 'p', 'pwsh'), resultEvent(6, 'p', 'Tests 3 passed'),
        todoEvent(7, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }]),
      ],
    }
    const outcome = evaluateSample(sample)
    expect(outcome.deliveryReady).toBe(true)
    expect(outcome.eligible).toBe(true)
    expect(outcome.observedPhases).toContain('final')
  })

  it('validates sample files loosely and rejects an unknown category', () => {
    const valid = parseEvaluationSample({ id: 's1', category: 'code', shouldReview: true, events: [], expectedPhases: ['compare', 'nonsense'] })
    expect(valid).toMatchObject({ id: 's1', category: 'code', expectedPhases: ['compare'] })
    expect(parseEvaluationSample({ id: 's2', category: 'nope', shouldReview: true, events: [] })).toBeUndefined()
    expect(parseEvaluationSample({ id: 's3', category: 'code', shouldReview: true })).toBeUndefined()
    expect(parseEvaluationSample(null)).toBeUndefined()
  })
})
