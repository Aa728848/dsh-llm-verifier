import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { en, zh } from '../../src/client/model/client-i18n.ts'
import {
  VERIFIER_SETTINGS_NS,
  VerifierSettingsStore,
  formatModelMenuSummary,
  type VerifierSettingsRemoteLike,
} from '../../src/client/model/client-settings-store.ts'

function namespaceView(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: VERIFIER_SETTINGS_NS,
    revision: 1,
    applies: 'live',
    base: { enabled: true, autoVerifyMode: 'smart', iotThinking: 'off', provider: 'deepseek-official', model: 'deepseek-flash' },
    user: {},
    value: { enabled: true, autoVerifyMode: 'smart', iotThinking: 'off', provider: 'deepseek-official', model: 'deepseek-flash' },
    ...overrides,
  } as unknown as SettingsNamespaceView
}

describe('formatModelMenuSummary', () => {
  it('renders concise mode and auxiliary-thinking labels without surfacing internal IoT jargon', () => {
    expect(formatModelMenuSummary({ enabled: false, autoVerifyMode: 'smart', iotThinking: 'off' }, zh)).toBe('已停用')
    expect(formatModelMenuSummary({ enabled: false, autoVerifyMode: 'smart', iotThinking: 'off' }, en)).toBe('Off')

    expect(formatModelMenuSummary({ enabled: true, autoVerifyMode: 'smart', iotThinking: 'off' }, zh)).toBe('智能')
    expect(formatModelMenuSummary({ enabled: true, autoVerifyMode: 'strict', iotThinking: 'balanced' }, zh)).toBe('严格 · 思考 均衡')
    expect(formatModelMenuSummary({ enabled: true, autoVerifyMode: 'strict', iotThinking: 'balanced' }, en)).toBe('Strict · Think Balanced')
    expect(formatModelMenuSummary({ enabled: true, autoVerifyMode: 'strict', iotThinking: 'balanced' }, en)).not.toContain('IoT')

    // Auxiliary thinking operates independently when review tools are switched off (D15).
    expect(formatModelMenuSummary({ enabled: false, autoVerifyMode: 'manual', iotThinking: 'compact' }, zh)).toBe('辅助思考 精简')
    expect(formatModelMenuSummary({ enabled: false, autoVerifyMode: 'manual', iotThinking: 'compact' }, en)).toBe('Auxiliary thinking Compact')
  })
})

describe('VerifierSettingsStore', () => {
  it('coalesces concurrent reads and serializes writes with updated revisions', async () => {
    let currentView = namespaceView({ revision: 3 })
    const describeSpy = vi.fn(async () => ({
      ok: true,
      value: { writable: true, namespaces: [currentView] },
      error: { message: '' },
    }))
    const seenRevisions: Array<number | undefined> = []
    const replaceSpy = vi.fn(async (_ns: string, section: Record<string, unknown>, rev: number | undefined) => {
      seenRevisions.push(rev)
      currentView = namespaceView({
        revision: (rev ?? 0) + 1,
        user: { ...section },
        value: { ...(currentView.base as Record<string, unknown>), ...section },
      })
      return { ok: true, value: currentView, error: { message: '' } }
    })
    const remote: VerifierSettingsRemoteLike = {
      describe: describeSpy,
      update: replaceSpy,
      replace: replaceSpy,
    }
    const store = new VerifierSettingsStore(remote)

    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    expect(describeSpy).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().values?.autoVerifyMode).toBe('smart')

    const [firstErr, secondErr] = await Promise.all([
      store.patch({ autoVerifyMode: 'strict' }),
      store.patch({ iotThinking: 'balanced' }),
    ])
    expect(firstErr).toBeNull()
    expect(secondErr).toBeNull()
    expect(seenRevisions).toEqual([3, 4])
    expect(store.getSnapshot().values?.autoVerifyMode).toBe('strict')
    expect(store.getSnapshot().values?.iotThinking).toBe('balanced')
    store.dispose()
  })

  it('refuses writes when settings are read-only and falls back to update when replace is absent', async () => {
    const updateSpy = vi.fn(async (_ns: string, patch: Record<string, unknown>, rev: number | undefined) => ({
      ok: true,
      value: namespaceView({
        revision: (rev ?? 0) + 1,
        user: patch,
        value: { enabled: false, autoVerifyMode: 'smart', iotThinking: 'off', provider: 'deepseek-official', model: 'deepseek-flash', ...patch },
      }),
      error: { message: '' },
    }))
    const readOnlyStore = new VerifierSettingsStore({
      describe: async () => ({ ok: true, value: { writable: false, namespaces: [namespaceView()] }, error: { message: '' } }),
      update: updateSpy,
    })
    await readOnlyStore.ensureLoaded()
    expect(await readOnlyStore.patch({ enabled: false })).toBe('read-only')
    expect(updateSpy).not.toHaveBeenCalled()

    const fallbackStore = new VerifierSettingsStore({
      describe: async () => ({ ok: true, value: { writable: true, namespaces: [namespaceView()] }, error: { message: '' } }),
      update: updateSpy,
    })
    await fallbackStore.ensureLoaded()
    expect(await fallbackStore.patch({ enabled: false })).toBeNull()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(fallbackStore.getSnapshot().values?.enabled).toBe(false)
  })
})
