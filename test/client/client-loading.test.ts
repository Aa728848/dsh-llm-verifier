import { describe, expect, it, vi } from 'vitest'
import { startSettingsPageLoad } from '../../src/client/model/client-loading.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('settings page independent loading', () => {
  it('publishes settings while the model catalog is still pending', async () => {
    const catalog = deferred<string[]>()
    const settings = vi.fn()
    const catalogLoaded = vi.fn()
    startSettingsPageLoad(
      async () => ({ writable: true }),
      () => catalog.promise,
      { settings, catalog: catalogLoaded, settingsError: vi.fn(), catalogError: vi.fn() },
    )

    await vi.waitFor(() => expect(settings).toHaveBeenCalledWith({ writable: true }))
    expect(catalogLoaded).not.toHaveBeenCalled()

    catalog.resolve(['deepseek-official'])
    await vi.waitFor(() => expect(catalogLoaded).toHaveBeenCalledWith(['deepseek-official']))
  })

  it('contains a catalog failure without turning a settings success into a page error', async () => {
    const settings = vi.fn()
    const settingsError = vi.fn()
    const catalogError = vi.fn()
    startSettingsPageLoad(
      async () => 'settings',
      async () => { throw new Error('provider timeout') },
      { settings, catalog: vi.fn(), settingsError, catalogError },
    )

    await vi.waitFor(() => expect(catalogError).toHaveBeenCalledOnce())
    expect(settings).toHaveBeenCalledWith('settings')
    expect(settingsError).not.toHaveBeenCalled()
    expect(catalogError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('starts the catalog read even when settings fail', async () => {
    const readCatalog = vi.fn(async () => ['model'])
    const settingsError = vi.fn()
    const catalog = vi.fn()
    startSettingsPageLoad(
      async () => { throw new Error('settings unavailable') },
      readCatalog,
      { settings: vi.fn(), catalog, settingsError, catalogError: vi.fn() },
    )

    await vi.waitFor(() => expect(settingsError).toHaveBeenCalledOnce())
    expect(readCatalog).toHaveBeenCalledOnce()
    expect(catalog).toHaveBeenCalledWith(['model'])
  })
})
