import { readFile } from 'node:fs/promises'
import { CRITERIA_PRESETS, DEFAULT_CRITERIA, parseCriteriaMarkdown, type Criterion, type CriteriaPresetId } from './core.ts'

/** Everything the settings page can select: a bundled task-class preset, or a markdown file. */
export type CriteriaSelection = CriteriaPresetId | 'custom'

export interface ResolvedCriteria {
  criteria: Criterion[]
  /** Note prepended to every judge prompt, when the rubric carries one. */
  groundTruthNote?: string
  /** The preset id, `custom`, or `fallback` when a custom file could not be used. */
  source: string
  file?: string
  /** Why the custom file was rejected; the `coding` rubric is used instead of failing the gate. */
  error?: string
}

/**
 * Resolve the configured rubric to the criteria the engine scores with.
 *
 * A custom markdown file is read on every resolve (a rubric file is a few kilobytes and it is
 * resolved once per turn boundary), so editing it takes effect immediately. The parse is cached
 * against the file text, so repeated resolves of an unchanged file cost one read.
 *
 * A broken custom file does NOT fail verification: a rubric typo must not disable the acceptance
 * gate, so the coding preset is used and the reason travels in {@link ResolvedCriteria.error}
 * for the settings page and the log. This mirrors the plugin's rule that scoring-channel
 * capability problems degrade instead of aborting a verification.
 */
export class CriteriaResolver {
  private cache: { key: string; value: ResolvedCriteria } | undefined
  constructor(private readonly load: (path: string) => Promise<string> = path => readFile(path, 'utf8')) {}

  async resolve(selection: CriteriaSelection, file: string | undefined): Promise<ResolvedCriteria> {
    if (selection !== 'custom') {
      const preset = CRITERIA_PRESETS[selection]
      return { criteria: preset ?? DEFAULT_CRITERIA, source: preset ? selection : 'fallback', ...(preset ? {} : { error: 'unknown criteria preset: ' + String(selection) }) }
    }
    const path = (file ?? '').trim()
    let text: string
    try {
      if (!path) throw new Error('no criteria file configured (set criteriaFile, or switch criteriaPreset away from custom)')
      text = await this.load(path)
    } catch (error) {
      return this.remember('custom\u0000' + path + '\u0000!' + String(error), {
        criteria: DEFAULT_CRITERIA,
        source: 'fallback',
        ...(path ? { file: path } : {}),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const key = 'custom\u0000' + path + '\u0000' + text
    if (this.cache?.key === key) return this.cache.value
    try {
      const parsed = parseCriteriaMarkdown(text)
      return this.remember(key, {
        criteria: parsed.criteria,
        ...(parsed.groundTruthNote ? { groundTruthNote: parsed.groundTruthNote } : {}),
        source: 'custom',
        file: path,
      })
    } catch (error) {
      return this.remember(key + '\u0000!' + String(error), {
        criteria: DEFAULT_CRITERIA,
        source: 'fallback',
        file: path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private remember(key: string, value: ResolvedCriteria): ResolvedCriteria {
    this.cache = { key, value }
    return value
  }
}
