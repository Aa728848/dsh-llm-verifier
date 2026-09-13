import { type Criterion, type CriteriaPresetId } from './core.ts';
/** Everything the settings page can select: a bundled task-class preset, or a markdown file. */
export type CriteriaSelection = CriteriaPresetId | 'custom';
export interface ResolvedCriteria {
    criteria: Criterion[];
    /** Note prepended to every judge prompt, when the rubric carries one. */
    groundTruthNote?: string;
    /** The preset id, `custom`, or `fallback` when a custom file could not be used. */
    source: string;
    file?: string;
    /** Why the custom file was rejected; the `coding` rubric is used instead of failing the gate. */
    error?: string;
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
export declare class CriteriaResolver {
    private readonly load;
    private cache;
    constructor(load?: (path: string) => Promise<string>);
    resolve(selection: CriteriaSelection, file: string | undefined): Promise<ResolvedCriteria>;
    private remember;
}
//# sourceMappingURL=criteria.d.ts.map