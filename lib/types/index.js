import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Config, installVerifierSettings, resolveConfig } from "./config.js";
import { RequestLimiter, callVerifierText } from "./caller.js";
import { TopLogprobCapabilityCache, resolveCapabilityFile } from "./top-logprobs.js";
import { ScoreCache, SingleFlight, resolveCacheFile, stableHash } from "./cache.js";
import { VerifierEngine, normalizeCriteria } from "./engine.js";
import { loadVerifierImages } from "./images.js";
import { extractSession } from "./session.js";
import { AutoVerificationBudget, analyzeAutoTask, automaticFeedback } from "./auto.js";
import { AutoVerifierRouter, analyzeStructuredRoute, boundDecision, buildSemanticRoutePrompt, parseSemanticRoute, semanticDecision, semanticRouteHint } from "./router.js";
import { StatisticsStore, emptyRunStats, errorDetails, mergeStatisticsOverviews, resolveStatisticsFile } from "./statistics.js";
import { resolveTopicDataDir } from "./topic-storage.js";
export const name = 'llm-verifier';
export const inject = ['tools', 'agents', 'attachments', 'llm', 'connection', 'sessionPersistence'];
export { Config };
export * from "./core.js";
export * from "./engine.js";
export * from "./cache.js";
export * from "./statistics.js";
export * from "./topic-storage.js";
export * from "./auto.js";
export * from "./router.js";
export { callVerifier, RequestLimiter } from "./caller.js";
const criterionSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, description: { type: 'string', required: true } } };
const statsSchema = { type: 'object', additionalProperties: false, properties: { calls: { type: 'integer', required: true }, attempts: { type: 'integer', required: true }, retries: { type: 'integer', required: true }, inputTokens: { type: 'integer', required: true }, cachedInputTokens: { type: 'integer', required: true }, outputTokens: { type: 'integer', required: true }, reasoningTokens: { type: 'integer', required: true }, cacheHits: { type: 'integer', required: true }, cacheMisses: { type: 'integer', required: true }, estimatedCostUsd: { type: 'number', required: true }, topLogprobScores: { type: 'integer', required: true }, explicitTagScores: { type: 'integer', required: true } } };
const criterionResultSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true } } };
const commonParams = { criteria: { type: 'array', items: criterionSchema }, repeats: { type: 'integer' }, images: { type: 'array', items: { type: 'string' }, description: 'Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input.' } };
function renderJson(value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }]; }
function positive(value, fallback, field) { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error('llm-verifier: ' + field + ' must be a positive integer'); return result; }
function numberField(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function statsFrom(value) { if (typeof value !== 'object' || value === null || !('stats' in value))
    return emptyRunStats(); const source = value.stats; if (typeof source !== 'object' || source === null)
    return emptyRunStats(); const row = source; return { calls: numberField(row.calls, 0), attempts: numberField(row.attempts, 0), retries: numberField(row.retries, 0), inputTokens: numberField(row.inputTokens, 0), cachedInputTokens: numberField(row.cachedInputTokens, 0), outputTokens: numberField(row.outputTokens, 0), reasoningTokens: numberField(row.reasoningTokens, 0), cacheHits: numberField(row.cacheHits, 0), cacheMisses: numberField(row.cacheMisses, 0), estimatedCostUsd: numberField(row.estimatedCostUsd, 0), topLogprobScores: numberField(row.topLogprobScores, 0), explicitTagScores: numberField(row.explicitTagScores, 0) }; }
function rpcSuccess(value) { return { ok: true, value }; }
function rpcFailure(message) { return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }; }
export function apply(ctx, config = {}) {
    const services = ctx;
    const entry = resolveConfig(config);
    let limiter = new RequestLimiter(entry.maxConcurrency);
    const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency); });
    const autoBudget = new AutoVerificationBudget();
    const autoRouter = new AutoVerifierRouter();
    const topics = new Map();
    const topic = (header) => {
        const selected = current();
        const dataDir = resolveTopicDataDir(services.sessionPersistence, header, selected.cacheDir);
        const id = String(header.id);
        const existing = topics.get(id);
        if (existing?.dataDir === dataDir)
            return existing;
        const cacheFile = resolveCacheFile(dataDir);
        const created = { dataDir, cache: new ScoreCache(cacheFile, selected.cacheMaxEntries), capabilities: new TopLogprobCapabilityCache(resolveCapabilityFile(dataDir)), flights: new SingleFlight(), statistics: new StatisticsStore(resolveStatisticsFile(cacheFile)) };
        topics.set(id, created);
        return created;
    };
    const requireAgent = (agent) => {
        const selected = agent ?? ctx.agents.currentInitiator();
        if (selected === undefined)
            throw new Error('llm-verifier: verifier tools require an agent-owned topic so their data can follow topic deletion');
        return selected;
    };
    const engine = async (agent) => {
        const selected = current();
        await ctx.llm.resolveCallConfig({ provider: selected.provider, model: selected.model, ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}), maxTokens: selected.maxTokens });
        const topicEntry = topic(agent.session.header);
        return { verifier: new VerifierEngine({ ...selected, ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities: topicEntry.capabilities, limiter }, selected.maxConcurrency, topicEntry.cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }, topicEntry.flights), selected };
    };
    const images = (values, signal) => loadVerifierImages(values, signal);
    const route = (selected) => ({ provider: selected.provider, model: selected.model });
    const requireEnabled = () => { if (!current().enabled)
        throw new Error('llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier'); };
    const record = async (toolName, agent, operation) => {
        const startedAt = Date.now();
        let selected = current();
        const statistics = topic(agent.session.header).statistics;
        try {
            const completed = await operation();
            selected = completed.selected;
            const value = { ...completed.result, ...route(selected) };
            await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: true, provider: selected.provider, model: selected.model, stats: statsFrom(value) }).catch(() => { });
            return value;
        }
        catch (error) {
            const details = errorDetails(error);
            await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: false, ...details, provider: selected.provider, model: selected.model, stats: emptyRunStats() }).catch(() => { });
            throw error;
        }
    };
    const verifySession = async (agent, options, signal) => record('verifier_current_session', agent, async () => {
        const extracted = await extractSession(agent, async (ref) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType }; }, { fromSeq: options.fromSeq, toSeq: options.toSeq, includeAssistantText: options.includeAssistantText, redactPatterns: options.redactPatterns, maxChars: options.maxChars });
        const { verifier, selected } = await engine(agent);
        const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: '(No useful work or verification was performed.)', repeats: positive(options.repeats, 2, 'repeats'), images: extracted.images }, signal);
        const result = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats };
        return { result, selected };
    });
    const compareCandidates = async (agent, problem, candidateA, candidateB, repeats, signal, routedImages = []) => record('verifier_compare', agent, async () => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.compare({ problem, candidateA, candidateB, repeats, images: routedImages }, signal), selected };
    });
    const selectCandidates = async (agent, problem, candidates, repeats, signal, routedImages = []) => record('verifier_select', agent, async () => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.select({ problem, candidates, repeats, pivots: Math.min(2, candidates.length), seed: 0, images: routedImages }, signal), selected };
    });
    const trackProgress = async (agent, problem, steps, checkpoints, repeats, signal, routedImages = []) => record('verifier_track', agent, async () => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.track(problem, steps, checkpoints, repeats, signal, routedImages), selected };
    });
    const classifyRoute = async (agent, prompt, signal) => record('verifier_route_classify', agent, async () => {
        const { verifier, selected } = await engine(agent);
        const completion = await callVerifierText(verifier.client, prompt, signal);
        const stats = { ...completion.usage, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: ((completion.usage.inputTokens + completion.usage.cachedInputTokens) * selected.estimatedInputUsdPerMillion + completion.usage.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000, topLogprobScores: 0, explicitTagScores: 1 };
        return { result: { text: completion.text, stats }, selected };
    });
    const extractTask = async (agent, fromSeq, toSeq, maxChars, signal) => extractSession(agent, async (ref) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType }; }, { fromSeq, toSeq, includeAssistantText: true, maxChars });
    const routePolicy = (selected) => ({ mode: selected.autoVerifyMode, minConfidence: selected.autoRouteMinConfidence, maxCandidates: selected.autoRouteMaxCandidates, maxPerTask: selected.autoRouteMaxPerTask + selected.autoVerifyMaxPerTask, maxPerSession: selected.autoRouteMaxPerSession + selected.autoVerifyMaxPerSession, maxModelCallsPerTask: selected.autoMaxModelCallsPerTask, maxModelCallsPerSession: selected.autoMaxModelCallsPerSession, maxInputChars: selected.autoRouteMaxInputChars, maxItemChars: selected.autoRouteMaxItemChars });
    const routeFeedback = (decision, detail) => createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing: ' + decision.kind + ']\n' + detail + '\nUse this independent result to continue the actual task. Do not merely restate the ranking or progress score; implement, correct, and verify the required work.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier', form: 'notice', summary: 'Automatic verifier routed ' + decision.kind } });
    ctx.effect(() => services.connection.rpc.handle('/llm-verifier', async (endpoint, payload) => {
        if (endpoint !== 'statistics')
            return rpcFailure('unknown llm-verifier endpoint');
        if (typeof payload !== 'object' || payload === null)
            return rpcFailure('statistics payload must be an object');
        const row = payload;
        const sessionId = typeof row.sessionId === 'string' && row.sessionId.length > 0 ? row.sessionId : undefined;
        const query = { fromMs: numberField(row.fromMs, Number.NaN), toMs: numberField(row.toMs, Number.NaN), timezoneOffsetMinutes: numberField(row.timezoneOffsetMinutes, 0), recentLimit: numberField(row.recentLimit, 40), ...(sessionId ? { sessionId } : {}) };
        try {
            const headers = (await services.sessionPersistence.list()).filter(header => sessionId === undefined || String(header.id) === sessionId);
            const overviews = await Promise.all(headers.map(header => topic(header).statistics.overview(query)));
            const value = mergeStatisticsOverviews(overviews, query);
            return rpcSuccess(value);
        }
        catch (error) {
            return rpcFailure(error instanceof Error ? error.message : String(error));
        }
    }, { authority: 'loopback' }), 'llm-verifier: statistics rpc');
    ctx.on('agent/disposed', ({ agent }) => { autoBudget.release(agent); autoRouter.release(agent); topics.delete(String(agent.id)); });
    ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
        const selected = current();
        if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted)
            return;
        const policy = routePolicy(selected);
        const evidence = analyzeAutoTask(agent.session.events, { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession });
        const admittedLastSeq = agent.session.events.at(-1)?.seq ?? -1;
        const snapshot = agent.session.events.filter(event => event.seq <= admittedLastSeq);
        const stillCurrent = () => !signal.aborted && (agent.session.events.at(-1)?.seq ?? -1) === admittedLastSeq;
        let decision = boundDecision(analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars), policy);
        if (decision === undefined && selected.autoRouteSemantic && (selected.autoVerifyMode === 'strict' || semanticRouteHint(snapshot))) {
            const fingerprint = stableHash({ phase: 'semantic', from: evidence.taskStartSeq, to: admittedLastSeq, model: selected.provider + '/' + selected.model });
            const reservation = autoRouter.reserve(agent, 'semantic', fingerprint, 1, policy);
            if (reservation) {
                try {
                    const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                    const classified = await classifyRoute(agent, buildSemanticRoutePrompt(extracted.problem, snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars), signal);
                    if (!stillCurrent()) {
                        autoRouter.fail(agent, reservation, false);
                        return;
                    }
                    const parsed = parseSemanticRoute(classified.text, selected.autoRouteMaxCandidates);
                    if (!parsed)
                        throw new Error('semantic router returned invalid strict JSON');
                    decision = parsed.confidence >= selected.autoRouteMinConfidence ? boundDecision(semanticDecision(parsed, snapshot, selected.autoRouteMaxItemChars), policy) : undefined;
                    autoRouter.commit(agent, reservation);
                }
                catch (error) {
                    autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict');
                    ctx.logger.warn('llm-verifier automatic classification failed: ' + (error instanceof Error ? error.message : String(error)));
                    if (selected.autoVerifyMode === 'strict' && !signal.aborted)
                        agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict route classification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until directly relevant verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                    return;
                }
            }
        }
        if (!stillCurrent())
            return;
        if (decision) {
            const expectedCalls = decision.kind === 'select' ? Math.max(1, decision.candidates.length * 8 * selected.autoVerifyRepeats) : Math.max(1, 4 * selected.autoVerifyRepeats);
            const reservation = autoRouter.reserve(agent, decision.kind, decision.fingerprint, expectedCalls, policy);
            if (reservation) {
                try {
                    const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                    if (decision.kind === 'compare') {
                        const result = await compareCandidates(agent, extracted.problem, decision.candidates[0].content, decision.candidates[1].content, selected.autoVerifyRepeats, signal, extracted.images);
                        if (!stillCurrent()) {
                            autoRouter.fail(agent, reservation, false);
                            return;
                        }
                        if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                            return;
                        const winner = result.winner === 'A' ? decision.candidates[0].label : result.winner === 'B' ? decision.candidates[1].label : 'tie';
                        agent.steer(routeFeedback(decision, 'Winner: ' + winner + '. Scores: ' + (result.scoreA * 100).toFixed(1) + '% / ' + (result.scoreB * 100).toFixed(1) + '%.'));
                        return;
                    }
                    if (decision.kind === 'select') {
                        const result = await selectCandidates(agent, extracted.problem, decision.candidates.map(candidate => candidate.content), selected.autoVerifyRepeats, signal, extracted.images);
                        if (!stillCurrent()) {
                            autoRouter.fail(agent, reservation, false);
                            return;
                        }
                        if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                            return;
                        const ranking = result.ranking.map((index, rank) => (rank + 1) + '. ' + decision.candidates[index].label).join('\n');
                        agent.steer(routeFeedback(decision, 'Ranking:\n' + ranking + '\nProceed with ' + decision.candidates[result.index].label + '.'));
                        return;
                    }
                    const result = await trackProgress(agent, extracted.problem, decision.steps, decision.checkpoints, selected.autoVerifyRepeats, signal, extracted.images);
                    if (!stillCurrent()) {
                        autoRouter.fail(agent, reservation, false);
                        return;
                    }
                    if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                        return;
                    const detail = result.scores.map((score, index) => 'Checkpoint step ' + decision.checkpoints[index] + ': ' + (score * 100).toFixed(1) + '%').join('\n');
                    const continuation = result.scores.some(score => score < selected.autoTrackCompletionThreshold) ? '\nContinue the unfinished work.' : '\nPrepare final delivery evidence; final session verification is mandatory.';
                    agent.steer(routeFeedback(decision, detail + continuation));
                    return;
                }
                catch (error) {
                    autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict');
                    ctx.logger.warn('llm-verifier automatic route failed: ' + (error instanceof Error ? error.message : String(error)));
                    if (selected.autoVerifyMode === 'strict' && !signal.aborted)
                        agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict routed verification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until it succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                    return;
                }
            }
        }
        const forcedFromSeq = autoRouter.finalRequired(agent);
        if (forcedFromSeq === undefined && !evidence.eligible) {
            if (selected.autoVerifyMode === 'strict' && autoRouter.strictBlocked(agent))
                agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict verification remains blocked. Produce new evidence or run a directly relevant verifier.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
            return;
        }
        const finalFromSeq = forcedFromSeq === undefined ? evidence.taskStartSeq : Math.min(evidence.taskStartSeq, forcedFromSeq);
        const finalFingerprint = stableHash({ phase: 'final', from: finalFromSeq, to: admittedLastSeq });
        const finalReservation = autoRouter.reserve(agent, 'final', finalFingerprint, Math.max(1, 4 * selected.autoVerifyRepeats), policy);
        if (!finalReservation) {
            if (selected.autoVerifyMode === 'strict' && (forcedFromSeq !== undefined || autoRouter.strictBlocked(agent)))
                agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification is required but its safety budget is exhausted or another verifier is active. Do not conclude; request operator review.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
            return;
        }
        try {
            const result = await verifySession(agent, { fromSeq: finalFromSeq, toSeq: admittedLastSeq, includeAssistantText: true, maxChars: selected.autoVerifyMaxChars, repeats: selected.autoVerifyRepeats }, signal);
            if (!stillCurrent()) {
                autoRouter.fail(agent, finalReservation, false);
                return;
            }
            const passed = result.winner === 'A' && result.score >= selected.autoVerifyThreshold;
            if (passed)
                autoRouter.commit(agent, finalReservation);
            else {
                autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict');
                agent.steer(createUserMessage({ content: [{ type: 'text', text: automaticFeedback(result.score, result.baselineScore, result.winner, selected.autoVerifyThreshold) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
            }
        }
        catch (error) {
            autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict');
            ctx.logger.warn('llm-verifier automatic final verification failed: ' + (error instanceof Error ? error.message : String(error)));
            if (selected.autoVerifyMode === 'strict' && !signal.aborted)
                agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification failed: ' + (error instanceof Error ? error.message : String(error)) + '\nDo not conclude until verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
        }
    });
    ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings, with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_compare', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.compare({ problem: args.problem, candidateA: args.candidate_a, candidateB: args.candidate_b, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), images: await images(args.images, exec.signal) }, exec.signal); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_select', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.select({ problem: args.problem, candidates: args.candidates, criteria: normalizeCriteria(args.criteria), repeats: positive(args.repeats, 2, 'repeats'), pivots: positive(args.pivots, 2, 'pivots'), seed: args.seed ?? 0, images: await images(args.images, exec.signal) }, exec.signal); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_track', agent, async () => { const { verifier, selected } = await engine(agent); const result = await verifier.track(args.problem, args.steps, args.checkpoints, positive(args.repeats, 2, 'repeats'), exec.signal, await images(args.images, exec.signal)); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true } } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars, repeats: args.repeats }, exec.signal); } }));
}
//# sourceMappingURL=index.js.map