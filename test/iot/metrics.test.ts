import { describe, expect, it } from 'vitest'
import { IOT_MAX_SESSIONS, IoTSessions, copyMetrics, emptySessionMetrics } from '../../src/iot/index.ts'

describe('session counters', () => {
  it('start at zero and stay independent per side', () => {
    const metrics = emptySessionMetrics('compact')
    expect(metrics.main).toEqual({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 })
    expect(metrics.auxiliary).toEqual({ calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 })
    expect(metrics.replacements + metrics.kept + metrics.failures + metrics.skips).toBe(0)
    expect(metrics.chars).toEqual({ original: 0, emitted: 0 })
  })

  it('copies deeply so a snapshot cannot mutate the live counters', () => {
    const live = emptySessionMetrics('compact')
    live.main.inputTokens = 5
    const copy = copyMetrics(live)
    copy.main.inputTokens = 99
    copy.chars.emitted = 7
    expect(live.main.inputTokens).toBe(5)
    expect(live.chars.emitted).toBe(0)
  })
})

describe('IoTSessions', () => {
  it('creates counters on first use and updates the recorded strategy', () => {
    const sessions = new IoTSessions()
    expect(sessions.metrics('s-1')).toBeUndefined()
    const live = sessions.metricsFor('s-1', 'compact')
    live.replacements = 2
    expect(sessions.metrics('s-1')?.replacements).toBe(2)
    expect(sessions.metrics('s-1')?.mode).toBe('compact')
    sessions.metricsFor('s-1', 'full')
    expect(sessions.metrics('s-1')?.mode).toBe('full')
  })

  it('bounds the table and evicts the least recently used session', () => {
    const sessions = new IoTSessions(2)
    sessions.metricsFor('s-1', 'full').replacements = 1
    sessions.metricsFor('s-2', 'compact').kept = 1
    expect(sessions.size).toBe(2)
    // Reading s-1 makes s-2 the oldest.
    sessions.metrics('s-1')
    sessions.metricsFor('s-3', 'compact')
    expect(sessions.size).toBe(2)
    expect(sessions.metrics('s-2')).toBeUndefined()
    expect(sessions.metrics('s-1')?.replacements).toBe(1)
    expect(sessions.metrics('s-3')).toBeDefined()
  })

  it('retains the default number of sessions and no more', () => {
    const sessions = new IoTSessions()
    for (let at = 0; at < IOT_MAX_SESSIONS; at += 1) sessions.metricsFor('s-' + at, 'compact')
    expect(sessions.size).toBe(IOT_MAX_SESSIONS)
    sessions.metricsFor('s-extra', 'compact')
    expect(sessions.size).toBe(IOT_MAX_SESSIONS)
    expect(sessions.metrics('s-0')).toBeUndefined()
    expect(sessions.metrics('s-extra')).toBeDefined()
  })

  it('clears one session entirely', () => {
    const sessions = new IoTSessions()
    sessions.metricsFor('s-1', 'full')
    sessions.clear('s-1')
    expect(sessions.metrics('s-1')).toBeUndefined()
    expect(sessions.size).toBe(0)
  })

  it('refuses a non-positive limit', () => {
    expect(() => new IoTSessions(0)).toThrow(/positive integer/)
    expect(() => new IoTSessions(1.5)).toThrow(/positive integer/)
  })
})
