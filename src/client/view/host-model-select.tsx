import { useEffect, useMemo, useRef } from 'react'
import * as nativeModelSelection from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  captureNativeModelSelect,
  createModelDirectory,
  type JudgeModelSelection,
  type ModelCatalogFailureView,
  type ModelProviderGroupView,
} from '../model/client-native-model.ts'
import { dictionaries, tFormat } from '../model/client-i18n.ts'

const native = captureNativeModelSelect(nativeModelSelection)
const NativeModelSelect = native.component

export interface HostModelSelectProps {
  lang: 'zh' | 'en'
  selection: JudgeModelSelection
  groups: readonly ModelProviderGroupView[]
  failures: readonly ModelCatalogFailureView[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  readOnly: boolean
  onSelect(selection: JudgeModelSelection): void | Promise<void>
  onReload(): void
}

/** DSH's own two-level model/effort selector, controlled by the plugin's settings draft. */
export function HostModelSelect(props: HostModelSelectProps) {
  const { selection, groups, failures, status, error, readOnly, onSelect, onReload, lang } = props
  const directory = useMemo(() => createModelDirectory({
    current: selection,
    retainedEffort: selection.reasoningEffort,
    routable: null,
    groups,
    failures,
    status,
    pending: null,
    error,
  }), [])
  useEffect(() => {
    const routable = status === 'loading' || status === 'idle'
      ? null
      : groups.some(group => group.id === selection.provider && group.models.some(model => model.id === selection.model))
    directory.update({
      current: selection,
      retainedEffort: selection.reasoningEffort,
      routable,
      groups,
      failures,
      status: directory.store.getSnapshot().pending === null ? status : 'selecting',
      error,
    })
  }, [directory, selection.provider, selection.model, selection.reasoningEffort, groups, failures, status, error])

  const claudeSlot = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onSelect, onReload })
  callbacks.current = { onSelect, onReload }
  const claude = typeof window === 'undefined' ? undefined : (window as unknown as {
    __DSH_CLAUDE_STYLE_CONTROLS__?: {
      has(id: string): boolean
      mount(id: 'model-picker', options: {
        slot: HTMLElement
        directory: { store: typeof directory.store; load(): Promise<void>; select(next: JudgeModelSelection): Promise<void> }
        disabled?: boolean
      }): () => void
    }
  }).__DSH_CLAUDE_STYLE_CONTROLS__
  const claudeAvailable = claude?.has('model-picker') === true
  useEffect(() => {
    if (!claude || !claudeAvailable || !claudeSlot.current) return undefined
    return claude.mount('model-picker', {
      slot: claudeSlot.current,
      disabled: readOnly,
      directory: {
        store: directory.store,
        load: async () => { callbacks.current.onReload() },
        select: async next => {
          directory.update({ status: 'selecting', pending: next, error: null })
          await callbacks.current.onSelect(next)
          directory.update({ current: next, retainedEffort: next.reasoningEffort, status: 'ready', pending: null })
        },
      },
    })
  }, [claude, claudeAvailable, directory, readOnly])
  if (claudeAvailable) return <div ref={claudeSlot} data-claude-model-select style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}/>

  if (!NativeModelSelect) return <LegacyModelSelect {...props} directoryStatus={status}/>
  const translate = (key: string, params?: Record<string, string | number>) =>
    tFormat(native.dictionaries[lang]?.[key] ?? key, params)
  const select = async (next: JudgeModelSelection) => {
    directory.update({ status: 'selecting', pending: next, error: null })
    try {
      await onSelect(next)
      directory.update({ current: next, retainedEffort: next.reasoningEffort, status: 'ready', pending: null })
      return { ok: true as const, value: undefined }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause)
      directory.update({ status: 'error', pending: null, error: text })
      return { ok: false as const, error: { code: 'settings/update-failed', message: text } }
    }
  }
  return <NativeModelSelect
    locked={readOnly}
    available
    directory={directory.store}
    load={onReload}
    select={select}
    t={translate}
    renderSlot={(_name: string, _owner: unknown, options: { fallback?: React.ReactNode }) => options.fallback ?? null}
  />
}

const control: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', height: 36, borderRadius: 8, padding: '0 10px',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-input-major)',
  border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 13,
}

/** Compatibility path for hosts whose model-selection registration predates the reusable component. */
function LegacyModelSelect(props: HostModelSelectProps & { directoryStatus: HostModelSelectProps['status'] }) {
  const { lang, selection, groups, readOnly, onSelect, onReload, directoryStatus, error } = props
  const t = dictionaries[lang]
  const models = groups.find(group => group.id === selection.provider)?.models ?? []
  const selected = models.find(model => model.id === selection.model)
  const efforts = selected?.reasoning?.efforts ?? []
  const loading = directoryStatus === 'loading' || directoryStatus === 'idle'
  const update = (patch: Partial<JudgeModelSelection>) => { void onSelect({ ...selection, ...patch }) }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
    <select style={control} disabled={readOnly || loading} aria-label={t['field.provider.title']} value={selection.provider} onChange={event => {
      const provider = event.target.value
      const first = groups.find(group => group.id === provider)?.models[0]
      void onSelect({ provider, model: first?.id ?? '', ...(first?.reasoning?.defaultEffort ? { reasoningEffort: first.reasoning.defaultEffort } : {}) })
    }}>
      {!groups.some(group => group.id === selection.provider) && selection.provider && <option value={selection.provider}>{selection.provider}</option>}
      {groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.id}</option>)}
    </select>
    <select style={control} disabled={readOnly || loading} aria-label={t['field.model.title']} value={selection.model} onChange={event => {
      const model = models.find(entry => entry.id === event.target.value)
      void onSelect({ ...selection, model: event.target.value, ...(model?.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : { reasoningEffort: undefined }) })
    }}>
      {!models.some(model => model.id === selection.model) && selection.model && <option value={selection.model}>{selection.model}</option>}
      {models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
    </select>
    <select style={control} disabled={readOnly || loading} aria-label={t['field.reasoningEffort.title']} value={selection.reasoningEffort ?? ''} onChange={event => update({ reasoningEffort: event.target.value || undefined })}>
      <option value="">{t['field.reasoningEffort.default']}</option>
      {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
    </select>
    {(loading || error) && <div style={{ fontSize: 12, color: error ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
      {error ?? t['settings.modelsLoading']}{error && <button type="button" onClick={onReload} style={{ marginLeft: 8 }}>{t['settings.retry']}</button>}
    </div>}
  </div>
}
