import { sanitizeVerifierText } from "./session.js";
/**
 * Read the plan markdown out of one `exit_plan_mode` argument object.
 * @param args - Parsed tool arguments; anything but `{ plan: string }` yields ''.
 * @returns Trimmed plan markdown, or '' when the call carries no plan.
 */
export function planFromArguments(args) {
    if (typeof args !== 'object' || args === null)
        return '';
    const plan = args.plan;
    return typeof plan === 'string' ? plan.trim() : '';
}
export function buildPlanPreReviewPrompt(problem, planText, maxChars = 20000) {
    return [
        'You are an expert independent technical plan verifier. A candidate implementation plan is about to be submitted to the human for approval.',
        'Evaluate whether the plan is sound, executable, and comprehensive.',
        'Scoring criteria:',
        'A: Flawless, thorough, with clear steps, rigorous verification, edge cases handled.',
        'B-J: Mostly sound, minor gaps or nuances missing.',
        'K-S: Noticeable architectural gaps, missing regression checks, or ambiguities.',
        'T: Fundamentally flawed, dangerous, or missing core requirements.',
        '',
        'Task requirement:',
        sanitizeVerifierText(problem, 4000),
        '',
        'Proposed Plan:',
        sanitizeVerifierText(planText, maxChars),
        '',
        'Output format:',
        'The first line must be exactly "Verdict: <single uppercase letter A-T>" — one letter, nothing else on the line.',
        'Line 2: Summary: <One sentence assessment>',
        'Line 3+: Key strengths, blind spots, and verification guidance.',
    ].join('\n\n');
}
/**
 * Parse the `Verdict: <A-T>` line the judge prompts require.
 *
 * Markdown decoration around the required line is stripped first, so "**Verdict:
 * A**", "- Verdict: B." or a numbered list marker still produce a grade — a
 * formatting habit must never silently switch the gate off. Prose that is not a
 * grade is still rejected: "Verdict: Failed" and "Verdict: Approved" carry no
 * verdict letter, and an answer without a verdict line has no score at all —
 * callers must skip such a review, never treat it as a pass. A is 1.0 and T is
 * 0.0, matching the top-logprob A-T scale used by the judge prompts.
 * @param text - Raw judge model output.
 * @returns The parsed verdict, or undefined when no verdict line is present.
 */
export function parseVerdictLetter(text) {
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/[*_`~#>]/g, ' ').replace(/^\s*(?:[-+]|\d+[.)])\s+/, ' ').trim();
        const match = /^verdict\s*:\s*([A-Ta-t])\s*[.)]?$/i.exec(line);
        if (match === null)
            continue;
        const verdict = match[1].toUpperCase();
        const score = Math.max(0, Math.min(1, 1 - (verdict.charCodeAt(0) - 65) / 19));
        return { verdict, score, feedback: text.trim() };
    }
    return undefined;
}
//# sourceMappingURL=plan-gate.js.map