import { itemBudget } from "./router.js";
import { sanitizeVerifierText } from "./session.js";
/**
 * How many changed files one block renders.
 *
 * The number of changed files in a turn is unbounded (a formatter run touches hundreds), while the
 * evidence budget is fixed, so only the leading files of the host's own `display` order are
 * rendered and the header states how many were left out. Deliberately not ranked by line count:
 * importance is not something a line count knows, and a stable order keeps the rendered prompt —
 * and therefore the score cache key — reproducible.
 */
export const MAX_WORKSPACE_FILES = 8;
/**
 * The host's workspace-change service, or undefined when this host does not provide it.
 *
 * Probing at runtime (never assuming by version or provider) is what lets one build of this plugin
 * run on hosts both with and without the service. Both methods are checked because a partial
 * service would fail later, mid-acceptance, where degrading is no longer an option.
 * @param ctx - plugin context.
 * @returns The service, or undefined when it is absent or unusable.
 */
export function probeWorkspaceChanges(ctx) {
    let service;
    try {
        service = ctx.get('workspaceChanges');
    }
    catch {
        return undefined;
    }
    if (typeof service !== 'object' || service === null)
        return undefined;
    const candidate = service;
    if (typeof candidate.summary !== 'function' || typeof candidate.diff !== 'function')
        return undefined;
    return service;
}
/** Smallest integer that is safe to render, or 0 when the host reported nothing usable. */
function count(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** Text that is safe to render and non-empty, or undefined. */
function label(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
/**
 * The `workspace/changes` event this evidence describes.
 *
 * The LAST one in the supplied events wins: a turn that changed files appends a newer event, and
 * the newest summary is the state the acceptance judge is looking at. One turn, not the whole
 * session, because that is the granularity the host records at.
 * @param events - session events, already bounded to the reviewed range by the caller.
 * @returns The newest matching event, or undefined when the session has none.
 */
function latestChangeEvent(events) {
    let latest;
    for (const raw of events) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const event = raw;
        if (event.type !== 'workspace/changes')
            continue;
        if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq))
            continue;
        if (latest !== undefined && event.seq <= latest.seq)
            continue;
        const turn = event.data === null || typeof event.data !== 'object' ? undefined : event.data.turn;
        latest = { seq: event.seq, ...(typeof turn === 'number' && Number.isFinite(turn) ? { turn } : {}) };
    }
    return latest;
}
/**
 * Normalize the host's hunks into the lines that will be rendered.
 *
 * `@@ -oldStart,oldLines +newStart,newLines @@` headers keep the reader oriented in the file and
 * every body line is rendered with its own `+`, `-` or space prefix exactly as the host served it.
 * @param hunks - the diff's hunks, of an unknown shape at this boundary.
 * @returns One string per rendered line.
 */
function normalizeHunks(hunks) {
    const lines = [];
    for (const raw of hunks) {
        if (typeof raw !== 'object' || raw === null)
            continue;
        const hunk = raw;
        lines.push('@@ -' + count(hunk.oldStart) + ',' + count(hunk.oldLines) + ' +' + count(hunk.newStart) + ',' + count(hunk.newLines) + ' @@');
        if (!Array.isArray(hunk.lines))
            continue;
        for (const line of hunk.lines)
            if (typeof line === 'string')
                lines.push(line);
    }
    return lines;
}
/**
 * Fit as many diff lines as the budget allows, keeping the omission note inside the same budget.
 *
 * The note is part of the rendered text, so a note appended past the cap would be the very thing
 * `sanitizeVerifierText` then cuts in half; trailing lines are given up instead, one whole line at
 * a time, until the note fits.
 * @param lines - normalized diff lines, headers included.
 * @param budget - hard character cap for the returned text.
 * @returns The rendered lines with their omission note, never longer than `budget`.
 */
function fitLines(lines, budget) {
    const kept = [];
    let used = 0;
    for (const line of lines) {
        const cost = line.length + (kept.length === 0 ? 0 : 1);
        if (used + cost > budget)
            break;
        used += cost;
        kept.push(line);
    }
    if (kept.length === lines.length)
        return kept.join('\n');
    let omitted = lines.length - kept.length;
    while (kept.length > 1) {
        const note = '\n[+' + omitted + ' more line(s) not shown]';
        if (used + note.length <= budget)
            return kept.join('\n') + note;
        used -= kept.pop().length + 1;
        omitted++;
    }
    return kept.join('\n');
}
/** `(+added/-deleted)` from the host's counts. */
function lineCounts(file) {
    return '(+' + count(file.added) + '/-' + count(file.deleted) + ')';
}
/** The one-line stand-in for a file the host refuses to compare. */
function noComparison(header, reason, perFile) {
    return sanitizeVerifierText(header + ' — ' + reason, perFile);
}
/**
 * Render one changed file: its identity and counts, then the comparison the host serves.
 *
 * A file the host itself reported as binary or oversized is never passed to `diff`: the answer is
 * known in advance, and asking would spend a snapshot read to learn nothing.
 * @param sessionId - session the summary belongs to.
 * @param seq - the `workspace/changes` event's sequence number.
 * @param index - the file's index in the summary's `files`.
 * @param file - the summary's entry for this file.
 * @param source - the host service.
 * @param perFile - character budget for this file's section.
 * @param signal - cancels the host's reads.
 * @param warn - diagnostic sink for failures that are swallowed.
 * @returns The sanitized section, never longer than `perFile`.
 */
