/** Pure scoring and Probabilistic Pivot Tournament primitives. */
export interface Criterion {
    id: string;
    name: string;
    description: string;
}
export interface TokenAlternative {
    token: string;
    logprob: number;
}
export interface CompletionLogprobs {
    text: string;
    tokens: string[];
    positions: TokenAlternative[][];
}
export interface CandidateScore {
    index: number;
    score: number;
}
export declare const GRANULARITY = 20;
export declare const LETTERS: string[];
export declare const SCALE_DESCRIPTION: string;
export declare const DEFAULT_CRITERIA: Criterion[];
/** Task classes a rubric can be chosen for; `custom` lives at the config layer, not here. */
export declare const CRITERIA_PRESET_IDS: readonly ["coding", "debug", "research", "ops", "writing"];
export type CriteriaPresetId = typeof CRITERIA_PRESET_IDS[number];
/**
 * Rubric per task class.
 *
 * Upstream ships one criteria file per benchmark (`criteria/swe_bench.md`, `terminal_bench.md`,
 * `medagentbench.md`) and its TEMPLATE states the rule this table follows: 2-4 narrow criteria
 * beat one broad one. Judging a research answer with "Output Match"/"Error Signal Detection"
 * measures the wrong thing, and the automatic gate has no per-task override.
 *
 * `coding` is byte-identical to {@link DEFAULT_CRITERIA}: the default preset must not change
 * any existing verdict, prompt or cache key.
 */
export declare const CRITERIA_PRESETS: Record<CriteriaPresetId, Criterion[]>;
/**
 * What a comparison's two sides actually are.
 *
 * The same numeric verdict means different things per stage, and the acceptance gate only ever
 * reads the final artifact review: a proposal that "wins" has proven nothing about the work.
 * Omitting the stage means the historical artifact semantics (see README).
 */
export type ReviewStage = 'proposal' | 'artifact';
/**
 * Default rubric for the `proposal` stage.
 *
 * The artifact rubric asks for observed stdout/stderr ("Output Match"), so an unexecuted plan
 * scored against it fails by construction — exactly the case the stage split exists to fix.
 * These three criteria ask the questions a proposal can actually answer; they are deliberately
 * as narrow as the artifact ones (2-4 narrow criteria beat one broad one).
 */
export declare const PROPOSAL_CRITERIA: Criterion[];
/**
 * Rubric for the P06 request-level comparison: choosing the NEXT action after a failure.
 *
 * Not the proposal rubric, and not a looser version of it. The proposal rubric asks whether a plan
 * addresses the stated goal; this comparison has evidence the proposal stage never has — the exact
 * verification runs that just failed — and the question that decides whether the extra generation
 * was worth buying is whether the alternative acts on THAT failure instead of restating the work.
 * The three criteria are deliberately about the failure, distinctness and verifiability, because a
 * re-worded repeat of a failed attempt scores well on "Goal And Constraints" and would win.
 *
 * The stage stays `proposal` (these candidates are unexecuted next steps) while the rubric source
 * is `process`, so the statistics keep the two rubrics distinguishable without a new stage.
 */
export declare const PROCESS_CRITERIA: Criterion[];
/**
 * Upper bound on the findings one judge call may report.
 *
 * The plan fixes it at three: feedback that lists everything is indistinguishable from feedback that
 * locates nothing, and every finding is charged against the 4000-character feedback budget.
 */
export declare const MAX_DIAGNOSTICS = 3;
/** Upper bound on one finding's text and on its suggested verification step. */
export declare const MAX_DIAGNOSTIC_CHARS = 400;
export declare const MAX_DIAGNOSTIC_ACTION_CHARS = 300;
/**
 * One located finding from a judge call.
 *
 * Deliberately about LOCATION, not about scores: the score tags answer "how good", these answer
 * "what exactly is missing and how would we settle it". `evidence` must be a token the judge was
 * actually shown, so a hallucinated reference is dropped instead of being echoed back to the agent.
 */
export interface Diagnostic {
    /** Criterion the finding belongs to (pairwise reviews); normalized to the name we offered. */
    criterion?: string;
    /** Checkpoint label the finding belongs to (`c1`..`cN`, progress reviews). */
    checkpoint?: string;
    /**
     * Evidence reference the judge was shown.
     *
     * `TASK`, `A`/`B` (a pairwise review) or `c1`.. (a progress review). A tournament rewrites
     * the per-pair `A`/`B` into the original candidate identity (`candidate 3`) so a finding can
     * never direct the agent at the wrong object once a pair has been oriented or swapped.
     */
    evidence: string;
    /** The concrete thing missing or failing. */
    finding: string;
    /** The verification step that would settle it, when the judge named one. */
    action?: string;
}
/**
 * The optional-findings contract appended to every judge prompt.
 *
 * Placed AFTER the criterion (so the criterion is still the last varying element and per-criterion
 * prefix caching keeps working) and BEFORE the score lines (so the verdict tags stay the final,
 * parseable part of the answer). Deliberately "may", never "must": an invented finding is worse than
 * no finding, and the parser drops anything it cannot verify.
 * @param target - the location attribute this prompt can offer (`criterion` or `checkpoint`).
 * @param evidence - the evidence tokens the judge may cite, exactly as rendered above.
 * @returns The contract text.
 */
