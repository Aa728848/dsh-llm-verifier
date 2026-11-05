/**
 * The shared prose-verdict shape: one A-T letter, its [0,1] score, and the judge's own words.
 *
 * Lives apart from any single gate because more than one gate parses the same output format;
 * the parser and the prompts that produce it must never drift apart.
 */
export interface Verdict {
  verdict: string
  score: number
  feedback: string
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
export function parseVerdictLetter(text: string): Verdict | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[*_`~#>]/g, ' ').replace(/^\s*(?:[-+]|\d+[.)])\s+/, ' ').trim()
    const match = /^verdict\s*:\s*([A-Ta-t])\s*[.)]?$/i.exec(line)
    if (match === null) continue
    const verdict = (match[1] as string).toUpperCase()
    const score = Math.max(0, Math.min(1, 1 - (verdict.charCodeAt(0) - 65) / 19))
    return { verdict, score, feedback: text.trim() }
  }
  return undefined
}
