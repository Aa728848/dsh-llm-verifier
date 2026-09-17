import type { Context } from '@deepseek-ai/cordis';
/**
 * Host-recorded workspace changes, as acceptance evidence.
 *
 * DSH 0.1.6 records what one turn actually changed on disk and serves it through the
 * `workspaceChanges` service. Before this module the acceptance judge could only read the
 * `tool/call` arguments the agent wrote about itself: a patch that was never applied, or a file
 * edited again afterwards, was indistinguishable from a real edit. The summary and the per-file
 * comparison are the host's own observation of the filesystem, so they are offered next to the
 * trajectory instead of being taken on the agent's word.
 *
 * The service is described STRUCTURALLY and on purpose. Importing the host type would stop this
 * plugin from compiling against DSH 0.1.1/0.1.5, which is exactly what {@link probeWorkspaceChanges}
 * exists to avoid: a host that does not provide the service must degrade to "no extra evidence",
 * never to a failed acceptance.
 */
export interface WorkspaceChangeSource {
    summary(sessionId: string, seq: number): {
        files?: readonly unknown[];
    } | undefined;
    diff(sessionId: string, seq: number, index: number, signal: AbortSignal): Promise<unknown>;
}
/**
 * Bounds for one rendered evidence block.
 *
 * The block is a SINGLE prompt item, so `maxItemChars` is the hard ceiling for the whole block —
 * including the header and every truncation notice — and `maxInputChars` is the combined budget
 * the per-file split is derived from. Failures are reported through `warn` instead of propagating:
 * unavailable evidence must never fail the acceptance that is already under way.
 */
export interface WorkspaceEvidenceBudget {
    maxItemChars: number;
    maxInputChars: number;
    warn?: (message: string) => void;
}
/**
 * How many changed files one block renders.
 *
 * The number of changed files in a turn is unbounded (a formatter run touches hundreds), while the
 * evidence budget is fixed, so only the leading files of the host's own `display` order are
 * rendered and the header states how many were left out. Deliberately not ranked by line count:
 * importance is not something a line count knows, and a stable order keeps the rendered prompt —
 * and therefore the score cache key — reproducible.
 */
export declare const MAX_WORKSPACE_FILES = 8;
/**
 * The host's workspace-change service, or undefined when this host does not provide it.
 *
 * Probing at runtime (never assuming by version or provider) is what lets one build of this plugin
 * run on hosts both with and without the service. Both methods are checked because a partial
 * service would fail later, mid-acceptance, where degrading is no longer an option.
 * @param ctx - plugin context.
 * @returns The service, or undefined when it is absent or unusable.
 */
export declare function probeWorkspaceChanges(ctx: Context): WorkspaceChangeSource | undefined;
/**
 * Render the host's own record of what this turn changed, as judge evidence.
 *
 * Bounded twice: the number of files is capped ({@link MAX_WORKSPACE_FILES}) and the characters are
 * split across the rendered files with {@link itemBudget}, so one enormous generated file cannot
 * crowd out every other change. `maxItemChars` bounds the WHOLE block, because that is how it
 * enters the prompt — one item of the reference-context seam.
 *
 * Every failure degrades: no event, no summary, a missing comparison or a throwing `diff` all
 * produce less evidence (or an empty string) instead of an error, because the acceptance being
 * prepared has already spent judge budget and must still produce a verdict.
 * @param events - session events, bounded by the caller to the range under review.
 * @param sessionId - the session whose changes these are.
 * @param source - the probed host service.
 * @param budget - per-item/combined character bounds plus the diagnostic sink.
 * @param signal - cancels the host's snapshot reads.
 * @returns The rendered block, '' when there is nothing to show, never longer than `maxItemChars`.
 */
export declare function renderWorkspaceChanges(events: readonly unknown[], sessionId: string, source: WorkspaceChangeSource, budget: WorkspaceEvidenceBudget, signal: AbortSignal): Promise<string>;
//# sourceMappingURL=workspace.d.ts.map