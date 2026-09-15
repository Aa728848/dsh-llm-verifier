import { addUsage, attachUsage, callVerifier, emptyUsage, partialUsage, predictScoringChannel, requestAttempts } from "./caller.js";
import { ScoreCache, SingleFlight, stableHash } from "./cache.js";
import { costUsd } from "./pricing.js";
import { DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, PROPOSAL_CRITERIA, accumulatePairs, buildPairwisePrompt, buildProgressPrompt, dedupeCriterionId, diagnosticKey, extractProgressScore, extractScore, parseDiagnostics, pivotRoundPairs, rankScores, ringCycle, slugCriterionId, swapDiagnosticEvidence, topPivots, } from "./core.js";
/** Evidence tokens one pairwise prompt shows the judge, exactly as the prompt lists them. */
const PAIRWISE_EVIDENCE = ['TASK', 'A', 'B'];
/**
 * Cap on the findings ONE invocation reports, after de-duplication across criteria, repeats and judges.
 *
 * The per-call cap is {@link MAX_DIAGNOSTICS}; the default final acceptance is 3 criteria x 2 repeats,
 * so the aggregate is deliberately a small multiple: the feedback budget (4000 characters) is the real
 * limit, and a list that covers every criterion is not a location, it is a second rubric.
 */
const MAX_AGGREGATED_DIAGNOSTICS = 6;
/** Append findings in order, de-duplicated, never exceeding the aggregate cap. */
function mergeDiagnostics(target, seen, incoming) {
    for (const diagnostic of incoming ?? []) {
        if (target.length >= MAX_AGGREGATED_DIAGNOSTICS)
            return;
        const key = diagnosticKey(diagnostic);
        if (seen.has(key))
            continue;
        seen.add(key);
        target.push(diagnostic);
    }
}
function average(values) { return values.reduce((sum, value) => sum + value, 0) / (values.length || 1); }
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function blankStats() { return { ...emptyUsage(), cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }; }
/**
 * Where an invocation records the usage it accumulated before it finally failed.
 *
 * The engine aggregates per-judge usage while jobs are still running, so a later job that
 * throws used to discard everything the earlier jobs had already spent: a run with two
 * successful calls then one failure was persisted as one attempt and zero tokens. Attaching
 * the live stats object to the error keeps every known request and token.
 */
/**
 * Usage accumulated before an invocation failed; undefined when the error carries none.
 *
 * The carrier may be a bare UsageStats (a caller-level response) or a full RunStats (an engine
 * accumulator). It is normalized here so no caller can merge a partial shape and turn the
 * RunStats-only counters into NaN (which the host serializes as null and rejects).
 */
export function partialStats(error) {
    const value = partialUsage(error);
    if (value === undefined)
        return undefined;
    return {
        ...blankStats(),
        ...value,
        cacheHits: value.cacheHits ?? 0,
        cacheMisses: value.cacheMisses ?? 0,
        estimatedCostUsd: value.estimatedCostUsd ?? 0,
        topLogprobScores: value.topLogprobScores ?? 0,
        explicitTagScores: value.explicitTagScores ?? 0,
    };
}
/** A failed judge result knows its usage through one of two carriers; fold whichever it has. */
function accountFailure(stats, error) {
    const partial = partialStats(error);
    if (partial !== undefined) {
        mergeRunStats(stats, partial);
        return;
    }
    // The request never returned usage. The attempt count is the one known fact.
    const attempts = requestAttempts(error);
    stats.attempts += attempts;
    stats.retries += Math.max(0, attempts - 1);
}
/**
 * Fold one nested run's counters into an accumulator (usage, cache, channel, incompleteness).
 *
 * Shared with index.ts so a multi-phase tool (best-of-N) accumulates generation, tournament and
 * baseline usage the same way. Never folds a value into itself, and zero-fills the RunStats-only
 * counters so a partial source cannot poison the totals with NaN.
 */
export function mergeRunStats(target, source) {
    if (source === undefined || source === target)
        return;
    addUsage(target, source);
    target.cacheHits += source.cacheHits ?? 0;
    target.cacheMisses += source.cacheMisses ?? 0;
    target.topLogprobScores += source.topLogprobScores ?? 0;
    target.explicitTagScores += source.explicitTagScores ?? 0;
    if (source.usageIncomplete)
        target.usageIncomplete = true;
    if (source.channelFallbacks)
        target.channelFallbacks = (target.channelFallbacks ?? 0) + source.channelFallbacks;
}
/** Keep a billed-but-unusable response's usage on its error. */
function attachBilled(error, usage) {
    const billed = blankStats();
    addUsage(billed, usage);
    if (usage.usageIncomplete)
        billed.usageIncomplete = true;
    attachUsage(error, billed);
}
/** Candidate indices best-first by score, ties broken by index. */
function rankByScore(scores) { return Array.from({ length: scores.length }, (_, index) => index).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b); }
/**
 * Rewrite one pair's `A`/`B` finding into the tournament's candidate identity.
 *
 * The label is 1-based on purpose: the automatic selection feedback locates candidates as `[N]`,
 * and the tool result is read by the same agent that reads that feedback.
 */
