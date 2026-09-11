import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Config, installVerifierSettings, resolveConfig } from "./config.js";
import { RequestLimiter, callVerifierText } from "./caller.js";
import { TopLogprobCapabilityCache, resolveCapabilityFile } from "./top-logprobs.js";
import { ScoreCache, SingleFlight, resolveCacheFile, stableHash } from "./cache.js";
import { VerifierEngine, normalizeCriteria } from "./engine.js";
import { loadVerifierImages } from "./images.js";
import { extractSession, sanitizeVerifierText, sessionEvents } from "./session.js";
import { analyzeAutoTask, automaticFeedback, isSubagentSession } from "./auto.js";
import { AutoVerifierRouter, analyzeStructuredRoute, boundDecision, buildSemanticRoutePrompt, estimateRoutedCalls, parseSemanticRoute, semanticDecision, semanticRouteHint } from "./router.js";
import { DEFAULT_CRITERIA } from "./core.js";
import { buildPlanPreReviewPrompt, parseVerdictLetter, planFromArguments } from "./plan-gate.js";
import { inspectTeamTasks, buildTeamTaskVerificationPrompt } from "./team-gate.js";
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
export * from "./plan-gate.js";
export * from "./team-gate.js";
export { callVerifier, RequestLimiter } from "./caller.js";
const criterionSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, description: { type: 'string', required: true } } };
const statsSchema = { type: 'object', additionalProperties: false, properties: { calls: { type: 'integer', required: true }, attempts: { type: 'integer', required: true }, retries: { type: 'integer', required: true }, inputTokens: { type: 'integer', required: true }, cachedInputTokens: { type: 'integer', required: true }, outputTokens: { type: 'integer', required: true }, reasoningTokens: { type: 'integer', required: true }, cacheHits: { type: 'integer', required: true }, cacheMisses: { type: 'integer', required: true }, estimatedCostUsd: { type: 'number', required: true }, topLogprobScores: { type: 'integer', required: true }, explicitTagScores: { type: 'integer', required: true } } };
const criterionResultSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true } } };
const commonParams = { criteria: { type: 'array', items: criterionSchema }, repeats: { type: 'integer' }, images: { type: 'array', items: { type: 'string' }, description: 'Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input.' } };
function renderJson(value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }]; }
function positive(value, fallback, field) { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error('llm-verifier: ' + field + ' must be a positive integer'); return result; }
function capped(value, fallback, maximum, field) { const result = positive(value, fallback, field); if (result > maximum)
    throw new Error('llm-verifier: ' + field + ' must be at most ' + maximum); return result; }
/** Hard ceilings for explicitly supplied evidence: the tools are model-driven, so they need their own bounds. */
const MAX_EXPLICIT_REPEATS = 8;
const MAX_TRACK_STEPS = 32;
const MAX_SESSION_CHARS = 2_000_000;
/**
 * Redact, bound and validate one batch of caller-supplied evidence strings.
 * @param values - raw tool arguments in order.
 * @param maxItemChars - per-item character cap after redaction.
 * @param maxTotalChars - combined character cap across all items.
 * @param field - argument name used in error messages.
 * @returns Sanitized evidence in the original order.
 */
function explicitEvidence(values, maxItemChars, maxTotalChars, field) {
    const items = values.map((value, index) => {
        if (typeof value !== 'string' || !value.trim())
            throw new Error('llm-verifier: ' + field + '[' + index + '] must be a non-empty string');
        return sanitizeVerifierText(value, maxItemChars);
    });
    const total = items.reduce((sum, item) => sum + item.length, 0);
    if (total > maxTotalChars)
        throw new Error('llm-verifier: ' + field + ' is ' + total + ' characters after redaction; keep the combined evidence under ' + maxTotalChars + ' characters');
    return items;
}
/**
 * Bounds for explicitly supplied evidence. The auto-routing knobs are reused as
 * a floor, never as a ceiling: tightening automatic routing must not silently
 * truncate a caller's explicit evidence, but the tools still need a hard bound.
 */