async function renderFile(sessionId, seq, index, file, source, perFile, signal, warn) {
    const display = label(file.display) ?? label(file.path) ?? '(unnamed file)';
    const header = '- ' + display + ' ' + lineCounts(file);
    if (file.binary === true)
        return noComparison(header, 'binary file; contents not compared', perFile);
    if (file.oversized === true)
        return noComparison(header, 'file too large to capture; contents not compared', perFile);
    let diff;
    try {
        diff = await source.diff(sessionId, seq, index, signal);
    }
    catch (error) {
        warn('llm-verifier workspace diff unavailable for ' + display + ': ' + (error instanceof Error ? error.message : String(error)));
        return noComparison(header, 'comparison unavailable', perFile);
    }
    if (typeof diff !== 'object' || diff === null)
        return noComparison(header, 'comparison unavailable', perFile);
    const view = diff;
    if (view.kind === 'binary')
        return noComparison(header, 'binary file; contents not compared', perFile);
    if (view.kind === 'oversized')
        return noComparison(header, 'file too large to capture; contents not compared', perFile);
    const coarse = view.coarse === true ? ' (line comparison timed out; shown as replaced)' : '';
    const bodyBudget = Math.max(1, perFile - (header + coarse).length - 1);
    const body = fitLines(normalizeHunks(Array.isArray(view.hunks) ? view.hunks : []), bodyBudget);
    return sanitizeVerifierText(header + coarse + '\n' + body, perFile);
}
/** The provenance line: what the block is, and that the host — not the agent — observed it. */
function headerLine(event, summary, listed, shown) {
    const total = Math.max(count(summary.total), listed);
    const changed = total + ' file(s) changed';
    const lines = count(summary.added) > 0 || count(summary.deleted) > 0 ? ' (+' + count(summary.added) + '/-' + count(summary.deleted) + ' lines)' : '';
    const capped = total > shown ? '; showing the first ' + shown : '';
    return 'Host-recorded workspace changes' + (event.turn === undefined ? '' : ' for turn ' + event.turn) + ': ' + changed + lines + capped + '.\n'
        + 'Observed by the DSH host from the workspace itself, not reported by the agent.';
}
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
export async function renderWorkspaceChanges(events, sessionId, source, budget, signal) {
    const warn = budget.warn ?? (() => { });
    const maxItemChars = Math.floor(budget.maxItemChars);
    const maxInputChars = Math.floor(budget.maxInputChars);
    if (!Number.isSafeInteger(maxItemChars) || maxItemChars < 1)
        return '';
    try {
        const event = latestChangeEvent(events);
        if (event === undefined)
            return '';
        const summary = source.summary(sessionId, event.seq);
        if (typeof summary !== 'object' || summary === null)
            return '';
        if (!Array.isArray(summary.files))
            return '';
        const listed = summary.files
            .map((file, index) => ({ file, index }))
            .filter((entry) => typeof entry.file === 'object' && entry.file !== null);
        if (listed.length === 0)
            return '';
        const shown = listed.slice(0, MAX_WORKSPACE_FILES);
        const header = headerLine(event, summary, listed.length, shown.length);
        const ceiling = Number.isSafeInteger(maxInputChars) && maxInputChars > 0 ? maxInputChars : maxItemChars;
        const combined = Math.max(1, Math.min(ceiling, maxItemChars));
        // The header and one line per section are rendered text too: they are charged to the same
        // combined budget before the per-file split, exactly like the prefixes the router measures
        // before calling itemBudget. Without this the separators alone could push the joined block
        // past the single-item cap.
        const contentBudget = Math.max(1, combined - header.length - shown.length);
        const perFile = itemBudget(shown.length, maxItemChars, contentBudget);
        const sections = [];
        for (const entry of shown)
            sections.push(await renderFile(sessionId, event.seq, entry.index, entry.file, source, perFile, signal, warn));
        return sanitizeVerifierText([header, ...sections].join('\n'), maxItemChars);
    }
    catch (error) {
        warn('llm-verifier workspace evidence unavailable: ' + (error instanceof Error ? error.message : String(error)));
        return '';
    }
}
//# sourceMappingURL=workspace.js.map