function locatePairDiagnostic(diagnostic, a, b) {
    if (diagnostic.evidence === 'A')
        return { ...diagnostic, evidence: 'candidate ' + (a + 1) };
    if (diagnostic.evidence === 'B')
        return { ...diagnostic, evidence: 'candidate ' + (b + 1) };
    return diagnostic;
}
/**
 * Renumber one deduplicated selection's finding onto the caller's original candidate list.
 *
 * {@link locatePairDiagnostic} numbers the DISTINCT candidates the tournament judged; the caller
 * passed a list that may repeat entries, so `candidate 2` of the compressed list can be
 * `candidate 3` of the caller's. Anything that is not a candidate reference is left alone.
 * @param diagnostic - one aggregated finding.
 * @param originals - distinct index -> the caller's first index of that candidate.
 * @returns The finding, renumbered when it names a candidate.
 */
function remapCandidateDiagnostic(diagnostic, originals) {
    const match = /^candidate (\d+)$/u.exec(diagnostic.evidence);
    if (match === null)
        return diagnostic;
    const original = originals[Number(match[1]) - 1];
    return original === undefined ? diagnostic : { ...diagnostic, evidence: 'candidate ' + (original + 1) };
}
function unorderedPair(a, b) { return a < b ? a + ',' + b : b + ',' + a; }
/**
 * Deterministic A/B slot for one pivot-round pair, balanced by construction.
 *
 * The round used to emit `[candidate, pivot]` for every edge, so the ring leaders sat
 * in trajectory B in all of their extra matches: with a judge that merely prefers slot A
 * the pivots averaged 0.36 against 0.60 for everyone else and sank in the final ranking.
 * Alternating on the sum of the two RANKS — not the raw indices: the pivot set is
 * selected by score, so its indices can share a parity and a parity rule would then
 * handicap half the field — gives every pivot and every candidate both slots within one
 * edge of each other, without a second model call.
 *
 * Deliberately NOT in core.ts: `pivotRoundPairs` is compared against the upstream Python
 * reference in `parity.test.ts`, so the orientation stays an orchestration-side decision.
 * @param pair - one unordered pair from the pivot round.
 * @param pivotRanks - pivot index → its rank among the pivots.
 * @param nonPivotRanks - candidate index → its rank among the non-pivots.
 * @returns The pair in the order it should be presented.
 */
export function orientRoundPairs(pairs) {
    const balance = new Map();
    return pairs.map(([a, b]) => {
        const first = balance.get(a) ?? 0;
        const second = balance.get(b) ?? 0;
        // Slot A goes to whichever endpoint has held it less often; an equal count keeps the
        // incoming order, so the result is deterministic for a given pair sequence.
        const [x, y] = second < first ? [b, a] : [a, b];
        balance.set(x, (balance.get(x) ?? 0) + 1);
        balance.set(y, (balance.get(y) ?? 0) - 1);
        return [x, y];
    });
}
/**
 * Arbitrary but fixed A/B slot for the single pair of a two-candidate select.
 *
 * There is only one match, so nothing can cancel a preference; the mix at least stops
 * candidate 0 from always sitting in slot A. Real comparisons go through `compare`,
 * where `routedRepeats` runs an even number of rounds instead.
 * @param a - first candidate index of the pair.
 * @param b - second candidate index of the pair.
 * @returns The pair in the order it should be presented.
 */
