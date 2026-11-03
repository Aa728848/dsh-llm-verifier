import { describe, expect, it } from 'vitest'
import {
  IOT_AUX_TIMEOUT_MS, IOT_MAX_CHARS, IOT_MAX_SESSIONS, IOT_MIN_CHARS, IOT_MODES, IOT_STRATEGIES,
  findIoTTarget, isIoTMode, isIoTTargetEnabled, resolveIoTRequestRoute, strategyFor,
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
  it('enables nothing without a target, including deepseek-official', () => {
    const targets = [{ provider: 'opendesign', model: 'deepseek-v4.1-flash' }, { provider: 'kimi-code' }]
    // The provider that used to be exempt is the boundary this rewrite exists for: an empty list
    // enables nothing, so no provider ever spends another provider's credential by default.
    expect(isIoTTargetEnabled([], 'deepseek-official', 'anything')).toBe(false)
    expect(isIoTTargetEnabled([], 'opendesign', 'deepseek-v4.1-flash')).toBe(false)
    expect(isIoTTargetEnabled(targets, 'opendesign', 'deepseek-v4.1-flash')).toBe(true)
    expect(isIoTTargetEnabled(targets, 'opendesign', 'other-model')).toBe(false)
    expect(isIoTTargetEnabled(targets, 'kimi-code', 'any-model')).toBe(true)
  })

  it('returns the matching target itself, so the overrides travel with the decision', () => {
    const targets = [{ provider: 'kimi-code', rewriteProvider: 'deepseek-account' }]
    expect(findIoTTarget([], 'deepseek-official', 'deepseek-reasoner')).toBeUndefined()
    expect(findIoTTarget(targets, 'kimi-code', 'any-model')).toEqual(targets[0])
    expect(isIoTTargetEnabled(targets, 'kimi-code', 'any-model')).toBe(true)
  })

  it('falls back to the main route itself before any provider default', () => {
    const main = { provider: 'deepseek-account', model: 'deepseek-reasoner' }
    expect(resolveIoTRequestRoute({}, main)).toEqual({
      provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low',
    })
    // Blank strings are absences, not choices: a saved '' must not shadow the main route.
    expect(resolveIoTRequestRoute({ provider: '  ', model: '  ', reasoningEffort: '  ' }, main)).toEqual({
      provider: 'deepseek-account', model: 'deepseek-reasoner', reasoningEffort: 'low',
    })
    expect(resolveIoTRequestRoute({ provider: 'global-provider', model: 'global-model', reasoningEffort: 'high' }, main, {
      provider: 'opendesign', rewriteProvider: 'rewrite-provider', rewriteModel: 'rewrite-model', rewriteEffort: 'max',
    })).toEqual({ provider: 'rewrite-provider', model: 'rewrite-model', reasoningEffort: 'max' })
    expect(resolveIoTRequestRoute({ provider: 'global-provider', model: 'global-model', reasoningEffort: 'high' }, main, {
      provider: 'opendesign', rewriteProvider: 'rewrite-provider',
    })).toEqual({ provider: 'rewrite-provider', model: 'global-model', reasoningEffort: 'high' })
    expect(resolveIoTRequestRoute({ provider: 'global-provider' }, main, { provider: 'opendesign' })).toEqual({
      provider: 'global-provider', model: 'deepseek-reasoner', reasoningEffort: 'low',
    })
  })
})