export declare function buildFindingContract(target: 'criterion' | 'checkpoint', evidence: readonly string[]): string;
/**
 * Parse the findings of one judge answer against what that prompt actually offered.
 *
 * FAIL-SOFT BY DESIGN, unlike the score tags: a malformed or unverifiable finding is DROPPED, never
 * turned into a parse error, and never invented. The score contract stays fail-closed — a judge
 * answer without a usable A–T verdict is still an error — but diagnostics are a bonus, and failing a
 * whole verification because the judge wrote a sloppy extra line would punish the task, not the judge.
 * @param text - the raw judge answer.
 * @param visible - what the prompt offered: criterion names/ids, checkpoint labels, evidence tokens.
 * @returns Up to {@link MAX_DIAGNOSTICS} verified findings, in the order the judge wrote them.
 */
export declare function parseDiagnostics(text: string, visible: {
    criteria?: readonly string[];
    checkpoints?: readonly string[];
    evidence: readonly string[];
}): Diagnostic[];
/** Stable identity of one finding, for de-duplication across criteria/repeats/judges. */
export declare function diagnosticKey(diagnostic: Diagnostic): string;
/**
 * Map one pairwise finding's slot reference back to the caller's slots.
 *
 * `compare` swaps the two candidates for its odd repeats to cancel position preference, but it
 * already maps the SCORES back; a finding that kept the swapped slot would tell the agent that
 * candidate A's defect belongs to candidate B — the exact wrong object to fix.
 * @param diagnostic - a finding parsed from one (possibly swapped) round.
 * @returns The finding with `A`/`B` restored to the caller's order.
 */
export declare function swapDiagnosticEvidence(diagnostic: Diagnostic): Diagnostic;
/**
 * Render findings as short feedback lines.
 *
 * The locator (criterion/checkpoint + evidence) comes first and always survives truncation: a finding
 * the agent cannot place is not actionable, and the body is worthless without its location.
 * @param diagnostics - verified findings.
 * @param maxChars - budget for the whole block (0 renders nothing).
 * @returns One line per finding, or '' when there is nothing to say.
 */
export declare function renderDiagnostics(diagnostics: readonly Diagnostic[], maxChars: number): string;
/** Derive a criterion id from free text: lowercase, alphanumerics and underscores, max 40 chars. */
export declare function slugCriterionId(text: string): string;
/** Make an id unique against the ids already used, by appending _2, _3, ... */
export declare function dedupeCriterionId(id: string, seen: Set<string>): string;
export declare const DEFAULT_GROUND_TRUTH_NOTE = "**IMPORTANT:** Focus on observed tool and terminal output as ground truth. Do NOT trust the agent's self-assessment or claims of success.";
/**
 * The fixed baseline a session acceptance measures itself against.
 *
 * One definition, read by the automatic final gate and by `verifier_best_of_n`. The tool
 * advertises an "absolute" score with the gate's own threshold, so if these two ever drifted
 * apart the tool would be measuring against a different reference than the gate it predicts.
 */
export declare const EMPTY_WORK_BASELINE = "(No useful work or verification was performed.)";
/**
 * Deterministic per-prompt delimiter token.
 *
 * MUST NOT BE RANDOM: the score cache keys on the rendered prompt (`promptHash`),
 * so a random nonce would make every identical verification a cache miss and
 * break in-flight de-duplication. Deriving the token deterministically from the
 * prompt content ensures identical inputs yield an identical prompt (cache hits)
 * while injected untrusted text cannot predict the terminator because the token
 * depends on the entire content including any injection.
 */
export declare function evidenceNonce(...parts: readonly string[]): string;
/**
 * Render an untrusted content block wrapped with deterministic nonce-tagged delimiters.
 * Emits `<<<TAG:token>>>\n${content}\n<<<END_TAG:token>>>`.
 */
export declare function renderDelimitedBlock(tag: string, token: string, content: string): string;
/**
 * Injected-content guardrail shared by every judge prompt.
 *
 * Trajectories embed raw tool output, file contents and model prose, so they can
 * carry instructions aimed at the judge (including fake score tags). The
 * delimited blocks are declared data-only; the required verdict is restated as
 * the only thing that may follow the analysis.
 */
