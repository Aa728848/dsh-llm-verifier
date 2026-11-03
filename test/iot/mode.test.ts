import { describe, expect, it } from 'vitest'
import {
  IOT_AUX_TIMEOUT_MS, IOT_MAX_CHARS, IOT_MAX_SESSIONS, IOT_MIN_CHARS, IOT_MODES, IOT_STRATEGIES,
  isIoTMode, isIoTTargetEnabled, resolveIoTRequestRoute, strategyFor,
} from '../../src/iot/index.ts'

describe('strategy table', () => {
  it('carries the approved label counts, node ceilings and token budgets', () => {
    expect(IOT_STRATEGIES.compact).toEqual({ mode: 'compact', labels: expect.any(Array), maxNodes: 5, maxTokens: 800 })
    expect(IOT_STRATEGIES.balanced).toMatchObject({ mode: 'balanced', maxNodes: 6, maxTokens: 1200 })
    expect(IOT_STRATEGIES.full).toMatchObject({ mode: 'full', maxNodes: 8, maxTokens: 1600 })
    expect(IOT_STRATEGIES.compact.labels).toHaveLength(3)
    expect(IOT_STRATEGIES.balanced.labels).toHaveLength(5)
    expect(IOT_STRATEGIES.full.labels).toHaveLength(8)
    expect(new Set(IOT_STRATEGIES.full.labels).size).toBe(8)
  })

  it('fixes the input window and the process-local bound', () => {
    expect(IOT_MIN_CHARS).toBe(400)
    expect(IOT_MAX_CHARS).toBe(24_000)
    expect(IOT_MAX_SESSIONS).toBe(256)
    expect(IOT_AUX_TIMEOUT_MS).toBe(60_000)
  })

  it('maps modes to budgets and off to nothing', () => {
    expect(IOT_MODES).toEqual(['off', 'compact', 'balanced', 'full'])
    expect(isIoTMode('compact')).toBe(true)
    expect(isIoTMode('off')).toBe(true)
    expect(isIoTMode('auto')).toBe(false)
    expect(isIoTMode('Full')).toBe(false)
    expect(strategyFor('off')).toBeUndefined()
    expect(strategyFor('full')).toBe(IOT_STRATEGIES.full)
  })
})


describe('enabled targets and route resolution', () => {
  it('enables deepseek-official by default and other providers only by exact or wildcard target', () => {
    const targets = [{ provider: 'opendesign', model: 'deepseek-v4.1-flash' }, { provider: 'kimi-code' }]
    expect(isIoTTargetEnabled([], 'deepseek-official', 'anything')).toBe(true)
    expect(isIoTTargetEnabled([], 'opendesign', 'deepseek-v4.1-flash')).toBe(false)
    expect(isIoTTargetEnabled(targets, 'opendesign', 'deepseek-v4.1-flash')).toBe(true)
    expect(isIoTTargetEnabled(targets, 'opendesign', 'other-model')).toBe(false)
    expect(isIoTTargetEnabled(targets, 'kimi-code', 'any-model')).toBe(true)
  })

  it('applies global defaults and target-specific auxiliary overrides', () => {
    expect(resolveIoTRequestRoute({}, 'main-model')).toEqual({ provider: 'deepseek-official', model: 'main-model', reasoningEffort: 'low' })
    expect(resolveIoTRequestRoute({ provider: 'global-provider', model: 'global-model', reasoningEffort: 'high' }, 'main-model', {
      provider: 'opendesign', rewriteProvider: 'rewrite-provider', rewriteModel: 'rewrite-model', rewriteEffort: 'max',
    })).toEqual({ provider: 'rewrite-provider', model: 'rewrite-model', reasoningEffort: 'max' })
    expect(resolveIoTRequestRoute({ provider: 'global-provider', model: 'global-model', reasoningEffort: 'high' }, 'main-model', {
      provider: 'opendesign', rewriteProvider: 'rewrite-provider',
    })).toEqual({ provider: 'rewrite-provider', model: 'global-model', reasoningEffort: 'high' })
  })
})
