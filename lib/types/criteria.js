import { readFile } from 'node:fs/promises';
import { CRITERIA_PRESETS, DEFAULT_CRITERIA, parseCriteriaMarkdown } from "./core.js";
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
    load;
    cache;
    constructor(load = path => readFile(path, 'utf8')) {
        this.load = load;
    }
    async resolve(selection, file) {
        if (selection !== 'custom') {
            const preset = CRITERIA_PRESETS[selection];
            return { criteria: preset ?? DEFAULT_CRITERIA, source: preset ? selection : 'fallback', ...(preset ? {} : { error: 'unknown criteria preset: ' + String(selection) }) };
        }
        const path = (file ?? '').trim();
        let text;
        try {
            if (!path)
                throw new Error('no criteria file configured (set criteriaFile, or switch criteriaPreset away from custom)');
            text = await this.load(path);
        }
        catch (error) {
            return this.remember('custom\u0000' + path + '\u0000!' + String(error), {
                criteria: DEFAULT_CRITERIA,
                source: 'fallback',
                ...(path ? { file: path } : {}),
                error: error instanceof Error ? error.message : String(error),
            });
        }
        const key = 'custom\u0000' + path + '\u0000' + text;
        if (this.cache?.key === key)
            return this.cache.value;
        try {
            const parsed = parseCriteriaMarkdown(text);
            return this.remember(key, {
                criteria: parsed.criteria,
                ...(parsed.groundTruthNote ? { groundTruthNote: parsed.groundTruthNote } : {}),
                source: 'custom',
                file: path,
            });
        }
        catch (error) {
            return this.remember(key + '\u0000!' + String(error), {
                criteria: DEFAULT_CRITERIA,
                source: 'fallback',
                file: path,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    remember(key, value) {
        this.cache = { key, value };
        return value;
    }
}
//# sourceMappingURL=criteria.js.map