import { addUsage, callVerifier, emptyUsage, predictScoringChannel } from "./caller.js";
import { ScoreCache, SingleFlight, stableHash } from "./cache.js";
import { DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, accumulatePairs, buildPairwisePrompt, buildProgressPrompt, extractProgressScore, extractScore, rankScores, selectPairs, } from "./core.js";
function average(values) { return values.reduce((sum, value) => sum + value, 0) / (values.length || 1); }
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function blankStats() { return { ...emptyUsage(), cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }; }
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
        this.flights = flights;
    }
    finishStats(stats) {
        stats.estimatedCostUsd = ((stats.inputTokens + stats.cachedInputTokens) * this.inputPrice + stats.outputTokens * this.outputPrice) / 1_000_000;
        return stats;
    }
    async scoreOne(client, options, candidateA, candidateB, criterion, repeat, signal) {
        const ground = options.groundTruthNote ?? DEFAULT_GROUND_TRUTH_NOTE;
        const prompt = buildPairwisePrompt(options.problem, candidateA, candidateB, criterion, ground);
        const imageKey = options.images?.map(image => stableHash([image.mediaType, Buffer.from(image.data).toString('base64')]));
        // Cache identity pins the scoring channel, but the channel is only predictable
        // before the call when the capability cache already knows the answer. Lookups use
        // the predicted channel while entries are always stored under the ACTUAL
        // completion mode, so a first-call downgrade lands under explicit-tag keys and is
        // found by later explicit-tag calls instead of being misread as a top-logprobs
        // expectation. The channel stays OUT of the in-flight dedup key below.
        const identity = { version: 6, provider: client.provider, model: client.model, effort: client.reasoningEffort, maxTokens: client.maxTokens, temperature: client.temperature, repeat, promptHash: stableHash(prompt), imageKey };
        const keyForMode = (scoringMode) => stableHash({ ...identity, scoringMode });
        const create = async () => {
            const completion = await callVerifier(client, prompt, signal, options.images);
            return { scoreA: extractScore(completion, '<score_A>'), scoreB: extractScore(completion, '<score_B>'), usage: completion.usage, scoringMode: completion.scoringMode, createdAt: Date.now() };
        };
        const cache = this.cache;
        if (cache === undefined) {
            const value = await create();
            return { scores: [value.scoreA, value.scoreB], usage: value.usage, scoringMode: value.scoringMode, hit: false };
        }
        // Registration happens in the synchronous segment before any await, so a request
        // that arrives while the first one is still resolving its channel prediction
        // still merges instead of duplicating the model call. The flight table is shared
        // per topic, so concurrent tool calls through separate engine instances merge too.
        const dedupeKey = stableHash(identity);
        const outcome = await this.flights.run(dedupeKey, async () => cache.getOrCreate(keyForMode(await predictScoringChannel(client)), create, value => keyForMode(value.scoringMode)));
        const landed = outcome.value;
        const reused = outcome.joined || landed.hit;
        return { scores: [landed.value.scoreA, landed.value.scoreB], usage: reused ? emptyUsage() : landed.value.usage, scoringMode: landed.value.scoringMode, hit: reused };
    }
    async mapLimited(items, worker) {
        const results = new Array(items.length);
        let cursor = 0;
        const runners = Array.from({ length: Math.min(this.maxConcurrency, items.length) }, async () => { while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index]);
        } });
        await Promise.all(runners);
        return results;
    }
    async compare(options, signal) {
        const criteria = options.criteria?.length ? options.criteria : DEFAULT_CRITERIA;
        const repeats = options.repeats ?? 2;
        const jobs = criteria.flatMap(criterion => Array.from({ length: repeats }, (_, repeat) => ({ criterion, repeat })));
        // Prefix warm-up: one criterion/repeat runs first, then the shared-prefix fan-out.
        const warm = jobs.slice(0, 1);
        const rest = jobs.slice(1);
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
            const successful = judgeResults.filter((r) => r.ok);
            if (successful.length === 0) {
                const firstFail = judgeResults.find(r => !r.ok);
                throw firstFail.error;
            }
            const leafScoreA = median(successful.map(r => r.scoreA));
            const leafScoreB = median(successful.map(r => r.scoreB));
            return { criterion, repeat, leafScoreA, leafScoreB, judgeResults };
        });
        const jobOutcomes = [...await run(warm), ...await run(rest)];
        const stats = blankStats();
        const judgeCalls = new Array(this.clients.length).fill(0);
        const judgeOk = new Array(this.clients.length).fill(true);
        const judgeErrors = new Array(this.clients.length).fill(undefined);
        const judgeJobScores = Array.from({ length: this.clients.length }, () => []);
        for (const outcome of jobOutcomes) {
            for (const r of outcome.judgeResults) {
                if (r.ok) {
                    judgeCalls[r.k] += r.usage.calls;
                    judgeJobScores[r.k].push({ criterionId: outcome.criterion.id, scoreA: r.scoreA, scoreB: r.scoreB });
                    addUsage(stats, r.usage);
                    if (r.hit)
                        stats.cacheHits++;
                    else
                        stats.cacheMisses++;
                    if (r.scoringMode === 'top-logprobs')
                        stats.topLogprobScores++;
                    else
                        stats.explicitTagScores++;
                }
                else {
                    judgeOk[r.k] = false;
                    if (judgeErrors[r.k] === undefined) {
                        judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error);
                    }
                }
            }
        }
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
        };
    }
    async scorePairs(options, pairs, signal) {
        const unique = [...new Map(pairs.map(pair => [pair[0] + ',' + pair[1], pair])).values()];
        const values = await this.mapLimited(unique, async ([a, b]) => ({
            a,
            b,
            result: await this.compare({
                problem: options.problem,
                candidateA: options.candidates[a],
                candidateB: options.candidates[b],
                criteria: options.criteria,
                groundTruthNote: options.groundTruthNote,
                repeats: options.repeats,
                images: options.images,
            }, signal),
        }));
        const rewards = new Map();
        const judgeRewards = Array.from({ length: this.clients.length }, () => new Map());
        const judgeOk = new Array(this.clients.length).fill(true);
        const judgeErrors = new Array(this.clients.length).fill(undefined);
        const judgeCalls = new Array(this.clients.length).fill(0);
        const stats = blankStats();
        for (const value of values) {
            const pairKey = value.a + ',' + value.b;
            rewards.set(pairKey, [value.result.scoreA, value.result.scoreB]);
            addUsage(stats, value.result.stats);
            stats.cacheHits += value.result.stats.cacheHits;
            stats.cacheMisses += value.result.stats.cacheMisses;
            stats.topLogprobScores += value.result.stats.topLogprobScores;
            stats.explicitTagScores += value.result.stats.explicitTagScores;
            for (let k = 0; k < this.clients.length; k++) {
                const js = value.result.judges[k];
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
        }
        return { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats: this.finishStats(stats) };
    }
    async track(problem, steps, checkpoints, repeats = 2, signal, images) {
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
        const runs = await this.mapLimited(repeatIndices, async () => {
            const judgeResults = await Promise.all(this.clients.map(async (client, k) => {
                try {
                    const completion = await callVerifier(client, prompt, signal, images);
                    const scores = checkpoints.map((_, index) => extractProgressScore(completion, '<c' + (index + 1) + '>'));
                    return {
                        k,
                        ok: true,
                        completion,
                        scores,
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
            const successful = judgeResults.filter((r) => r.ok);
            if (successful.length === 0) {
                const firstFail = judgeResults.find(r => !r.ok);
                throw firstFail.error;
            }
            for (const r of judgeResults) {
                if (r.ok) {
                    judgeCalls[r.k] += r.completion.usage.calls;
                    judgePerRepeatScores[r.k].push(r.scores);
                    addUsage(stats, r.completion.usage);
                    if (r.completion.scoringMode === 'top-logprobs')
                        stats.topLogprobScores++;
                    else
                        stats.explicitTagScores++;
                }
                else {
                    judgeOk[r.k] = false;
                    if (judgeErrors[r.k] === undefined) {
                        judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error);
                    }
                }
            }
            return checkpoints.map((_, cIndex) => median(successful.map(r => r.scores[cIndex])));
        });
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
        return { scores, perRepeat: runs, calls: stats.calls, stats: this.finishStats(stats), judges };
    }
    async select(options, signal) {
        if (!options.candidates.length)
            throw new Error('llm-verifier: candidates must not be empty');
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
            return { index: 0, best: options.candidates[0], scores: [1], ranking: [0], pivots: [0], comparisons: 0, calls: 0, stats: blankStats(), judges };
        }
        if (options.candidates.length === 2) {
            // ringCycle(2) would judge the single unordered pair in both directions; play it once.
            const { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats } = await this.scorePairs(options, [[0, 1]], signal);
            const wins = [0, 0];
            const counts = [0, 0];
            accumulatePairs([[0, 1]], rewards, wins, counts);
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
            return { index, best: options.candidates[index], scores: wins.map((value, candidate) => value / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots: [], comparisons: 1, calls: stats.calls, stats, judges };
        }
        // One shared plan decides which pairs are judged AND what that costs: a fresh pivot
        // round re-lists every ring edge that touches a pivot, and those duplicates are
        // dropped so each unordered pair is judged once (see selectPairs). Estimating the
        // count separately is what let the router's reservation drift away from reality.
        const { ring, pivots, pairs } = selectPairs(options.candidates.length, options.seed ?? 0, options.pivots ?? 2);
        const ringScores = await this.scorePairs(options, ring, signal);
        const rounds = pairs.slice(ring.length);
        const roundScores = await this.scorePairs(options, rounds, signal);
        const allRewards = new Map([...ringScores.rewards, ...roundScores.rewards]);
        const wins = new Array(options.candidates.length).fill(0);
        const counts = new Array(options.candidates.length).fill(0);
        accumulatePairs(ring, allRewards, wins, counts);
        accumulatePairs(rounds, allRewards, wins, counts);
        const ranked = rankScores(wins, counts);
        const index = ranked[0].index;
        const stats = blankStats();
        for (const source of [ringScores.stats, roundScores.stats]) {
            addUsage(stats, source);
            stats.cacheHits += source.cacheHits;
            stats.cacheMisses += source.cacheMisses;
            stats.topLogprobScores += source.topLogprobScores;
            stats.explicitTagScores += source.explicitTagScores;
        }
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
        return { index, best: options.candidates[index], scores: Array.from({ length: options.candidates.length }, (_, candidate) => wins[candidate] / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots, comparisons: pairs.length, calls: stats.calls, stats: this.finishStats(stats), judges };
    }
}
export function normalizeCriteria(input) {
    if (input === undefined)
        return DEFAULT_CRITERIA;
    if (!Array.isArray(input) || !input.length)
        throw new Error('llm-verifier: criteria must be a non-empty array');
    return input.map((value, index) => { if (typeof value !== 'object' || value === null)
        throw new Error('llm-verifier: criteria[' + index + '] must be an object'); const row = value; for (const key of ['id', 'name', 'description'])
        if (typeof row[key] !== 'string' || row[key].trim().length === 0)
            throw new Error('llm-verifier: criteria[' + index + '].' + key + ' must be non-empty'); return { id: String(row.id), name: String(row.name), description: String(row.description) }; });
}
export { DEFAULT_GROUND_TRUTH_NOTE };
//# sourceMappingURL=engine.js.map