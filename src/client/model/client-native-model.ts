import type { ComponentType } from 'react'

export interface JudgeModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export type ModelBadgeText = string | ({ en: string } & Record<string, string>)

/** Resolve provider-authored badge text for the settings page's two supported locales. */
export function resolveModelBadgeText(text: ModelBadgeText, lang: 'zh' | 'en'): string {
  return typeof text === 'string' ? text : text[lang] ?? text.en
}

export interface ModelProviderGroupView {
  id: string
  name: string
  models: readonly {
    id: string
    name: string
    reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string }
    badge?: { text: ModelBadgeText; tone: 'neutral' | 'info' | 'success' | 'warning' }
  }[]
}

export interface ModelCatalogFailureView {
  id: string
  name: string
  message: string
}

export interface ModelDirectorySnapshot {
  current: JudgeModelSelection | null
  retainedEffort?: string
  routable: boolean | null
  groups: readonly ModelProviderGroupView[]
  failures: readonly ModelCatalogFailureView[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  pending: JudgeModelSelection | null
  error: string | null
}

export interface ModelDirectoryStore {
  getSnapshot(): ModelDirectorySnapshot
  subscribe(listener: () => void): () => void
}

/** The small external-store face consumed by DSH's ModelSelect. */
export function createModelDirectory(initial: ModelDirectorySnapshot): {
  store: ModelDirectoryStore
  update(patch: Partial<ModelDirectorySnapshot>): void
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    store: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    update(patch) {
      snapshot = { ...snapshot, ...patch }
      for (const listener of listeners) listener()
    },
  }
}

interface NativeModelSelectionModule {
  apply?: (ctx: any) => void
}

export interface NativeModelSelectCapture {
  component?: ComponentType<any>
  dictionaries: Record<'zh' | 'en', Record<string, string>>
}

/**
 * DSH ships ModelSelect through its public plugin registration, but does not re-export the component
 * from the package barrel. Replay that registration against an isolated context to borrow the exact
 * component without mounting a second model-directory service or replacing the composer's slot.
 */
export function captureNativeModelSelect(module: NativeModelSelectionModule): NativeModelSelectCapture {
  const result: NativeModelSelectCapture = { dictionaries: { zh: {}, en: {} } }
  if (typeof module.apply !== 'function') return result
  const noop = () => {}
  const slots = {
    inject(name: string, register: () => void) {
      if (name === 'conversation.input.model') register()
      return noop
    },
    register(_descriptor: unknown, component: ComponentType<any>) {
      result.component = component
      return noop
    },
  }
  const scope = { slots, modelDirectories: {}, sessions: {} }
  const ctx = {
    locale: {
      register(_ns: string, dictionaries: Record<'zh' | 'en', Record<string, string>>) {
        result.dictionaries = dictionaries
        return noop
      },
      bind: () => (key: string) => key,
    },
    effect(callback: () => unknown) { callback(); return noop },
    plugin: noop,
    inject(names: readonly string[], callback: (scope: unknown) => void) {
      if (names.includes('slots') && names.includes('modelDirectories')) callback(scope)
      return noop
    },
  }
  try { module.apply(ctx) } catch { /* An older host keeps the legacy controls. */ }
  return result
}