export declare const UNTRUSTED_EVIDENCE_NOTE: string;
export declare function normalizeScoreLetter(token: string): string | undefined;
export declare function extractScore(completion: CompletionLogprobs, tag: string): number;
/** Optional stage/domain/context framing for one pairwise prompt. */
export interface PairwisePromptOptions {
    /** Which review stage the two sides belong to; omitted means the historical artifact wording. */
    stage?: ReviewStage;
    /**
     * Task domain the rubric targets (normally the criteria preset id).
     *
     * Only the ROLE sentence reacts to it. The `coding` default is byte-identical to the historical
     * prompt — the scoring cache keys on the rendered prompt, so rewording the default would silently
     * invalidate every installation's cache — while a research/writing/ops rubric no longer claims to
     * be judging a coding agent.
     */
    domain?: string;
    /**
     * Optional reference context (constraints, recent failure evidence, tool definitions).
     *
     * Rendered as its own delimited, data-only block between the task and the two candidates, using
     * the SAME nonce as every other block of this prompt. Omitted or blank renders nothing, which
     * keeps the historical prompt byte-identical for every existing caller.
     */
    context?: string;
}
/**
 * One pairwise prompt focused on a single criterion.
 *
 * Everything that does not depend on the criterion (task, both trajectories, the rating
 * scale) comes first and ONLY the criterion varies at the tail. That is not cosmetic:
 * it maximizes the shared prompt prefix across the criteria of one comparison, so a
 * prefix-caching backend serves the trace-heavy body from cache. Upstream documents the
 * same constraint on its `build_prompt` ("Keep criterion-specific text strictly at the
 * end when editing"), and `VerifierEngine.compare` warms the prefix with one job before
 * fanning out the rest. Keep it that way.
 * @param problem - task statement shown to the judge.
 * @param traceA - candidate A's trajectory or proposal.
 * @param traceB - candidate B's trajectory or proposal.
 * @param criterion - the single criterion this call scores.
 * @param groundTruthNote - note prepended to every judge prompt.
 * @param options - review stage and task domain; omitted keeps the historical artifact prompt.
 * @returns The rendered prompt.
 */
export declare function buildPairwisePrompt(problem: string, traceA: string, traceB: string, criterion: Criterion, groundTruthNote?: string, options?: PairwisePromptOptions): string;
export declare function buildProgressPrompt(problem: string, steps: readonly string[], checkpoints: readonly number[]): string;
/**
 * One best-of-N drafting prompt.
 *
 * Deliberately NOT the judge contract: here the request IS the instruction to follow and the
 * answer is free-form work product, so there is no data-only delimiter and no A–T verdict tag.
 * The untrusted-content boundary is re-established downstream instead — every draft is embedded
 * as delimited, nonce-terminated evidence when the judges score it.
 *
 * Only the final line varies between the N drafts, so the shared prompt prefix (which carries
 * the whole request) is maximal. Same tail-only convention as `buildPairwisePrompt`'s
 * criterion, and for the same prefix-caching reason.
 * @param task - the request the drafts must answer.
 * @param index - 0-based draft index.
 * @param total - how many drafts are being generated.
 * @returns The rendered prompt.
 */
/**
 * Render the optional best-of-N reference context as a deterministic, data-only block.
 *
 * The block must be IDENTICAL wherever it appears: every draft and both judge comparisons have to
 * see the same facts, otherwise the ranking measures who got more context rather than who drafted
 * better. It is delimited with the same nonce machinery as every other evidence block and labelled
 * as untrusted data — it must never be promoted into an extra system instruction.
 * @param task - the request, part of the nonce so two different tasks cannot share a terminator.
 * @param context - caller-supplied constraints/excerpts; blank or missing renders nothing.
 * @returns The rendered block, or '' when there is no context.
 */
export declare function renderReferenceContext(task: string, context: string | undefined): string;
export declare function buildGenerationPrompt(task: string, index: number, total: number, context?: string): string;
/** Progress uses A=NO..T=YES, the reverse of pairwise success scoring. */
export declare function extractProgressScore(completion: CompletionLogprobs, tag: string): number;
export declare function bradleyTerry(rewardA: number, rewardB: number): number;
export declare function seededRandom(seed: number): () => number;
export declare function ringCycle(count: number, seed?: number): Array<[number, number]>;
export declare function pivotRoundPairs(count: number, pivots: readonly number[]): Array<[number, number]>;
export declare function accumulatePairs(pairs: readonly [number, number][], rewards: ReadonlyMap<string, readonly [number, number]>, wins: number[], counts: number[]): void;
export declare function topPivots(wins: readonly number[], counts: readonly number[], requested: number): number[];
export declare function rankScores(wins: readonly number[], counts: readonly number[]): CandidateScore[];
/**
 * Parse a criteria file (or an inline markdown string) into a ground-truth note and criteria.
 *
 * Upstream's criteria files are the reason this exists: a rubric you can edit, review and
 * version beats a hard-coded list, and its TEMPLATE pins the layout. Format:
 *
 *     # <title>                        (ignored)
 *     ## Ground Truth Note             (optional)
 *     <one paragraph the verifier always sees>
 *     ## Criteria
 *     ### <Criterion Name> {#id}       (the anchor is optional; the id is slugged from the name)
 *     <instruction for this criterion>
 *
 * HTML comments are stripped, so a file can carry author notes the judge never sees. The
 * parser fails closed: no criteria, a heading without a body, or a blank instruction throws
 * rather than silently scoring with fewer criteria than authored.
 * @param text - criteria markdown.
 * @returns The optional ground-truth note and the parsed criteria, in file order.
 */
export declare function parseCriteriaMarkdown(text: string): {
    groundTruthNote: string;
    criteria: Criterion[];
};
//# sourceMappingURL=core.d.ts.map