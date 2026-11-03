import { describe, expect, it, vi } from 'vitest'
import {
  captureNativeModelSelect,
  createModelDirectory,
  type ModelDirectorySnapshot,
} from '../../src/client/model/client-native-model.ts'

const initial: ModelDirectorySnapshot = {
  current: { provider: 'p', model: 'm' },
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  pending: null,
  error: null,
}

describe('native model directory adapter', () => {
  it('publishes immutable snapshots and unsubscribes listeners', () => {
    const directory = createModelDirectory(initial)
    const listener = vi.fn()
    const unsubscribe = directory.store.subscribe(listener)
    directory.update({ status: 'loading' })

    expect(directory.store.getSnapshot()).not.toBe(initial)
    expect(directory.store.getSnapshot()).toMatchObject({ status: 'loading', current: initial.current })
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    directory.update({ status: 'ready' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('captures the exact registered DSH component and its dictionaries without mounting services', () => {
    const component = () => null
    const dictionaries = { zh: { 'menu.model': '模型' }, en: { 'menu.model': 'Model' } }
    const plugin = vi.fn()
    const captured = captureNativeModelSelect({
      apply(ctx: unknown) {
        const context = ctx as any
        context.effect(() => context.locale.register('model', dictionaries))
        context.plugin(plugin)
        context.inject(['commandUi', 'modelDirectories'], () => { throw new Error('must not mount the command contribution') })
        context.inject(['slots', 'modelDirectories'], (scope: any) => {
          scope.slots.inject('conversation.input.model', () => scope.slots.register({}, component))
        })
      },
    })

    expect(captured.component).toBe(component)
    expect(captured.dictionaries).toEqual(dictionaries)
    expect(plugin).not.toHaveBeenCalled()
  })

  it('fails soft when the host has no compatible registration', () => {
    expect(captureNativeModelSelect({}).component).toBeUndefined()
    expect(captureNativeModelSelect({ apply: () => { throw new Error('old host') } }).component).toBeUndefined()
  })
})
