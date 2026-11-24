import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, zh } from '../../src/client/model/client-i18n.ts'
import {
  SESSION_PANEL_FOLD_LIMIT,
  SESSION_PANEL_FOLD_MIN_HIDDEN,
  VerifierSessionMonitor,
  hasSessionPanelContent,
  sessionPanelActionSummary,
  sessionPanelIndicatorState,
  sessionPanelRecordPresentation,
  type SessionVerifierRecordView,
  type SessionVerifierSnapshot,
  type SessionVerifierSummaryView,
} from '../../src/client/model/client-session-store.ts'

function record(overrides: Partial<SessionVerifierRecordView> = {}): SessionVerifierRecordView {
  return {
    id: 'rec-1',
    toolName: 'verifier_current_session',
    startedAt: 1_700_000_000_000,
    durationMs: 1_450,
    success: true,
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    stats: {
      calls: 2,
      inputTokens: 900,
      cachedInputTokens: 300,
      outputTokens: 120,
      reasoningTokens: 0,
      cacheHits: 0,
      cacheMisses: 2,
      estimatedCostUsd: 0.0024,
    },
    verdict: {
      phase: 'final',
      outcome: 'passed',
      score: 0.82,
      threshold: 0.65,
      winner: 'A',
    },
    ...overrides,
  }
}

function summary(records: SessionVerifierRecordView[], overrides: Partial<SessionVerifierSummaryView> = {}): SessionVerifierSummaryView {
  return {
    invocations: records.length,
    successes: records.filter(r => r.success).length,
    failures: records.filter(r => !r.success).length,
    calls: records.reduce((acc, r) => acc + r.stats.calls, 0),
    tokens: 1_320 * records.length,
    estimatedCostUsd: 0.0024 * records.length,
    recent: records,
    ...overrides,
  }
}