function orientPair(a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let mixed = Math.imul(lo + 1, 0x9e3779b1) ^ Math.imul(hi + 1, 0x85ebca77);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x2545f491);
    return ((mixed ^ (mixed >>> 13)) & 1) === 0 ? [a, b] : [b, a];
}
function judgeLabel(client) {
    return client.label?.trim() || client.provider + '/' + client.model;
}
export class VerifierEngine {
    client;
    clients;
    maxConcurrency;
    cache;
    inputPrice;
    outputPrice;
    /** Cache-read rate; an omitted one falls back to the input rate. */
    cachedInputPrice;
    flights;
    constructor(client, maxConcurrency = 8, cache, prices = { input: 0, output: 0 }, flights = new SingleFlight()) {
        const list = Array.isArray(client) ? client : [client];
        if (!list.length)
            throw new Error('llm-verifier: at least one verifier client is required');
        this.clients = list;
        this.client = list[0];
        this.maxConcurrency = maxConcurrency;
        this.cache = cache;
        this.inputPrice = prices.input;
        this.outputPrice = prices.output;
        // Backward compatible default: a caller that only knows two rates keeps the old estimate
        // (cache reads at the input rate) instead of suddenly pricing them at zero.
        this.cachedInputPrice = prices.cachedInput ?? prices.input;
        this.flights = flights;
    }
    finishStats(stats) {
        stats.estimatedCostUsd = costUsd(stats, { input: this.inputPrice, output: this.outputPrice, cachedInput: this.cachedInputPrice });
        return stats;
    }
    /**
     * Prompt framing for one comparison.
     *
     * Rebuilt from the stage/domain the caller declared. Both fields are part of the RENDERED
     * prompt, so the score cache keys on them automatically; the cache's `version` does not need
     * to move when only this framing changes.
     * @param options - the comparison's options.
     * @returns Stage and domain to forward to {@link buildPairwisePrompt}.
     */
    framing(options) {
        return {
            ...(options.reviewStage === undefined ? {} : { stage: options.reviewStage }),
            ...(options.domain === undefined ? {} : { domain: options.domain }),
            ...(options.context === undefined ? {} : { context: options.context }),
        };
    }
    async scoreOne(client, options, candidateA, candidateB, criterion, repeat, signal) {
        const ground = options.groundTruthNote ?? DEFAULT_GROUND_TRUTH_NOTE;
        const prompt = buildPairwisePrompt(options.problem, candidateA, candidateB, criterion, ground, this.framing(options));
        const imageKey = options.images?.map(image => stableHash([image.mediaType, Buffer.from(image.data).toString('base64')]));
        // Cache identity pins the scoring channel, but the channel is only predictable
        // before the call when the capability cache already knows the answer. Lookups use
        // the predicted channel while entries are always stored under the ACTUAL
        // completion mode, so a first-call downgrade lands under explicit-tag keys and is
        // found by later explicit-tag calls instead of being misread as a top-logprobs
        // expectation. The channel stays OUT of the in-flight dedup key below.
        const identity = { version: 6, provider: client.provider, model: client.model, effort: client.reasoningEffort, maxTokens: client.maxTokens, temperature: client.temperature, repeat, promptHash: stableHash(prompt), imageKey };
        const keyForMode = (scoringMode) => stableHash({ ...identity, scoringMode });
        // Captured out of band: a fallback describes the REQUEST, not the score, so it must not
        // enter the cached value (a cache hit later must not claim a downgrade that never happened).
        let fellBack = false;
        const create = async () => {
            const completion = await callVerifier(client, prompt, signal, options.images);
            try {
                const scoreA = extractScore(completion, '<score_A>');
                const scoreB = extractScore(completion, '<score_B>');
                fellBack = completion.channelFallback === true;
                // Traced here, not in scoreOne(): a cache hit or a merged in-flight call makes no
                // model call, and a snapshot that showed one anyway would be a fabrication.
                options.trace?.({ label: (options.traceLabelPrefix ?? '') + criterion.name + ' repeat ' + (repeat + 1), channel: completion.scoringMode, prompt, output: completion.text, score: scoreA });
                // Parsed against exactly what this prompt offered; anything unverifiable is dropped.
                const diagnostics = parseDiagnostics(completion.text, { criteria: [criterion.name, criterion.id], evidence: PAIRWISE_EVIDENCE });
                return { scoreA, scoreB, usage: completion.usage, scoringMode: completion.scoringMode, diagnostics, createdAt: Date.now() };
            }
            catch (error) {
                // The response came back and was billed, but carried no usable score. Keep its usage
                // on the error so the failed row reports known requests and tokens, not zero.
                attachBilled(error, completion.usage);
                throw error;
            }
        };
        const cache = this.cache;
        if (cache === undefined) {
            const value = await create();
            return { scores: [value.scoreA, value.scoreB], usage: value.usage, scoringMode: value.scoringMode, hit: false, channelFallback: fellBack, diagnostics: value.diagnostics };
        }
        // Registration happens in the synchronous segment before any await, so a request
        // that arrives while the first one is still resolving its channel prediction
        // still merges instead of duplicating the model call. The flight table is shared
        // per topic, so concurrent tool calls through separate engine instances merge too.
        const dedupeKey = stableHash(identity);
        const outcome = await this.flights.run(dedupeKey, async () => cache.getOrCreate(keyForMode(await predictScoringChannel(client)), create, value => keyForMode(value.scoringMode)));
        const landed = outcome.value;
        const reused = outcome.joined || landed.hit;
        // Findings ride along with the cache entry: the key is the rendered prompt, so they describe the
        // very evidence that produced this score. An entry written before P04 simply has none.
        return { scores: [landed.value.scoreA, landed.value.scoreB], usage: reused ? emptyUsage() : landed.value.usage, scoringMode: landed.value.scoringMode, hit: reused, channelFallback: reused ? false : fellBack, diagnostics: landed.value.diagnostics ?? [] };
    }
    async mapLimited(items, worker) {
        const results = new Array(items.length);
        let cursor = 0;
        let failed = false;
        let failure;
        const runners = Array.from({ length: Math.min(this.maxConcurrency, items.length) }, async () => {
            while (!failed && cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = await worker(items[index]);
                }
                catch (error) {
                    // Stop buying NEW work, but let every in-flight call settle first: it was already
                    // paid for, and its usage is merged into the shared accumulator the error carries.
                    // Rejecting immediately (the old Promise.all) discarded those calls' usage.
                    if (!failed) {
                        failed = true;
                        failure = error;
                    }
                }
            }
        });
        await Promise.all(runners);
        if (failed) {
            const partial = partialStats(failure);
            // All workers have settled, so the accumulator is final. partialStats returns a normalized
            // COPY, so pricing it in place would be discarded: price it and write it back onto the
            // error the failure row actually reads.
            if (partial !== undefined)
                attachUsage(failure, this.finishStats(partial));
            throw failure;
        }
        return results;
    }
    /**
     * Verdict for a comparison whose two sides are byte-identical.
     *
     * Deliberately uninformative: no model call is made, both sides score 0.5 and the winner is
     * a tie. Judging identical text would ask the model to break a tie it cannot break, and any
     * confident score would let the acceptance gate pass a session indistinguishable from the
     * empty-work baseline. Callers that need "these are the same" read {@link CompareResult.identical}.
     * @param criteria - the criteria the comparison would have scored.
     * @returns A tie carrying 0.5 per criterion, zero calls and one agreeing judge per client.
     */
    informationalTie(criteria) {
        const judges = this.clients.map(client => ({ provider: client.provider, model: client.model, label: judgeLabel(client), ok: true, calls: 0, scoreA: 0.5, scoreB: 0.5, winner: 'tie' }));
        return {
            scoreA: 0.5,
            scoreB: 0.5,
            winner: 'tie',
            criteria: criteria.map(criterion => ({ id: criterion.id, name: criterion.name, scoreA: 0.5, scoreB: 0.5 })),
            calls: 0,
            stats: this.finishStats(blankStats()),
            judges,
            agreement: 1,
            identical: true,
            // No judge ran, so nothing was located: an informational tie has nothing to report.
            diagnostics: [],
        };
    }
    async compare(options, signal) {
        // An unexecuted proposal has no observed output to match, so scoring it with the artifact
        // rubric ("Output Match") fails it by construction. The stage therefore selects the default
        // rubric; an explicit `criteria` always wins and is used verbatim.
        const criteria = options.criteria?.length ? options.criteria : options.reviewStage === 'proposal' ? PROPOSAL_CRITERIA : DEFAULT_CRITERIA;
        if (options.candidateA === options.candidateB)
            return this.informationalTie(criteria);
        const repeats = options.repeats ?? 2;
        const jobs = criteria.flatMap(criterion => Array.from({ length: repeats }, (_, repeat) => ({ criterion, repeat })));
        // Prefix warm-up: one job per DISTINCT prompt prefix runs first, then the rest fan out.
        // Only the A/B slot order changes the prompt prefix (the criterion sits at the tail, see
        // core.buildPairwisePrompt) and odd repeats swap the slots, so each orientation needs its own
        // warm call: warming a single job left every swapped-slot call cold, which is where half the
        // input tokens of a session acceptance went. The warm jobs are calls that had to happen anyway.
        const warm = [];
        const rest = [];
        const warmedOrientations = new Set();
        for (const job of jobs) {
            const orientation = job.repeat % 2;
            if (warmedOrientations.has(orientation))
                rest.push(job);
            else {
                warmedOrientations.add(orientation);
                warm.push(job);
            }
        }
        // Shared with the workers so a job that fails still reports what the earlier jobs spent:
        // aggregating only after every job resolved discarded all of it when one threw. A run with
        // two successful judge calls and one failure used to persist one attempt and zero tokens.
        const stats = blankStats();
        const judgeCalls = new Array(this.clients.length).fill(0);
        const judgeOk = new Array(this.clients.length).fill(true);
        const judgeErrors = new Array(this.clients.length).fill(undefined);
        const judgeJobScores = Array.from({ length: this.clients.length }, () => []);
        const run = async (batch) => this.mapLimited(batch, async ({ criterion, repeat }) => {
            const swapped = repeat % 2 === 1;
            const candA = swapped ? options.candidateB : options.candidateA;
            const candB = swapped ? options.candidateA : options.candidateB;
            const judgeResults = await Promise.all(this.clients.map(async (client, k) => {
                try {
                    const res = await this.scoreOne(client, options, candA, candB, criterion, repeat, signal);
                    return {
                        k,
                        ok: true,
                        scoreA: swapped ? res.scores[1] : res.scores[0],
                        scoreB: swapped ? res.scores[0] : res.scores[1],
                        usage: res.usage,
                        scoringMode: res.scoringMode,
                        hit: res.hit,
                        channelFallback: res.channelFallback,
                        // This round rendered the swapped slots; the scores are mapped back above, so the
                        // findings must be too, or a defect in the caller's A is reported against B.
                        diagnostics: swapped ? res.diagnostics.map(swapDiagnosticEvidence) : res.diagnostics,
                    };
                }
                catch (error) {
                    return {
                        k,
                        ok: false,
                        error,
                    };
                }
            }));
            for (const r of judgeResults) {
                if (r.ok) {
                    judgeCalls[r.k] += r.usage.calls;
                    judgeJobScores[r.k].push({ criterionId: criterion.id, scoreA: r.scoreA, scoreB: r.scoreB });
                    addUsage(stats, r.usage);
                    if (r.usage.usageIncomplete)
                        stats.usageIncomplete = true;
                    if (r.hit)
                        stats.cacheHits++;
                    else
                        stats.cacheMisses++;
                    if (r.scoringMode === 'top-logprobs')
                        stats.topLogprobScores++;
                    else
                        stats.explicitTagScores++;
                    if (r.channelFallback)
                        stats.channelFallbacks = (stats.channelFallbacks ?? 0) + 1;
                }
                else {
                    judgeOk[r.k] = false;
                    // The failed request really happened; fold in whatever accounting it carries (billed
                    // but unusable usage, or just its attempt count) and mark the row incomplete rather
                    // than reporting a confident zero-cost call.
                    accountFailure(stats, r.error);
                    stats.usageIncomplete = true;
                    if (judgeErrors[r.k] === undefined) {
                        judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error);
                    }
                }
            }
            const successful = judgeResults.filter((r) => r.ok);
            if (successful.length === 0) {
                const firstFail = judgeResults.find(r => !r.ok);
                // Carry the usage the earlier jobs already spent on this error.
                attachUsage(firstFail.error, stats);
                throw firstFail.error;
            }
            const leafScoreA = median(successful.map(r => r.scoreA));
            const leafScoreB = median(successful.map(r => r.scoreB));
            return { criterion, repeat, leafScoreA, leafScoreB, judgeResults, diagnostics: successful.flatMap(r => r.diagnostics) };
        });
        const jobOutcomes = [...await run(warm), ...await run(rest)];
        // Findings are located information, not a score: they are aggregated across criteria, repeats and
        // judges but de-duplicated and capped, and they never enter the score arithmetic.
        const diagnostics = [];
        const diagnosticSeen = new Set();
        for (const row of jobOutcomes)
            mergeDiagnostics(diagnostics, diagnosticSeen, row.diagnostics);
        const byCriterion = criteria.map(criterion => {
            const rows = jobOutcomes.filter(row => row.criterion.id === criterion.id);
            return {
                id: criterion.id,
                name: criterion.name,
                scoreA: average(rows.map(row => row.leafScoreA)),
                scoreB: average(rows.map(row => row.leafScoreB)),
            };
        });
        const scoreA = average(byCriterion.map(value => value.scoreA));
        const scoreB = average(byCriterion.map(value => value.scoreB));
        const winner = Math.abs(scoreA - scoreB) < 1e-12 ? 'tie' : scoreA > scoreB ? 'A' : 'B';
        const judges = this.clients.map((client, k) => {
            const isOk = judgeOk[k];
            if (!isOk) {
                return {
                    provider: client.provider,
                    model: client.model,
                    label: judgeLabel(client),
                    ok: false,
                    calls: judgeCalls[k],
                    ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
                };
            }
            const jByCriterion = criteria.map(criterion => {
                const rows = judgeJobScores[k].filter(row => row.criterionId === criterion.id);
                return {
                    scoreA: average(rows.map(row => row.scoreA)),
                    scoreB: average(rows.map(row => row.scoreB)),
                };
            });
            const jScoreA = average(jByCriterion.map(c => c.scoreA));
            const jScoreB = average(jByCriterion.map(c => c.scoreB));
            const jWinner = Math.abs(jScoreA - jScoreB) < 1e-12 ? 'tie' : jScoreA > jScoreB ? 'A' : 'B';
            return {
                provider: client.provider,
                model: client.model,
                label: judgeLabel(client),
                ok: true,
                calls: judgeCalls[k],
                scoreA: jScoreA,
                scoreB: jScoreB,
                winner: jWinner,
            };
        });
        const scoringJudges = judges.filter(j => j.ok && j.winner !== undefined);
        const agreement = scoringJudges.length === 0
            ? 0
            : scoringJudges.length === 1
                ? 1
                : scoringJudges.filter(j => j.winner === winner).length / scoringJudges.length;
        return {
            scoreA,
            scoreB,
            winner,
            criteria: byCriterion,
            calls: stats.calls,
            stats: this.finishStats(stats),
            judges,
            agreement,
            diagnostics,
        };
    }
    async scorePairs(options, pairs, signal) {
        const unique = [...new Map(pairs.map(pair => [pair[0] + ',' + pair[1], pair])).values()];
        // Aggregated inside each worker so a pair that fails still reports what the other pairs
        // already spent; the outer loop used to run only after every pair had resolved.
        const rewards = new Map();
        const judgeRewards = Array.from({ length: this.clients.length }, () => new Map());
        const judgeOk = new Array(this.clients.length).fill(true);
        const judgeErrors = new Array(this.clients.length).fill(undefined);
        const judgeCalls = new Array(this.clients.length).fill(0);
        const stats = blankStats();
        const diagnostics = [];
        const diagnosticSeen = new Set();
        const recordPair = (a, b, result) => {
            const pairKey = a + ',' + b;
            rewards.set(pairKey, [result.scoreA, result.scoreB]);
            mergeRunStats(stats, result.stats);
            // A pair's findings reference ITS two slots. A tournament ranks N candidates, so the slots
            // are rewritten into the original candidate identity before they are aggregated: reporting
            // "evidence B" for a pair the caller never saw as A/B points the agent at the wrong object.
            mergeDiagnostics(diagnostics, diagnosticSeen, result.diagnostics.map(diagnostic => locatePairDiagnostic(diagnostic, a, b)));
            for (let k = 0; k < this.clients.length; k++) {
                const js = result.judges[k];
                judgeCalls[k] += js.calls;
                if (js.ok && js.scoreA !== undefined && js.scoreB !== undefined) {
                    judgeRewards[k].set(pairKey, [js.scoreA, js.scoreB]);
                }
                else {
                    judgeOk[k] = false;
                    if (judgeErrors[k] === undefined && js.error) {
                        judgeErrors[k] = js.error;
                    }
                }
            }
        };
        await this.mapLimited(unique, async ([a, b]) => {
            try {
                const result = await this.compare({
                    problem: options.problem,
                    candidateA: options.candidates[a],
                    candidateB: options.candidates[b],
                    criteria: options.criteria,
                    groundTruthNote: options.groundTruthNote,
                    repeats: options.repeats,
                    images: options.images,
                    trace: options.trace,
                    ...(options.reviewStage === undefined ? {} : { reviewStage: options.reviewStage }),
                    ...(options.domain === undefined ? {} : { domain: options.domain }),
                    ...(options.context === undefined ? {} : { context: options.context }),
                }, signal);
                recordPair(a, b, result);
            }
            catch (error) {
                // Merge this pair's own partial usage into the shared accumulator, then hand the union
                // to the caller's failure row.
                mergeRunStats(stats, partialStats(error));
                attachUsage(error, stats);
                throw error;
            }
        });
        return { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats: this.finishStats(stats), diagnostics };
    }
    async track(problem, steps, checkpoints, repeats = 2, signal, images, trace) {
        if (!steps.length || !checkpoints.length)
            throw new Error('llm-verifier: steps and checkpoints must not be empty');
        for (const checkpoint of checkpoints)
            if (!Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > steps.length)
                throw new Error('llm-verifier: each checkpoint must be an integer between 1 and steps.length');
        const prompt = buildProgressPrompt(problem, steps, checkpoints);
        const stats = blankStats();
        const judgeCalls = new Array(this.clients.length).fill(0);
        const judgeOk = new Array(this.clients.length).fill(true);
        const judgeErrors = new Array(this.clients.length).fill(undefined);
        const judgePerRepeatScores = Array.from({ length: this.clients.length }, () => []);
        const repeatIndices = Array.from({ length: repeats }, (_, index) => index);
        const runRepeat = async (repeatIndex) => {
            const judgeResults = await Promise.all(this.clients.map(async (client, k) => {
                try {
                    const completion = await callVerifier(client, prompt, signal, images);
                    try {
                        const scores = checkpoints.map((_, index) => extractProgressScore(completion, '<c' + (index + 1) + '>'));
                        // One snapshot per repeat for the primary judge only: extra judges would
                        // multiply the record past its budget, and the primary is what the verdict
                        // reports.
                        if (k === 0)
                            trace?.({ label: 'progress repeat ' + (repeatIndex + 1) + '/' + repeats + (this.clients.length > 1 ? ' judge 1/' + this.clients.length : ''), channel: completion.scoringMode, prompt, output: completion.text, score: scores[scores.length - 1] });
                        // The prompt offered the checkpoint labels c1..cN and the task block as citable
                        // evidence; anything else the judge cites is dropped by the parser.
                        const labels = checkpoints.map((_, index) => 'c' + (index + 1));
                        const diagnostics = parseDiagnostics(completion.text, { checkpoints: labels, evidence: ['TASK', ...labels] });
                        return {
                            k,
                            ok: true,
                            completion,
                            scores,
                            diagnostics,
                        };
                    }
                    catch (error) {
                        // The response came back and was billed; a failed progress parse must keep its usage.
                        attachBilled(error, completion.usage);
                        throw error;
                    }
                }
                catch (error) {
                    return {
                        k,
                        ok: false,
                        error,
                    };
                }
            }));
            // Aggregate BEFORE the all-failed check so an earlier repeat's usage survives a later
            // repeat throwing; the error then carries it to the failure row.
            for (const r of judgeResults) {
                if (r.ok) {
                    judgeCalls[r.k] += r.completion.usage.calls;
                    judgePerRepeatScores[r.k].push(r.scores);
                    addUsage(stats, r.completion.usage);
                    if (r.completion.usage.usageIncomplete)
                        stats.usageIncomplete = true;
                    if (r.completion.scoringMode === 'top-logprobs')
                        stats.topLogprobScores++;
                    else
                        stats.explicitTagScores++;
                    if (r.completion.channelFallback)
                        stats.channelFallbacks = (stats.channelFallbacks ?? 0) + 1;
                }
                else {
                    judgeOk[r.k] = false;
                    accountFailure(stats, r.error);
                    stats.usageIncomplete = true;
                    if (judgeErrors[r.k] === undefined) {
                        judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error);
                    }
                }
            }
            const successful = judgeResults.filter((r) => r.ok);
            if (successful.length === 0) {
                const firstFail = judgeResults.find(r => !r.ok);
                attachUsage(firstFail.error, stats);
                throw firstFail.error;
            }
            const diagnostics = [];
            const diagnosticSeen = new Set();
            for (const row of successful)
                mergeDiagnostics(diagnostics, diagnosticSeen, row.diagnostics);
            return { scores: checkpoints.map((_, cIndex) => median(successful.map(r => r.scores[cIndex]))), diagnostics };
        };
        // Every repeat sends the SAME prompt, so the first repeat warms the provider prefix cache for
        // the others; fanning all repeats out at once left every call cold. The repeat count is
        // unchanged — only the order, and therefore the cache hits, change.
        const runs = [];
        const diagnostics = [];
        const diagnosticSeen = new Set();
        const collect = (outcomes) => {
            for (const outcome of outcomes) {
                runs.push(outcome.scores);
                mergeDiagnostics(diagnostics, diagnosticSeen, outcome.diagnostics);
            }
        };
        if (repeatIndices.length > 0)
            collect(await this.mapLimited(repeatIndices.slice(0, 1), runRepeat));
        collect(await this.mapLimited(repeatIndices.slice(1), runRepeat));
        const scores = checkpoints.map((_, index) => average(runs.map(run => run[index])));
        const judges = this.clients.map((client, k) => {
            const isOk = judgeOk[k];
            if (!isOk) {
                return {
                    provider: client.provider,
                    model: client.model,
                    label: judgeLabel(client),
                    ok: false,
                    calls: judgeCalls[k],
                    ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
                };
            }
            const jRuns = judgePerRepeatScores[k];
            const jScores = checkpoints.map((_, index) => average(jRuns.map(run => run[index])));
            return {
                provider: client.provider,
                model: client.model,
                label: judgeLabel(client),
                ok: true,
                calls: judgeCalls[k],
                scores: jScores,
            };
        });
        return { scores, perRepeat: runs, calls: stats.calls, stats: this.finishStats(stats), judges, diagnostics };
    }
    /**
     * Verdict for a candidate list whose entries are all byte-identical.
     *
     * Ranking identical text is a coin flip, so the result is deliberately uninformative
     * (0.5 everywhere) rather than a confident 1.0. No model call is made. This is the
     * cost-saving half of upstream's majority-vote shortcut without its semantics: we never
     * declare an unjudged candidate the winner, we only decline to spend calls on a tie.
     * @param candidates - the identical candidates (length >= 2).
     * @returns A ranking with every score at 0.5 and zero calls.
     */
    identicalCandidates(candidates) {
        const scores = candidates.map(() => 0.5);
        const ranking = candidates.map((_, index) => index);
        return {
            index: 0,
            best: candidates[0],
            scores,
            ranking,
            pivots: [],
            comparisons: 0,
            calls: 0,
            stats: blankStats(),
            judges: this.clients.map(client => ({ provider: client.provider, model: client.model, label: judgeLabel(client), ok: true, calls: 0, scores: [...scores], ranking: [...ranking] })),
            identical: true,
            diagnostics: [],
        };
    }
    /**
     * Judge only the DISTINCT candidates, then expand the verdict back onto the caller's list.
     *
     * Duplicated candidates are the common case when an agent pastes several drafts of the same
     * artifact: every pair that touches a duplicate is a comparison that cannot change the
     * ranking but still costs model calls. The tournament runs on the distinct list and every
     * duplicate inherits its representative's score, so no index, score or ranking entry shifts.
     * @param options - the original select options, duplicates included.
     * @param signal - caller's abort signal.
     * @returns The tournament verdict mapped back onto the original candidate list.
     */
    async selectUnique(options, signal) {
        const unique = [];
        /** unique index -> the caller's FIRST index of that candidate (the inverse of `representative`). */
        const originals = [];
        const representative = [];
        const seen = new Map();
        for (const candidate of options.candidates) {
            let index = seen.get(candidate);
            if (index === undefined) {
                index = unique.length;
                unique.push(candidate);
                seen.set(candidate, index);
                originals.push(representative.length);
            }
            representative.push(index);
        }
        const result = await this.select({ ...options, candidates: unique }, signal);
        const expand = (values) => representative.map(index => values[index] ?? 0);
        const scores = expand(result.scores);
        const judges = result.judges.map(judge => {
            if (!judge.ok || judge.scores === undefined)
                return judge;
            const judgeScores = expand(judge.scores);
            return { ...judge, scores: judgeScores, ...(judge.ranking === undefined ? {} : { ranking: rankByScore(judgeScores) }) };
        });
        // The tournament numbered the DISTINCT candidates. The caller never saw that list, so a finding
        // has to be renumbered onto the original indices exactly like the scores and rankings above —
        // otherwise "candidate 2" of a deduplicated list points at a different entry of the caller's.
        const diagnostics = [];
        const diagnosticSeen = new Set();
        for (const diagnostic of result.diagnostics)
            mergeDiagnostics(diagnostics, diagnosticSeen, [remapCandidateDiagnostic(diagnostic, originals)]);
        return {
            index: options.candidates.indexOf(result.best),
            best: result.best,
            scores,
            ranking: rankByScore(scores),
            pivots: result.pivots,
            comparisons: result.comparisons,
            calls: result.calls,
            stats: result.stats,
            judges,
            diagnostics,
        };
    }
    async select(options, signal) {
        if (!options.candidates.length)
            throw new Error('llm-verifier: candidates must not be empty');
        if (options.candidates.some(candidate => candidate.trim() === ''))
            throw new Error('llm-verifier: candidates must not contain blank entries');
        if (options.candidates.length > 1 && options.candidates.every(candidate => candidate === options.candidates[0]))
            return this.identicalCandidates(options.candidates);
        if (options.candidates.length > 1 && new Set(options.candidates).size !== options.candidates.length)
            return this.selectUnique(options, signal);
        if (options.candidates.length === 1) {
            const judges = this.clients.map(client => ({
                provider: client.provider,
                model: client.model,
                label: judgeLabel(client),
                ok: true,
                calls: 0,
                scores: [1],
                ranking: [0],
            }));
            return { index: 0, best: options.candidates[0], scores: [1], ranking: [0], pivots: [0], comparisons: 0, calls: 0, stats: blankStats(), judges, diagnostics: [] };
        }
        if (options.candidates.length === 2) {
            // ringCycle(2) would judge the single unordered pair in both directions; play it
            // once, in the orientation orientPair() picks so the slot is not always candidate 0.
            const single = orientPair(0, 1);
            const { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats, diagnostics } = await this.scorePairs(options, [single], signal);
            const wins = [0, 0];
            const counts = [0, 0];
            accumulatePairs([single], rewards, wins, counts);
            const ranked = rankScores(wins, counts);
            const index = ranked[0].index;
            const judges = this.clients.map((client, k) => {
                const isOk = judgeOk[k];
                if (!isOk) {
                    return {
                        provider: client.provider,
                        model: client.model,
                        label: judgeLabel(client),
                        ok: false,
                        calls: judgeCalls[k],
                        ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
                    };
                }
                const jWins = [0, 0];
                const jCounts = [0, 0];
                accumulatePairs([[0, 1]], judgeRewards[k], jWins, jCounts);
                const jRanked = rankScores(jWins, jCounts);
                return {
                    provider: client.provider,
                    model: client.model,
                    label: judgeLabel(client),
                    ok: true,
                    calls: judgeCalls[k],
                    scores: jWins.map((val, c) => val / (jCounts[c] || 1)),
                    ranking: jRanked.map(v => v.index),
                };
            });
            return { index, best: options.candidates[index], scores: wins.map((value, candidate) => value / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots: [], comparisons: 1, calls: stats.calls, stats, judges, diagnostics };
        }
        const ring = ringCycle(options.candidates.length, options.seed ?? 0);
        const ringScores = await this.scorePairs(options, ring, signal);
        const firstWins = new Array(options.candidates.length).fill(0);
        const firstCounts = new Array(options.candidates.length).fill(0);
        accumulatePairs(ring, ringScores.rewards, firstWins, firstCounts);
        const pivots = topPivots(firstWins, firstCounts, options.pivots ?? 2);
        // pivotRoundPairs regenerates every ring edge that touches a pivot (reversed for
        // pivot→neighbour edges). Dropping those duplicates keeps each unordered pair to a
        // single match so wins/counts are not double-weighted and no pair is judged twice.
        const ringPairs = new Set(ring.map(pair => unorderedPair(pair[0], pair[1])));
        const rounds = orientRoundPairs(pivotRoundPairs(options.candidates.length, pivots).filter(pair => !ringPairs.has(unorderedPair(pair[0], pair[1]))));
        // The ring phase is already paid for. Accumulate it BEFORE the pivot phase so a pivot
        // failure keeps the successful pairs' usage on the thrown error instead of losing it.
        const stats = blankStats();
        mergeRunStats(stats, ringScores.stats);
        const roundScores = await this.scorePairs(options, rounds, signal).catch((error) => {
            mergeRunStats(stats, partialStats(error));
            attachUsage(error, this.finishStats(stats));
            throw error;
        });
        mergeRunStats(stats, roundScores.stats);
        const allRewards = new Map([...ringScores.rewards, ...roundScores.rewards]);
        const wins = new Array(options.candidates.length).fill(0);
        const counts = new Array(options.candidates.length).fill(0);
        accumulatePairs(ring, allRewards, wins, counts);
        accumulatePairs(rounds, allRewards, wins, counts);
        const ranked = rankScores(wins, counts);
        const index = ranked[0].index;
        const judges = this.clients.map((client, k) => {
            const isOk = ringScores.judgeOk[k] && roundScores.judgeOk[k];
            const totalCalls = ringScores.judgeCalls[k] + roundScores.judgeCalls[k];
            const firstError = ringScores.judgeErrors[k] ?? roundScores.judgeErrors[k];
            if (!isOk) {
                return {
                    provider: client.provider,
                    model: client.model,
                    label: judgeLabel(client),
                    ok: false,
                    calls: totalCalls,
                    ...(firstError !== undefined ? { error: firstError } : {}),
                };
            }
            const jAllRewards = new Map([...ringScores.judgeRewards[k], ...roundScores.judgeRewards[k]]);
            const jWins = new Array(options.candidates.length).fill(0);
            const jCounts = new Array(options.candidates.length).fill(0);
            accumulatePairs(ring, jAllRewards, jWins, jCounts);
            accumulatePairs(rounds, jAllRewards, jWins, jCounts);
            const jRanked = rankScores(jWins, jCounts);
            return {
                provider: client.provider,
                model: client.model,
                label: judgeLabel(client),
                ok: true,
                calls: totalCalls,
                scores: Array.from({ length: options.candidates.length }, (_, c) => jWins[c] / (jCounts[c] || 1)),
                ranking: jRanked.map(v => v.index),
            };
        });
        const diagnostics = [];
        const diagnosticSeen = new Set();
        mergeDiagnostics(diagnostics, diagnosticSeen, ringScores.diagnostics);
        mergeDiagnostics(diagnostics, diagnosticSeen, roundScores.diagnostics);
        return { index, best: options.candidates[index], scores: Array.from({ length: options.candidates.length }, (_, candidate) => wins[candidate] / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots, comparisons: ring.length + rounds.length, calls: stats.calls, stats: this.finishStats(stats), judges, diagnostics };
    }
}
/**
 * Normalize a caller-supplied `criteria` argument into the engine's canonical shape.
 *
 * Mirrors upstream's `normalize_criteria` so a caller does not have to fill in every field: a
 * plain string is both the name and the instruction, and a missing `id` is slugged from the
 * name (the score cache keys on the rendered prompt, so a slug is cosmetic). Ids are
 * de-duplicated because `compare` groups per-criterion results by id — a collision would
 * silently merge two criteria into one line of the verdict.
 * @param input - undefined (the default rubric), or a non-empty array of strings/objects.
 * @returns The criteria the engine will score with.
 */
export function normalizeCriteria(input) {
    if (input === undefined)
        return DEFAULT_CRITERIA;
    if (!Array.isArray(input) || !input.length)
        throw new Error('llm-verifier: criteria must be a non-empty array');
    const seen = new Set();
    return input.map((value, index) => {
        if (typeof value === 'string') {
            const text = value.trim();
            if (!text)
                throw new Error('llm-verifier: criteria[' + index + '] must not be blank');
            return { id: dedupeCriterionId(slugCriterionId(text), seen), name: text, description: text };
        }
        if (typeof value !== 'object' || value === null)
            throw new Error('llm-verifier: criteria[' + index + '] must be a string or an object');
        const row = value;
        const field = (key) => (typeof row[key] === 'string' ? row[key].trim() : '');
        const description = field('description');
        if (!description)
            throw new Error('llm-verifier: criteria[' + index + '].description must be a non-empty string');
        const name = field('name') || field('id') || slugCriterionId(description);
        const id = field('id') || slugCriterionId(name);
        return { id: dedupeCriterionId(id, seen), name, description };
    });
}
export { DEFAULT_GROUND_TRUTH_NOTE };
//# sourceMappingURL=engine.js.map