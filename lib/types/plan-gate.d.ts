export interface PlanVerdict {
    verdict: string;
    score: number;
    feedback: string;
}
/**
 * Read the plan markdown out of one `exit_plan_mode` argument object.
 * @param args - Parsed tool arguments; anything but `{ plan: string }` yields ''.
 * @returns Trimmed plan markdown, or '' when the call carries no plan.
 */
export declare function planFromArguments(args: unknown): string;
export declare function buildPlanPreReviewPrompt(problem: string, planText: string, maxChars?: number): string;
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
export declare function parseVerdictLetter(text: string): PlanVerdict | undefined;
//# sourceMappingURL=plan-gate.d.ts.map