const EXPLICIT_MIN_ITEM_CHARS = 20_000;
const EXPLICIT_MIN_TOTAL_CHARS = 400_000;
const MAX_EXPLICIT_CANDIDATES = 16;
const MAX_EXPLICIT_PLANNED_CALLS = 500;
function explicitItemChars(selected) { return Math.max(selected.autoRouteMaxItemChars, EXPLICIT_MIN_ITEM_CHARS); }
function explicitBudget(selected) { return Math.max(selected.autoRouteMaxInputChars * 10, EXPLICIT_MIN_TOTAL_CHARS); }
function explicitCandidateLimit(selected) { return Math.max(selected.autoRouteMaxCandidates, MAX_EXPLICIT_CANDIDATES); }
/** Ring + pivot-round comparisons for an explicitly requested selection. */
function plannedComparisons(count) { return count <= 2 ? 1 : count + Math.max(0, (count - 2) * 2 + 1 - 3); }
function numberField(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function statsFrom(value) { if (typeof value !== 'object' || value === null || !('stats' in value))
    return emptyRunStats(); const source = value.stats; if (typeof source !== 'object' || source === null)
    return emptyRunStats(); const row = source; return { calls: numberField(row.calls, 0), attempts: numberField(row.attempts, 0), retries: numberField(row.retries, 0), inputTokens: numberField(row.inputTokens, 0), cachedInputTokens: numberField(row.cachedInputTokens, 0), outputTokens: numberField(row.outputTokens, 0), reasoningTokens: numberField(row.reasoningTokens, 0), cacheHits: numberField(row.cacheHits, 0), cacheMisses: numberField(row.cacheMisses, 0), estimatedCostUsd: numberField(row.estimatedCostUsd, 0), topLogprobScores: numberField(row.topLogprobScores, 0), explicitTagScores: numberField(row.explicitTagScores, 0) }; }
/**
 * One judge's contribution to a verdict.
 *
 * Only `provider`/`model`/`label`/`ok`/`calls` are always present: a judge that
 * failed a job carries no score, so every score field is optional and the engine
 * omits it instead of assigning undefined.
 */
const judgeScoreSchema = { type: 'object', additionalProperties: false, properties: { provider: { type: 'string', required: true }, model: { type: 'string', required: true }, label: { type: 'string', required: true }, ok: { type: 'boolean', required: true }, calls: { type: 'integer', required: true }, error: { type: 'string' }, scoreA: { type: 'number' }, scoreB: { type: 'number' }, winner: { type: 'string', enum: ['A', 'B', 'tie'] }, scores: { type: 'array', items: { type: 'number' } }, ranking: { type: 'array', items: { type: 'integer' } } } };
const judgesSchema = { type: 'array', items: judgeScoreSchema, required: true };
function rpcSuccess(value) { return { ok: true, value }; }
function rpcFailure(message) { return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }; }
export function apply(ctx, config = {}) {
    const services = ctx;
    const entry = resolveConfig(config);
    let limiter = new RequestLimiter(entry.maxConcurrency);
    const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency); });
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
        const topicEntry = topic(agent.session.header);
        // One client per configured judge: the judge identity is part of the scoring
        // cache key, so each judge caches and de-duplicates independently. `judges[0]`
        // is the primary, which keeps a single-judge configuration on exactly the old path.
        const clients = [];
        for (const judge of selected.judges) {
            await ctx.llm.resolveCallConfig({ provider: judge.provider, model: judge.model, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort } : {}), maxTokens: judge.maxTokens });
            clients.push({ ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities: topicEntry.capabilities, provider: judge.provider, model: judge.model, label: judge.label, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort } : {}), maxTokens: judge.maxTokens, timeoutMs: selected.timeoutMs, maxRetries: selected.maxRetries, retryBaseDelayMs: selected.retryBaseDelayMs, limiter });
        }
        return { verifier: new VerifierEngine(clients, selected.maxConcurrency, topicEntry.cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }, topicEntry.flights), selected };
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
        if (!extracted.problem.trim())
            throw new Error('llm-verifier: no direct user task found in the selected session range — widen from_seq so the task statement is included');
        const { verifier, selected } = await engine(agent);
        const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: '(No useful work or verification was performed.)', repeats: positive(options.repeats, 2, 'repeats'), images: extracted.images }, signal);
        const result = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats, judges: compared.judges, agreement: compared.agreement };
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
    const handleStatisticsQuery = async (payload) => {
        if (typeof payload !== 'object' || payload === null)
            return rpcFailure('statistics payload must be an object');
        const row = payload;
        const sessionId = typeof row.sessionId === 'string' && row.sessionId.length > 0 ? row.sessionId : undefined;
        const query = { fromMs: numberField(row.fromMs, Number.NaN), toMs: numberField(row.toMs, Number.NaN), timezoneOffsetMinutes: numberField(row.timezoneOffsetMinutes, 0), recentLimit: numberField(row.recentLimit, 40), ...(sessionId ? { sessionId } : {}) };
        try {
            const items = await services.sessionPersistence.list();
            const headers = items
                .map(item => item && typeof item === 'object' && 'header' in item ? item.header : item)
                .filter(header => header !== undefined && (sessionId === undefined || String(header.id) === sessionId));
            const settled = await Promise.allSettled(headers.map(async (header) => topic(header).statistics.overview(query)));
            const overviews = [];
            for (const result of settled) {
                if (result.status === 'fulfilled')
                    overviews.push(result.value);
                else
                    ctx.logger.warn('llm-verifier statistics: skipped one unreadable topic — ' + (result.reason instanceof Error ? result.reason.message : String(result.reason)));
            }
            const value = mergeStatisticsOverviews(overviews, query);
            return rpcSuccess(value);
        }
        catch (error) {
            return rpcFailure(error instanceof Error ? error.message : String(error));
        }
    };
    // 1. 优先注册到官方 /api 共享通道 (connection.fetch.register)
    const anyConn = services.connection;
    if (anyConn && anyConn.fetch && typeof anyConn.fetch.register === 'function') {
        try {
            anyConn.fetch.register({
                path: '/api/llm-verifier/statistics',
                methods: ['POST'],
                requestBody: 'buffered',
                fetch: async (request) => {
                    let body;
                    try {
                        body = await request.json();
                    }
                    catch {
                        return new Response('body is not JSON', { status: 400 });
                    }
                    const isRpcEnvelope = typeof body === 'object' && body !== null && body.type === 'client-request' && typeof body.rpcId === 'string';
                    const rpcId = isRpcEnvelope ? body.rpcId : 'direct';
                    const payload = isRpcEnvelope ? body.payload : body;
                    const outcome = await handleStatisticsQuery(payload);
                    if (isRpcEnvelope) {
                        return Response.json({
                            type: 'server-response',
                            rpcId,
                            result: outcome,
                        });
                    }
                    return Response.json(outcome);
                },
            });
        }
        catch (e) {
            ctx.logger.warn('failed to register /api/llm-verifier/statistics fetch route: ' + String(e));
        }
    }
    // 2. Fallback for hosts predating the exact Fetch route API: the same query over
    // the plugin's own RPC channel, which Connection guards with the Host/Origin
    // fence and browser authentication. Modern hosts answer on /api first.
    const legacyRpc = services.connection;
    if (typeof legacyRpc.rpc?.handle === 'function') {
        try {
            legacyRpc.rpc.handle('/llm-verifier', async (endpoint, payload) => {
                if (endpoint !== 'statistics')
                    return rpcFailure('unknown llm-verifier endpoint');
                return handleStatisticsQuery(payload);
            });
        }
        catch (e) {
            ctx.logger.warn('failed to register /llm-verifier rpc fallback: ' + String(e));
        }
    }
    ctx.on('agent/disposed', ({ agent }) => { autoRouter.release(agent); topics.delete(String(agent.id)); });
    // Plan pre-review: judge exit_plan_mode BEFORE the tool asks the human, so a
    // weak plan is sent back to the model instead of reaching the review dialog.
    ctx.on('tools/pre-execute', async (exec, next) => {
        const selected = current();
        if (!selected.enabled || selected.autoVerifyMode === 'manual' || !selected.autoVerifyPlanMode)
            return next();
        if (exec.name !== 'exit_plan_mode' || exec.agent === undefined || exec.signal.aborted)
            return next();
        if (!selected.autoVerifySubagents && isSubagentSession(exec.agent))
            return next();
        const plan = planFromArguments(exec.arguments);
        if (!plan)
            return next();
        const agent = exec.agent;
        const policy = routePolicy(selected);
        const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold });
        const planFingerprint = stableHash({ phase: 'plan_review', plan });
        const reservation = autoRouter.reserve(agent, 'plan_review', planFingerprint, 1, policy);
        if (reservation === undefined) {
            // Already reviewed, another verification is in flight, or the auto-verification
            // budget is spent. The plan still reaches the human: denying here would let an
            // exhausted budget deadlock plan mode, whose only exit is this very tool call.
            if (!autoRouter.completedFingerprint(agent, planFingerprint)) {
                ctx.logger.warn('llm-verifier plan pre-review skipped (verification in flight or auto-verification budget exhausted)');
            }
            return next();
        }
        try {
            const toSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1;
            const extracted = await extractTask(agent, evidence.taskStartSeq, toSeq, selected.autoVerifyMaxChars, exec.signal);
            const classified = await classifyRoute(agent, buildPlanPreReviewPrompt(extracted.problem, plan, selected.autoRouteMaxInputChars), exec.signal);
            const verdict = parseVerdictLetter(classified.text);
            if (verdict === undefined) {
                autoRouter.fail(agent, reservation, false);
                ctx.logger.warn('llm-verifier plan pre-review produced no verdict line; the plan was allowed through');
                return next();
            }
            if (verdict.score >= selected.autoVerifyThreshold) {
                autoRouter.commit(agent, reservation);
                return next();
            }
            autoRouter.fail(agent, reservation, selected.autoVerifyMode === 'strict');
            return {
                kind: 'deny',
                reason: '[Automatic Verifier Plan Pre-review] scored ' + (verdict.score * 100).toFixed(1) + '% against a ' + (selected.autoVerifyThreshold * 100).toFixed(0) + '% threshold.\n' + verdict.feedback.slice(0, 4000) + '\nRevise the plan to address these findings, then call exit_plan_mode again.',
            };
        }
        catch (error) {
            autoRouter.fail(agent, reservation, false);
            ctx.logger.warn('llm-verifier plan pre-review failed: ' + (error instanceof Error ? error.message : String(error)));
            return next();
        }
    });
    ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
        const selected = current();
        if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted)
            return;
        // Delegated child sessions are seeded with a real user message, so they would
        // otherwise be gated (and steered) as if they were the operator's own task.
        if (!selected.autoVerifySubagents && isSubagentSession(agent))
            return;
        const policy = routePolicy(selected);
        const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold });
        const admittedLastSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1;
        const snapshot = sessionEvents(agent.session).filter(event => event.seq <= admittedLastSeq);
        const stillCurrent = () => !signal.aborted && (sessionEvents(agent.session).at(-1)?.seq ?? -1) === admittedLastSeq;
        if (selected.autoVerifyTeamTasks) {
            const teamInspection = inspectTeamTasks(snapshot, evidence.taskStartSeq);
            // Every completion still pending in this turn, oldest first. A pass does not
            // keep the turn alive, so a task deferred to "the next turn-stopping" could
            // wait forever: verify the whole batch, with the router budget as the cap.
            for (const completed of teamInspection.completedTasks) {
                const task = completed.task;
                const taskReservation = autoRouter.reserve(agent, 'team_task', stableHash({ phase: 'team_task', taskId: task.id, status: task.status, seq: completed.seq }), 1, policy);
                if (taskReservation === undefined)
                    continue;
                try {
                    const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                    const prompt = buildTeamTaskVerificationPrompt(task, extracted.trace, selected.autoRouteMaxInputChars);
                    const classified = await classifyRoute(agent, prompt, signal);
                    if (!stillCurrent()) {
                        autoRouter.fail(agent, taskReservation, false);
                        return;
                    }
                    const verdict = parseVerdictLetter(classified.text);
                    if (verdict === undefined) {
                        autoRouter.fail(agent, taskReservation, false);
                        ctx.logger.warn('llm-verifier team task verification produced no verdict line; task ' + task.id + ' was not gated');
                        continue;
                    }
                    if (verdict.score >= selected.autoVerifyThreshold) {
                        autoRouter.commit(agent, taskReservation, admittedLastSeq);
                        continue;
                    }
                    autoRouter.fail(agent, taskReservation, selected.autoVerifyMode === 'strict');
                    agent.steer(createUserMessage({
                        content: [{
                                type: 'text',
                                text: '[Automatic Verifier Team Task Gate]\nTask "' + task.subject + '" (#' + task.id + ') verification scored ' + (verdict.score * 100).toFixed(1) + '% (Threshold: ' + (selected.autoVerifyThreshold * 100).toFixed(0) + '%).\n' + verdict.feedback + '\nProvide verified execution evidence or resolve remaining issues before completing the task.'
                            }],
                        source: { kind: 'plugin', plugin: 'dsh-llm-verifier', form: 'notice', summary: 'Team Task Gate Feedback' }
                    }));
                    return;
                }
                catch (error) {
                    autoRouter.fail(agent, taskReservation, selected.autoVerifyMode === 'strict');
                    ctx.logger.warn('llm-verifier team task verification failed: ' + (error instanceof Error ? error.message : String(error)));
                    if (selected.autoVerifyMode === 'strict' && !signal.aborted) {
                        agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic Verifier Team Task Gate]\nTask verification failed: ' + (error instanceof Error ? error.message : String(error)) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                        return;
                    }
                    continue;
                }
            }
        }
        let decision = boundDecision(analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars), policy);
        if (decision === undefined && selected.autoRouteSemantic && (selected.autoVerifyMode === 'strict' || semanticRouteHint(snapshot))) {
            const fingerprint = stableHash({ phase: 'semantic', from: evidence.taskStartSeq, to: admittedLastSeq, model: selected.provider + '/' + selected.model });
            const reservation = autoRouter.reserve(agent, 'semantic', fingerprint, 1, policy);
            if (reservation) {
                try {
                    const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                    const classified = await classifyRoute(agent, buildSemanticRoutePrompt(extracted.problem, snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars), signal);
                    if (!stillCurrent()) {
                        autoRouter.fail(agent, reservation, false);
                        return;
                    }
                    const parsed = parseSemanticRoute(classified.text, selected.autoRouteMaxCandidates);
                    if (!parsed)
                        throw new Error('semantic router returned invalid strict JSON');
                    decision = parsed.confidence >= selected.autoRouteMinConfidence ? boundDecision(semanticDecision(parsed, snapshot, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars), policy) : undefined;
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
            // Every judge scores every match, so the reservation has to cover the ensemble.
            const expectedCalls = estimateRoutedCalls(decision, selected.autoVerifyRepeats, DEFAULT_CRITERIA.length) * selected.judges.length;
            const reservation = autoRouter.reserve(agent, decision.kind, decision.fingerprint, expectedCalls, policy);
            if (reservation === undefined) {
                // A refused reservation used to drop the whole routed decision silently.
                const exhausted = autoRouter.budgetExhausted(agent, expectedCalls, policy);
                ctx.logger.warn('llm-verifier automatic ' + decision.kind + ' route skipped: ' + (exhausted ? 'the task/session budget cannot cover ' + expectedCalls + ' model calls' : 'another verifier is active or this decision already ran'));
                if (exhausted && selected.autoVerifyMode === 'strict' && autoRouter.claimExhaustedNotice(agent)) {
                    agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nA routed ' + decision.kind + ' check was skipped because the task/session model-call budget is exhausted. Do not conclude until directly relevant verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                    return;
                }
            }
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
            if (selected.autoVerifyMode === 'strict' && autoRouter.strictBlocked(agent)) {
                // Budget-exhausted states can never be cleared, so steering every stop
                // boundary would keep the turn open indefinitely. Notify once, then let
                // the turn close with a warning instead of spinning.
                if (autoRouter.claimExhaustedNotice(agent))
                    agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict verification remains blocked. Produce new evidence or run a directly relevant verifier.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                else
                    ctx.logger.warn('llm-verifier strict verification remains blocked but the notice was already delivered for this task; closing the turn');
            }
            return;
        }
        const finalFromSeq = forcedFromSeq === undefined ? evidence.taskStartSeq : Math.min(evidence.taskStartSeq, forcedFromSeq);
        const finalFingerprint = stableHash({ phase: 'final', from: finalFromSeq, to: admittedLastSeq });
        const finalReservation = autoRouter.reserve(agent, 'final', finalFingerprint, Math.max(1, 4 * selected.autoVerifyRepeats) * selected.judges.length, policy);
        if (!finalReservation) {
            // Same one-shot rule: a spent budget never grants another reservation, so
            // an unconditional steer here would livelock the turn.
            if (selected.autoVerifyMode === 'strict' && (forcedFromSeq !== undefined || autoRouter.strictBlocked(agent))) {
                if (autoRouter.claimExhaustedNotice(agent))
                    agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification is required but its safety budget is exhausted or another verifier is active. Do not conclude; request operator review.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                else
                    ctx.logger.warn('llm-verifier strict final verification remains unavailable (budget exhausted or another verifier active); closing the turn');
            }
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
    ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings (or the configured judge ensemble) with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_compare', agent, async () => { const { verifier, selected } = await engine(agent); const [problem, candidateA, candidateB] = explicitEvidence([args.problem, args.candidate_a, args.candidate_b], explicitItemChars(selected), explicitBudget(selected), 'compare input'); const result = await verifier.compare({ problem, candidateA, candidateB, criteria: normalizeCriteria(args.criteria), repeats: capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'), images: await images(args.images, exec.signal) }, exec.signal); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_select', agent, async () => { const { verifier, selected } = await engine(agent); const limit = explicitCandidateLimit(selected); if (args.candidates.length > limit)
            throw new Error('llm-verifier: candidates must contain at most ' + limit + ' entries'); const candidates = explicitEvidence(args.candidates, explicitItemChars(selected), explicitBudget(selected), 'candidates'); const criteria = normalizeCriteria(args.criteria); const repeats = capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'); const planned = plannedComparisons(candidates.length) * (criteria?.length || 3) * repeats; if (planned > MAX_EXPLICIT_PLANNED_CALLS)
            throw new Error('llm-verifier: this selection would issue about ' + planned + ' judge calls; reduce candidates or repeats'); const result = await verifier.select({ problem: sanitizeVerifierText(args.problem, explicitItemChars(selected)), candidates, criteria, repeats, pivots: capped(args.pivots, 2, Math.max(1, candidates.length), 'pivots'), seed: args.seed ?? 0, images: await images(args.images, exec.signal) }, exec.signal); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_track', agent, async () => { const { verifier, selected } = await engine(agent); if (args.steps.length > MAX_TRACK_STEPS)
            throw new Error('llm-verifier: steps must contain at most ' + MAX_TRACK_STEPS + ' entries'); const steps = explicitEvidence(args.steps, explicitItemChars(selected), explicitBudget(selected), 'steps'); const result = await verifier.track(sanitizeVerifierText(args.problem, explicitItemChars(selected)), steps, args.checkpoints, capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'), exec.signal, await images(args.images, exec.signal)); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars === undefined ? undefined : capped(args.max_chars, 200000, MAX_SESSION_CHARS, 'max_chars'), repeats: capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats') }, exec.signal); } }));
}
//# sourceMappingURL=index.js.map