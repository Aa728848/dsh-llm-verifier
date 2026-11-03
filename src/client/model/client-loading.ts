export interface SettingsPageLoadHandlers<Settings, Catalog> {
  settings(value: Settings): void
  catalog(value: Catalog): void
  settingsError(error: unknown): void
  catalogError(error: unknown): void
}

/** Start both reads immediately; neither one's settlement is a prerequisite for rendering the other. */
export function startSettingsPageLoad<Settings, Catalog>(
  readSettings: () => Promise<Settings>,
  readCatalog: () => Promise<Catalog>,
  handlers: SettingsPageLoadHandlers<Settings, Catalog>,
): void {
  void Promise.resolve().then(readSettings).then(handlers.settings, handlers.settingsError)
  void Promise.resolve().then(readCatalog).then(handlers.catalog, handlers.catalogError)
}