describe('VerifierSessionMonitor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('deduplicates activity polling and summary fetches across multiple watchers of the same session', async () => {
    vi.useFakeTimers()
    let activityCalls = 0
    let summaryCalls = 0
    const monitor = new VerifierSessionMonitor(undefined, {
      pollMs: 1_000,
      readActivity: async () => {
        activityCalls += 1
        return { active: { stage: 'final', phase: 'accepting', expectedCalls: 6 } }
      },
      readSummary: async () => {
        summaryCalls += 1
        return summary([record()])
      },
    })

    const w1 = monitor.watch('s-1', { running: true, includeSummary: false })
    const w2 = monitor.watch('s-1', { running: true, includeSummary: true })
    const w3 = monitor.watch('s-1', { running: false, includeSummary: true })

    await vi.advanceTimersByTimeAsync(0)
    expect(activityCalls).toBe(1)
    expect(summaryCalls).toBe(1)
    expect(monitor.getSnapshot('s-1').activity?.active?.stage).toBe('final')
    expect(monitor.getSnapshot('s-1').summary?.invocations).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(activityCalls).toBe(2)
    expect(summaryCalls).toBe(1)

    // Removing the running watchers while a summary watcher stays triggers one post-run summary refresh.
    w1()
    w2()
    await vi.advanceTimersByTimeAsync(0)
    expect(summaryCalls).toBe(2)

    // Unsubscribing the final watcher stops all polling and issues no further requests.
    w3()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(activityCalls).toBe(2)
    expect(summaryCalls).toBe(2)
    monitor.dispose()
  })

  it('refreshes the session summary when an active cycle settles and stays idle when nothing runs', async () => {
    vi.useFakeTimers()
    let step = 0
    let summaryCalls = 0
    const monitor = new VerifierSessionMonitor(undefined, {
      pollMs: 1_000,
      readActivity: async () => {
        step += 1
        if (step === 1) return { active: { stage: 'final', phase: 'accepting', expectedCalls: 6 } }
        return { settled: { stage: 'final', outcome: 'accepted' } }
      },
      readSummary: async () => {
        summaryCalls += 1
        return summary(Array.from({ length: summaryCalls }, (_, i) => record({ id: 'rec-' + i })))
      },
    })

    const stopRunning = monitor.watch('s-2', { running: true, includeSummary: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(summaryCalls).toBe(1)

    // Second tick transitions active -> settled, triggering an automatic summary refresh.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(summaryCalls).toBe(2)
    expect(monitor.getSnapshot('s-2').summary?.invocations).toBe(2)

    stopRunning()
    monitor.dispose()
  })

  it('does not poll an idle session when no activity exists', async () => {
    vi.useFakeTimers()
    const readActivity = vi.fn(async () => null)
    const readSummary = vi.fn(async () => summary([]))
    const monitor = new VerifierSessionMonitor(undefined, { pollMs: 1_000, readActivity, readSummary })

    const stop = monitor.watch('s-idle', { running: false, includeSummary: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(readActivity).toHaveBeenCalledTimes(0)
    expect(readSummary).toHaveBeenCalledTimes(1)

    stop()
    monitor.dispose()
  })
})

describe('Session panel view-model projections', () => {
  const empty: SessionVerifierSnapshot = { activity: null, summary: null, loading: false, error: null }

  it('hides the toggle indicator while the panel is shown and distinguishes busy vs rejected states', () => {
    const busy: SessionVerifierSnapshot = { ...empty, activity: { thinking: { startedAt: 100 } } }
    expect(sessionPanelIndicatorState(busy, true, zh)).toBeNull()
    expect(sessionPanelIndicatorState(busy, false, zh)).toMatchObject({ kind: 'busy', label: zh['sessionPanel.indicatorBusy'] })

    const rejected: SessionVerifierSnapshot = { ...empty, activity: { settled: { stage: 'final', outcome: 'rejected' } } }
    expect(sessionPanelIndicatorState(rejected, false, en)).toMatchObject({ kind: 'attention', label: en['sessionPanel.indicatorAttention'] })
    expect(sessionPanelIndicatorState(rejected, true, en)).toBeNull()

    const accepted: SessionVerifierSnapshot = { ...empty, activity: { settled: { stage: 'final', outcome: 'accepted' } } }
    expect(sessionPanelIndicatorState(accepted, false, en)).toBeNull()
    expect(sessionPanelIndicatorState(empty, false, en)).toBeNull()
  })

  it('summarizes heading counts, alert counts, and running status accurately', () => {
    expect(sessionPanelActionSummary(empty, zh)).toBeNull()
    expect(sessionPanelActionSummary({ ...empty, summary: summary([]) }, zh)).toBeNull()
    expect(sessionPanelActionSummary({ ...empty, activity: { active: { stage: 'route', phase: 'classifying' } } }, zh)).toBe('运行中')
    expect(sessionPanelActionSummary({ ...empty, activity: { thinking: { startedAt: 1 } } }, en)).toBe('Running')

    const clean = summary([record({ id: 'a' }), record({ id: 'b' })])
    expect(sessionPanelActionSummary({ ...empty, summary: clean }, zh)).toBe('2 次')
    expect(sessionPanelActionSummary({ ...empty, summary: clean }, en)).toBe('2')

    const withAlert = summary([
      record({ id: 'a' }),
      record({ id: 'b', verdict: { phase: 'final', outcome: 'below-threshold', score: 0.4, threshold: 0.65 } }),
    ])
    expect(sessionPanelActionSummary({ ...empty, summary: withAlert }, zh)).toBe('2 次 · 1 告警')
    expect(sessionPanelActionSummary({ ...empty, summary: withAlert }, en)).toBe('2 · 1 alert')
  })

  it('maps passed, below-threshold, tie, and error records to distinct panel row states and hover facts', () => {
    const passed = sessionPanelRecordPresentation(record(), 'zh', zh)
    expect(passed.dotState).toBe('done')
    expect(passed.trailing).toBe('82%')
    expect(passed.hoverFacts.map(f => f.kind)).toEqual(['tokens', 'duration'])

    const missed = sessionPanelRecordPresentation(
      record({ verdict: { phase: 'final', outcome: 'below-threshold', score: 0.42, threshold: 0.65 } }),
      'en',
      en,
    )
    expect(missed.dotState).toBe('warning')
    expect(missed.trailing).toBe('42%')

    const failed = sessionPanelRecordPresentation(
      record({ success: false, errorName: 'TimeoutError', errorMessage: 'request timed out', verdict: undefined }),
      'zh',
      zh,
    )
    expect(failed.dotState).toBe('error')
    expect(failed.detail).toContain('request timed out')
  })

  it('keeps fold thresholds aligned with the host Session panel contract and hides empty sections', () => {
    expect(SESSION_PANEL_FOLD_LIMIT).toBe(5)
    expect(SESSION_PANEL_FOLD_MIN_HIDDEN).toBe(2)
    expect(hasSessionPanelContent(empty, zh)).toBe(false)
    expect(hasSessionPanelContent({ ...empty, summary: summary([]) }, zh)).toBe(false)
    expect(hasSessionPanelContent({ ...empty, summary: summary([record()]) }, zh)).toBe(true)
    expect(hasSessionPanelContent({ ...empty, activity: { thinking: { startedAt: 1 } } }, zh)).toBe(true)
  })
})
