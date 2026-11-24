/**
 * Shared client-side mirror of the `llm-verifier` settings namespace.
 *
 * Allows the composer model menu and the Settings page to share one live snapshot, stay in sync
 * on Host `settings/document-updated` events, and serialize writes through the same revisioned
 * `replace`/`update` contract as the full settings form.
 */
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { valuesFromView, type Values } from './client-fields.ts'
import { sectionForSave, tFormat, type I18nDict } from './client-i18n.ts'
import { serializeExtraJudges } from './client-judges.ts'

export const VERIFIER_SETTINGS_NS = 'llm-verifier'

export interface VerifierSettingsRemoteLike {
  describe(): Promise<{
    ok: boolean
    value: { writable: boolean; namespaces: readonly SettingsNamespaceView[] }
    error: { message: string }
  }>
  update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision: number | undefined,
  ): Promise<{
    ok: boolean
    value: SettingsNamespaceView
    error: { message: string }
  }>
  replace?(
    ns: string,
    section: Record<string, unknown>,
    expectedRevision: number | undefined,
  ): Promise<{
    ok: boolean
    value: SettingsNamespaceView
    error: { message: string }
  }>
}

export interface VerifierSettingsSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  view: SettingsNamespaceView | null
  values: Values | null
  writable: boolean
  saving: boolean
  error: string | null
}

const INITIAL_SNAPSHOT: VerifierSettingsSnapshot = Object.freeze({
  status: 'idle',
  view: null,
  values: null,
  writable: false,
  saving: false,
  error: null,
})

function plainRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Compact one-line summary rendered on the `conversation.input.model.options` root menu row.
 * Never surfaces internal "IoT" terminology; stays concise enough for the 240px root menu.
 */
export function formatModelMenuSummary(values: Pick<Values, 'enabled' | 'autoVerifyMode' | 'iotThinking'>, t: I18nDict): string {
  const modeLabel = t[('field.autoVerifyMode.' + values.autoVerifyMode) as keyof I18nDict] as string
  const iotLabel = t[('field.iotThinking.' + values.iotThinking) as keyof I18nDict] as string
  if (!values.enabled && values.iotThinking === 'off') return t['modelMenu.stateDisabled']
  if (!values.enabled) return `${t['modelMenu.iotLabel']} ${iotLabel}`
  if (values.iotThinking === 'off') return modeLabel
  return tFormat(t['modelMenu.stateSummary'], { mode: modeLabel, iot: iotLabel })
}

/**
 * Observable store over the Host's `llm-verifier` settings namespace.
 * Reads coalesce while in flight, and writes serialize behind the latest revision.
 */
export class VerifierSettingsStore {
  private snapshot: VerifierSettingsSnapshot = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private loadingPromise: Promise<void> | null = null
  private writeQueue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly settingsRemote: VerifierSettingsRemoteLike) {}

  getSnapshot(): VerifierSettingsSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  ensureLoaded(): Promise<void> {
    if (this.snapshot.status === 'ready') return Promise.resolve()
    return this.refresh()
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.loadingPromise !== null) return this.loadingPromise
    if (this.snapshot.status === 'idle') {
      this.publish({ ...this.snapshot, status: 'loading', error: null })
    }
    let task: Promise<void> | undefined
    task = (async () => {
      try {
        const res = await this.settingsRemote.describe()
        if (this.disposed) return
        if (!res.ok) throw new Error(res.error.message)
        const view = res.value.namespaces.find(item => item.ns === VERIFIER_SETTINGS_NS)
        if (!view) throw new Error('llm-verifier settings namespace is not registered')
        this.publish({
          status: 'ready',
          view,
          values: valuesFromView(plainRecord(view.value)),
          writable: res.value.writable,
          saving: this.snapshot.saving,
          error: null,
        })
      } catch (cause) {
        if (this.disposed) return
        this.publish({
          ...this.snapshot,
          status: this.snapshot.values === null ? 'error' : 'ready',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        if (this.loadingPromise === task) this.loadingPromise = null
      }
    })()
    this.loadingPromise = task
    return task
  }

  /**
   * Apply a partial quick-control patch (`enabled`, `autoVerifyMode`, `iotThinking`) using the
   * exact same base-inheritance and revision semantics as the full Settings page.
   * @returns `null` on success, or an error message on rejection.
   */
  patch(changes: Partial<Pick<Values, 'enabled' | 'autoVerifyMode' | 'iotThinking'>>): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      if (this.disposed) return null
      if (this.snapshot.view === null || this.snapshot.values === null) {
        await this.refresh()
      }
      const current = this.snapshot
      if (this.disposed) return null
      if (current.view === null || current.values === null) {
        return current.error ?? 'settings unavailable'
      }
      if (!current.writable) return 'read-only'
      const nextValues: Values = { ...current.values, ...changes }
      this.publish({ ...current, saving: true, error: null })
      try {
        const editable: Record<string, unknown> = {
          ...nextValues,
          extraJudges: serializeExtraJudges(nextValues.extraJudges),
          reasoningEffort: nextValues.reasoningEffort || undefined,
          label: nextValues.label?.trim() || undefined,
        }
        const base = current.view.base === undefined ? undefined : plainRecord(current.view.base)
        const replaceFn = this.settingsRemote.replace
        const canReplace = typeof replaceFn === 'function'
        const section = sectionForSave(plainRecord(current.view.user), editable, base, { reInheritBase: canReplace })
        const res = canReplace
          ? await replaceFn.call(this.settingsRemote, VERIFIER_SETTINGS_NS, section, current.view.revision)
          : await this.settingsRemote.update(VERIFIER_SETTINGS_NS, section, current.view.revision)
        if (this.disposed) return null
        if (!res.ok) throw new Error(res.error.message)
        this.publish({
          status: 'ready',
          view: res.value,
          values: valuesFromView(plainRecord(res.value.value)),
          writable: current.writable,
          saving: false,
          error: null,
        })
        return null
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause)
        if (!this.disposed) {
          this.publish({ ...this.snapshot, saving: false, error: msg })
        }
        return msg
      }
    }
    const chained = this.writeQueue.catch(() => null).then(run)
    this.writeQueue = chained
    return chained
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private publish(next: VerifierSettingsSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) {
      try { listener() } catch { /* isolate throwing UI listeners */ }
    }
  }
}
