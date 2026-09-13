import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Config, installVerifierSettings, resolveConfig } from "./config.js";
import { RequestLimiter, attachUsage, callVerifier, callVerifierText, generateCandidate, requestAttempts } from "./caller.js";
import { TopLogprobCapabilityCache, resolveCapabilityFile } from "./top-logprobs.js";
import { ScoreCache, SingleFlight, resolveCacheFile, stableHash } from "./cache.js";
import { VerifierEngine, mergeRunStats, normalizeCriteria, partialStats } from "./engine.js";
import { loadVerifierImages } from "./images.js";
import { extractSession, sanitizeVerifierText, sessionEvents } from "./session.js";
import { CriteriaResolver } from "./criteria.js";
import { analyzeAutoTask, automaticFeedback, compareRouteFeedbackDetail, failedAcceptanceCriteria, isSubagentSession, selectRouteFeedbackDetail, sessionAccepted, MAX_ROUTE_FEEDBACK_CHARS } from "./auto.js";
import { AutoVerifierRouter, analyzeStructuredRoute, boundDecision, buildSemanticRouteView, estimateRoutedCalls, inspectDeliveryPhase, inspectRecoverySignal, latestDirectUserSeq, nextDiagnosticCycleId, parseSemanticRoute, routedRepeats, semanticDecision, semanticReferencesVisible, semanticRouteHint } from "./router.js";
import { ProcessCycleStore, ProcessSelector, resolveProcessFile } from "./process-selection.js";
import { DEFAULT_GROUND_TRUTH_NOTE, EMPTY_WORK_BASELINE, PROPOSAL_CRITERIA, buildGenerationPrompt, buildPairwisePrompt, extractScore, renderDiagnostics, renderReferenceContext } from "./core.js";
import { buildPlanPreReviewPrompt, parseVerdictLetter, planFromArguments } from "./plan-gate.js";
import { inspectTeamTasks, buildTeamTaskVerificationPrompt } from "./team-gate.js";
import { StatisticsStore, emptyRunStats, errorDetails, mergeStatisticsOverviews, parseStatisticsQuery, resolveStatisticsFile, summarizeVerdict } from "./statistics.js";
import { resolveTopicDataDir } from "./topic-storage.js";
import { DecisionStore, boundDecisionCalls, resolveDecisionsFile } from "./decisions.js";
export const name = 'llm-verifier';
export const inject = ['tools', 'agents', 'attachments', 'llm', 'connection', 'sessionPersistence'];
export { Config };
export * from "./core.js";
export * from "./engine.js";
export * from "./cache.js";
export * from "./statistics.js";
export * from "./topic-storage.js";
export * from "./decisions.js";
export * from "./auto.js";
export * from "./router.js";
export * from "./plan-gate.js";
export * from "./team-gate.js";
export { callVerifier, RequestLimiter } from "./caller.js";
const criterionSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, description: { type: 'string', required: true } } };
const statsSchema = { type: 'object', additionalProperties: false, properties: { calls: { type: 'integer', required: true }, attempts: { type: 'integer', required: true }, retries: { type: 'integer', required: true }, inputTokens: { type: 'integer', required: true }, cachedInputTokens: { type: 'integer', required: true }, outputTokens: { type: 'integer', required: true }, reasoningTokens: { type: 'integer', required: true }, cacheHits: { type: 'integer', required: true }, cacheMisses: { type: 'integer', required: true }, estimatedCostUsd: { type: 'number', required: true }, topLogprobScores: { type: 'integer', required: true }, explicitTagScores: { type: 'integer', required: true }, usageIncomplete: { type: 'boolean' }, channelFallbacks: { type: 'integer' } } };
const criterionResultSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true } } };
/**
 * The per-criterion row `verifySession` reports: the compare engine's rows reduced to the
 * acceptance-facing `{id, name, score}` shape (`score` is compare's `scoreA`).
 *
 * Deliberately NOT {@link criterionResultSchema}: that one declares compare's `{scoreA, scoreB}`
 * rows, and the host rejects any key a tool's declared output schema does not mention — declaring
 * the wrong criterion shape here is exactly how the explicit session verifier broke.
 */
const acceptanceCriterionResultSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string' }, score: { type: 'number', required: true } } };
const commonParams = { criteria: { type: 'array', items: criterionSchema }, repeats: { type: 'integer' }, images: { type: 'array', items: { type: 'string' }, description: 'Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input.' } };
/**
 * Review stage an explicit compare/select declares.
 *
 * Omitted keeps the historical artifact semantics, so an existing caller's verdict, cache key and
 * routing de-duplication credential are unchanged. `proposal` means neither side has been executed.
 */
const reviewStageParam = { type: 'string', enum: ['proposal', 'artifact'], description: 'Which stage both sides are in. proposal: unexecuted plans/drafts, scored against the proposal rubric (goal/constraints, feasibility, verification design) when criteria is omitted, and never evidence that the task was completed. artifact (default): completed work with its observed output.' };
/**
 * One located finding (P04) as it appears in a tool result.
 *
 * `criterion`/`checkpoint` and `action` are optional on purpose: the verdict is valid without any
 * finding, and a finding whose target could not be verified was dropped rather than guessed.
 */
const diagnosticSchema = { type: 'object', additionalProperties: false, properties: { criterion: { type: 'string' }, checkpoint: { type: 'string' }, evidence: { type: 'string', required: true }, finding: { type: 'string', required: true }, action: { type: 'string' } } };
const diagnosticsSchema = { type: 'array', items: diagnosticSchema, required: true };
const reviewStageField = { type: 'string', required: true };
const criteriaSourceField = { type: 'string', required: true };
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
/**
 * Hard ceiling for the combined evidence of one explicit tool call. The previous
 * 600k ceiling could overflow the judge's context window before it compared
 * anything, so the cap is a fixed budget (~60k tokens) with an actionable error.
 */
const EXPLICIT_MAX_TOTAL_CHARS = 240_000;
const EXPLICIT_MIN_TOTAL_CHARS = 120_000;
const MAX_EXPLICIT_CANDIDATES = 16;
const MAX_EXPLICIT_PLANNED_CALLS = 500;
/**
 * Best-of-N bounds. The ceiling is 4 because cost grows ~linearly in N while the marginal
 * value of the 5th draft does not, and the tool is meant for a final deliverable rather than
 * routine work. The floor is 2 because "choose the best of one" is not a choice.
 */
/**
 * P06: one process-selection cycle per task.
 *
 * The shipped allowance is a single cycle by design. There is no private per-session process
 * counter: the router meters a process cycle against the SAME task/session route allowance as every
 * other routed decision (plan 8.1), so one task's cycle can never consume another task's.
 */
const MAX_PROCESS_PER_TASK = 1;
const MIN_BEST_OF_N = 2;
const MAX_BEST_OF_N = 4;
const DEFAULT_BEST_OF_N = 3;
function explicitItemChars(selected) { return Math.max(selected.autoRouteMaxItemChars, EXPLICIT_MIN_ITEM_CHARS); }
function explicitBudget(selected) { return Math.min(Math.max(selected.autoRouteMaxInputChars * 2, EXPLICIT_MIN_TOTAL_CHARS), EXPLICIT_MAX_TOTAL_CHARS); }
function explicitCandidateLimit(selected) { return Math.max(selected.autoRouteMaxCandidates, MAX_EXPLICIT_CANDIDATES); }
/**
 * Worst-case tournament pairs for a selection of `count` candidates.
 *
 * A hard upper bound, not an estimate: ring (N) plus every pivot-round pair (non-pivots x
 * pivots, plus pivot-vs-pivot). De-duplicating against the ring can only ever remove
 * pairs, so this never under-counts — which matters because both best-of-N and the
 * explicit select guard must reject before any model request is issued.
 * @param count - candidate count.
 * @param pivots - pivot count the tournament will run with.
 * @returns The largest number of pairs the tournament can judge.
 */
function selectComparisonsUpperBound(count, pivots = 2) {
    if (count <= 2)
        return 1;
    // Ring edges plus every pivot-round pair, WITHOUT discounting the ring/pivot overlap.
    // The engine drops those duplicates, so this is a true upper bound for any pivot
    // count; the old two-pivot formula under-counted an explicit selection with more.
    const pivotCount = Math.max(0, Math.min(pivots, count));
    return count + (count - pivotCount) * pivotCount + (pivotCount * (pivotCount - 1)) / 2;
}
function numberField(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function statsFrom(value) {
    if (typeof value !== 'object' || value === null || !('stats' in value))
        return emptyRunStats();
    const source = value.stats;
    if (typeof source !== 'object' || source === null)
        return emptyRunStats();
    const row = source;
    const stats = { calls: numberField(row.calls, 0), attempts: numberField(row.attempts, 0), retries: numberField(row.retries, 0), inputTokens: numberField(row.inputTokens, 0), cachedInputTokens: numberField(row.cachedInputTokens, 0), outputTokens: numberField(row.outputTokens, 0), reasoningTokens: numberField(row.reasoningTokens, 0), cacheHits: numberField(row.cacheHits, 0), cacheMisses: numberField(row.cacheMisses, 0), estimatedCostUsd: numberField(row.estimatedCostUsd, 0), topLogprobScores: numberField(row.topLogprobScores, 0), explicitTagScores: numberField(row.explicitTagScores, 0) };
    // Optional diagnostics: carried into the statistics row so "unknown usage" is visible
    // instead of being silently averaged in as a free call.
    if (row.usageIncomplete === true)
        stats.usageIncomplete = true;
    const fallbacks = numberField(row.channelFallbacks, 0);
    if (fallbacks > 0)
        stats.channelFallbacks = fallbacks;
    return stats;
}
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
/**
 * Small but real pair for the settings-page probe.
 *
 * The probe asks each judge for an actual A–T verdict instead of a "ping": that is what proves
 * the response PARSES, which is the failure a reachability check misses. A pair where one side is
 * obviously better keeps the exercise honest without making the expected score a secret.
 */
const PROBE_TASK = 'Fix the failing parser test and prove it passes.';
const PROBE_A = 'Ran the test: 1 failed. Patched the separator handling. Ran it again: 1 passed, no other failures.';
const PROBE_B = 'The test should pass now.';
/** Bound the probe: a diagnostics button must not sit on the configured 5-minute timeout plus retries. */
const PROBE_TIMEOUT_MS = 30000;
export function apply(ctx, config = {}) {
    const services = ctx;
    const entry = resolveConfig(config);
    let limiter = new RequestLimiter(entry.maxConcurrency);
    // A settings change invalidates every unconsumed P06 intent; the selector is created later in
    // this closure, so the callback goes through a holder instead of capturing a TDZ binding.
    let clearProcessIntents = () => { };
    const current = installVerifierSettings(ctx, entry, () => { limiter = new RequestLimiter(current().maxConcurrency); clearProcessIntents(); });
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
        const created = { dataDir, cache: new ScoreCache(cacheFile, selected.cacheMaxEntries), capabilities: new TopLogprobCapabilityCache(resolveCapabilityFile(dataDir)), flights: new SingleFlight(), statistics: new StatisticsStore(resolveStatisticsFile(cacheFile)), decisions: new DecisionStore(resolveDecisionsFile(cacheFile)), process: new ProcessCycleStore(resolveProcessFile(cacheFile)) };
        topics.set(id, created);
        return created;
    };
    const requireAgent = (agent) => {
        const selected = agent ?? ctx.agents.currentInitiator();
        if (selected === undefined)
            throw new Error('llm-verifier: verifier tools require an agent-owned topic so their data can follow topic deletion');
        return selected;
    };
    // The configured rubric (preset, or a markdown file) is the one every automatic decision and
    // every explicit tool without its own `criteria` argument scores with. Resolved through a
    // cache so an unchanged file costs one read per boundary, and a broken file degrades to the
    // coding preset instead of disabling the gate.
    const criteriaResolver = new CriteriaResolver();
    const configuredCriteria = () => criteriaResolver.resolve(current().criteriaPreset, current().criteriaFile);
    /**
     * Which review stage an explicit call declared.
     *
     * Omitted keeps the historical artifact semantics, so an existing caller's verdict, cache key
     * and routing de-duplication credential are byte-identical. An unknown value is refused rather
     * than silently treated as an artifact: the caller must know what it was scored against.
     * @param value - the `review_stage` argument.
     * @returns The resolved stage.
     */
    const parseReviewStage = (value) => {
        if (value === undefined || value === 'artifact')
            return 'artifact';
        if (value === 'proposal')
            return 'proposal';
        throw new Error('llm-verifier: review_stage must be proposal or artifact');
    };
    /**
     * The rubric one compare/select actually scores with.
     *
     * An explicit `criteria` always wins (the caller keeps control). Otherwise the stage picks the
     * default: `proposal` scores with the narrow proposal rubric, `artifact` with the configured
     * one. The resolved source is reported in the verdict so a caller can always tell what it was
     * judged against, instead of having to infer it from a score.
     * @param stage - the resolved review stage.
     * @param criteriaInput - the caller's `criteria` argument, if any.
     * @returns The rubric plus its reported source.
     */
    const stageRubric = async (stage, criteriaInput) => {
        if (criteriaInput !== undefined)
            return { criteria: normalizeCriteria(criteriaInput), source: 'explicit' };
        if (stage === 'proposal')
            return { criteria: PROPOSAL_CRITERIA, source: 'proposal' };
        return configuredCriteria();
    };
    /**
     * Task domain the prompt's role sentence names, taken from the rubric that was resolved.
     *
     * `coding` and the unknown-domain sources (`custom`/`fallback`) keep the historical wording;
     * a research/writing/ops rubric no longer tells the judge it is reading a coding trajectory.
     * @param rubric - the rubric in effect.
     * @returns The domain string to forward to the prompt builder.
     */
    const rubricDomain = (rubric) => rubric.source;
    /**
     * Every known topic header, newest first.
     *
     * The statistics and decision dashboards merge all topics; anything that needs exactly ONE
     * topic (the judge probe's per-topic capability memory) takes the newest, because that is where
     * the operator's current work lives. Legacy backends handed back the header directly instead of
     * wrapping it in \`{ header }`, so both shapes are accepted.
     * @returns Session headers, newest first; entries without an id are dropped.
     */
    const sessionHeaders = async () => {
        const items = await services.sessionPersistence.list();
        return items
            .map(item => item && typeof item === 'object' && 'header' in item ? item.header : item)
            .filter(header => header !== undefined && header.id !== undefined)
            .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    };
    /**
     * Build the judge ensemble for one topic.
     *
     * Takes a session header rather than an Agent because the judge probe is started from the global
     * statistics dashboard, where there is no current initiator. The diagnostic still needs a topic
     * for the per-topic capability memory, so it attaches to the most recent one (see handleProbe).
     * @param header - session header owning the topic whose sidecars the judges use.
     * @returns The engine plus the resolved configuration it was built from.
     */
    const engineForHeader = async (header) => {
        const selected = current();
        const topicEntry = topic(header);
        // One client per configured judge: the judge identity is part of the scoring
        // cache key, so each judge caches and de-duplicates independently. `judges[0]`
        // is the primary, which keeps a single-judge configuration on exactly the old path.
        const clients = [];
        for (const judge of selected.judges) {
            await ctx.llm.resolveCallConfig({ provider: judge.provider, model: judge.model, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort } : {}), maxTokens: judge.maxTokens });
            clients.push({ ctx, llm: ctx.llm, attachments: services.attachments, topLogprobCapabilities: topicEntry.capabilities, provider: judge.provider, model: judge.model, temperature: selected.temperature, label: judge.label, ...(judge.reasoningEffort ? { reasoningEffort: judge.reasoningEffort } : {}), maxTokens: judge.maxTokens, timeoutMs: selected.timeoutMs, maxRetries: selected.maxRetries, retryBaseDelayMs: selected.retryBaseDelayMs, limiter });
        }
        return { verifier: new VerifierEngine(clients, selected.maxConcurrency, topicEntry.cache, { input: selected.estimatedInputUsdPerMillion, output: selected.estimatedOutputUsdPerMillion }, topicEntry.flights), selected };
    };
    const engine = async (agent) => engineForHeader(agent.session.header);
    const images = (values, signal) => loadVerifierImages(values, signal);
    const route = (selected) => ({ provider: selected.provider, model: selected.model });
    const requireEnabled = () => { if (!current().enabled)
        throw new Error('llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier'); };
    const verdictFrom = (toolName, value, phase) => {
        const selected = current();
        return summarizeVerdict(toolName, value, phase, {
            autoVerifyThreshold: selected.autoVerifyThreshold,
            autoTrackCompletionThreshold: selected.autoTrackCompletionThreshold,
        });
    };
    const record = async (toolName, agent, operation, phase = 'explicit', observation) => {
        const startedAt = Date.now();
        let selected = current();
        const topicEntry = topic(agent.session.header);
        const statistics = topicEntry.statistics;
        // Every real model call is captured here, so the dashboard can answer "why did the
        // judge say that" from the exact prompt and raw answer instead of a replay. Calls
        // are bounded twice (per call, per record) before anything reaches the disk.
        const capture = current().captureDecisions;
        const calls = [];
        const trace = capture ? call => { calls.push(call); } : undefined;
        try {
            const completed = await operation(trace);
            selected = completed.selected;
            const value = { ...completed.result, ...route(selected) };
            await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: true, provider: selected.provider, model: selected.model, stats: statsFrom(value), verdict: verdictFrom(toolName, value, phase), ...(observation ? { route: observation } : {}) }).catch(() => { });
            // Order by label before storing: the engine reports calls as they complete, so a concurrent
            // fan-out reports them in network order. Sorting makes "which calls are in the snapshot"
            // reproducible even when the record has to bound its text.
            if (calls.length > 0)
                await topicEntry.decisions.record({ toolName, phase, startedAt, provider: selected.provider, model: selected.model, calls: boundDecisionCalls([...calls].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))) }).catch(() => { });
            return value;
        }
        catch (error) {
            const details = errorDetails(error);
            // A request that failed before returning usage leaves the tokens UNKNOWN. Everything the
            // engine already spent before the failure (partialStats) and the attempts the failing
            // request made are both kept, and the row is marked incomplete instead of being reported
            // as a confident zero-cost call. The partial already includes the failing request's own
            // attempts, so they are never added twice.
            const partial = partialStats(error);
            const attempts = requestAttempts(error);
            const failedStats = partial === undefined
                ? (attempts > 0 ? { ...emptyRunStats(), attempts, retries: Math.max(0, attempts - 1), usageIncomplete: true } : emptyRunStats())
                : { ...partial, usageIncomplete: true };
            await statistics.record({ toolName, sessionId: String(agent.id), startedAt, success: false, ...details, provider: selected.provider, model: selected.model, stats: failedStats, verdict: { phase, outcome: 'error' }, ...(observation ? { route: failedStats.usageIncomplete === true ? { ...observation, usageIncomplete: true } : observation } : {}) }).catch(() => { });
            throw error;
        }
    };
    /** The registered tool each routable decision kind maps to. */
    const ROUTED_TOOL_BY_KIND = { compare: 'verifier_compare', select: 'verifier_select', track: 'verifier_track' };
    /**
     * Record a routed decision the plugin built but could not execute.
     *
     * A decision rejected by the evidence caps (or one whose semantic references
     * disappeared) used to vanish without a trace: the dashboard showed a task that
     * was never verified and gave no reason why. Nothing failed here — no model call
     * was made — so the row is a successful invocation carrying an explanatory verdict.
     * @param agent - Agent whose task produced the decision.
     * @param kind - The routed decision kind that was dropped.
     * @param phase - Routing phase that produced it (structured | semantic).
     * @param outcome - Why it was dropped.
     */
    const recordSkippedRoute = async (agent, kind, phase, outcome, observation) => {
        const selected = current();
        await topic(agent.session.header).statistics.record({
            toolName: kind === 'none' ? 'verifier_route_classify' : kind === 'final' ? 'verifier_current_session' : ROUTED_TOOL_BY_KIND[kind],
            sessionId: String(agent.id),
            startedAt: Date.now(),
            success: true,
            provider: selected.provider,
            model: selected.model,
            stats: emptyRunStats(),
            verdict: { phase, outcome },
            ...(observation ? { route: observation } : {}),
        }).catch(() => { });
    };
    /**
     * Route cycles that never reached a reservation still need an id for the observation.
     *
     * Deliberately NOT the router's reservation serial: these rows carry no model call and a
     * shared id namespace would let a reader mistake a diagnostic row for a purchased cycle.
     */
    const nextCycleId = nextDiagnosticCycleId;
    /**
     * Evidence-budget numbers of one bounded routing view.
     *
     * Kept next to the view so a routing change caused by truncation can be told apart from a
     * routing change caused by the model: the plan's S05-A asks for exactly that comparison.
     * @param view - the bounded semantic view that was rendered.
     * @returns The kept/omitted/character counts to store on the observation.
     */
    const viewObservation = (view) => ({
        evidenceKept: view.candidateCallIds.size + view.checkpointSeqs.size,
        evidenceOmitted: view.omitted,
        evidenceChars: view.evidenceChars,
    });
    const verifySession = async (agent, options, signal, phase = 'explicit', rubricOverride, observation) => record('verifier_current_session', agent, async (trace) => {
        const extracted = await extractSession(agent, async (ref) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType }; }, { fromSeq: options.fromSeq, toSeq: options.toSeq, includeAssistantText: options.includeAssistantText, redactPatterns: options.redactPatterns, maxChars: options.maxChars });
        if (!extracted.problem.trim())
            throw new Error('llm-verifier: no direct user task found in the selected session range — widen from_seq so the task statement is included');
        const { verifier, selected } = await engine(agent);
        const rubric = rubricOverride ?? await configuredCriteria();
        const repeats = positive(options.repeats, 2, 'repeats');
        // An EXPLICIT call needs its own ceiling: the tool is model-driven, so a large rubric
        // times repeats times judges could spend thousands of calls before returning anything.
        // The automatic final gate is already metered by the route policy, so it is exempt.
        if (phase === 'explicit') {
            const planned = rubric.criteria.length * repeats * selected.judges.length;
            if (planned > MAX_EXPLICIT_PLANNED_CALLS)
                throw new Error('llm-verifier: this session verification would issue about ' + planned + ' judge calls; reduce repeats, criteria or judges');
        }
        const compared = await verifier.compare({ problem: extracted.problem, candidateA: extracted.trace, candidateB: EMPTY_WORK_BASELINE, criteria: rubric.criteria, ...(rubric.groundTruthNote ? { groundTruthNote: rubric.groundTruthNote } : {}), repeats, images: extracted.images, ...(trace ? { trace } : {}) }, signal);
        const result = { sessionId: extracted.sessionId, problem: extracted.problem, score: compared.scoreA, baselineScore: compared.scoreB, winner: compared.winner, criteria: compared.criteria.map(row => ({ id: row.id, name: row.name, score: row.scoreA })), diagnostics: compared.diagnostics, fromSeq: extracted.fromSeq, toSeq: extracted.toSeq, omittedCharacters: extracted.omittedCharacters, calls: compared.calls, stats: compared.stats, judges: compared.judges, agreement: compared.agreement };
        return { result, selected };
    }, phase, observation);
    const compareCandidates = async (agent, problem, candidateA, candidateB, repeats, signal, rubric, routedImages = [], phase = 'explicit', observation, reviewStage = 'artifact') => record('verifier_compare', agent, async (trace) => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.compare({ problem, candidateA, candidateB, criteria: rubric.criteria, ...(rubric.groundTruthNote ? { groundTruthNote: rubric.groundTruthNote } : {}), repeats, reviewStage, domain: rubric.source, images: routedImages, ...(trace ? { trace } : {}) }, signal), selected };
    }, phase, observation);
    const selectCandidates = async (agent, problem, candidates, repeats, signal, rubric, routedImages = [], phase = 'explicit', observation, reviewStage = 'artifact') => record('verifier_select', agent, async (trace) => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.select({ problem, candidates, criteria: rubric.criteria, ...(rubric.groundTruthNote ? { groundTruthNote: rubric.groundTruthNote } : {}), repeats, pivots: Math.min(2, candidates.length), seed: 0, reviewStage, domain: rubric.source, images: routedImages, ...(trace ? { trace } : {}) }, signal), selected };
    }, phase, observation);
    const trackProgress = async (agent, problem, steps, checkpoints, repeats, signal, routedImages = [], phase = 'explicit', observation) => record('verifier_track', agent, async (trace) => {
        const { verifier, selected } = await engine(agent);
        return { result: await verifier.track(problem, steps, checkpoints, repeats, signal, routedImages, trace), selected };
    }, phase, observation);
    /**
     * Explicit best-of-N: draft N candidates with the session model, rank them with the
     * configured judges, then re-measure the winner against the gate's own baseline.
     *
     * The tournament's `scores` are relative preference shares (wins/counts) and cannot be
     * compared with `autoVerifyThreshold`; only the extra winner-vs-baseline comparison produces
     * an absolute score in the gate's units. That comparison is why this tool exists instead of
     * "generate candidates yourself and call verifier_select".
     *
     * Fail-closed by construction: fewer than {@link MIN_BEST_OF_N} surviving drafts is an error
     * that names every failure, never a silent "best" picked out of a single survivor.
     * @param agent - Agent owning the topic, and the session whose model writes the drafts.
     * @param task - the request the drafts answer.
     * @param count - how many drafts to request ({@link MIN_BEST_OF_N}..{@link MAX_BEST_OF_N}).
     * @param repeats - caller's repeat count, or undefined for the default; used by both the
     *   tournament and the baseline comparison.
     * @param signal - tool-call abort signal.
     * @param criteriaInput - caller-supplied criteria, or undefined for the configured rubric.
     */
    const bestOfN = async (agent, task, count, repeats, signal, criteriaInput, contextInput) => record('verifier_best_of_n', agent, async (trace) => {
        const { verifier, selected } = await engine(agent);
        if (!Number.isSafeInteger(count) || count < MIN_BEST_OF_N || count > MAX_BEST_OF_N)
            throw new Error('llm-verifier: n must be an integer between ' + MIN_BEST_OF_N + ' and ' + MAX_BEST_OF_N);
        const rounds = capped(repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats');
        // The two comparisons answer different questions, so by default they use different rubrics:
        // the drafts are UNEXECUTED text, so ranking them with the artifact rubric ("compare the final
        // verification command's stdout/stderr") fails every draft by construction. Ranking therefore
        // defaults to the proposal rubric, while the winner-vs-baseline measurement keeps the
        // configured DELIVERY rubric — that step predicts the gate and must not be weakened. An
        // explicit `criteria` still controls both, exactly as before.
        const rankingRubric = criteriaInput === undefined ? { criteria: PROPOSAL_CRITERIA, source: 'proposal' } : { criteria: normalizeCriteria(criteriaInput), source: 'explicit' };
        const baselineRubric = criteriaInput === undefined ? await configuredCriteria() : rankingRubric;
        // Bound the plan before spending the generation: with repeats and an ensemble this tool can
        // reach the shared explicit ceiling, and an unbounded custom rubric would blow past it. The
        // two phases are counted separately instead of assuming their rubrics are the same size.
        const planned = (selectComparisonsUpperBound(count) * rankingRubric.criteria.length + baselineRubric.criteria.length) * rounds * selected.judges.length;
        if (planned > MAX_EXPLICIT_PLANNED_CALLS)
            throw new Error('llm-verifier: best-of-n with n=' + count + ' would issue about ' + planned + ' judge calls; reduce n, repeats, criteria or judges');
        // The drafting model is the session's OWN model, read from the logged request header: no new
        // configuration, and the drafts come from exactly the model the task is being done with.
        const call = agent.session.requestHeader()?.config;
        if (call === undefined)
            throw new Error('llm-verifier: this session has no logged request header yet, so best-of-n cannot tell which model should write the drafts — generate candidates with parallel subagents and rank them with verifier_select instead');
        const target = { provider: call.provider, model: call.model, ...(call.reasoningEffort === undefined ? {} : { reasoningEffort: String(call.reasoningEffort) }) };
        // The task and the optional reference context share ONE explicit budget, each with its own item
        // cap, so a huge context cannot push the combined request past the documented ceiling.
        const contextRaw = typeof contextInput === 'string' ? contextInput : undefined;
        const bounded = explicitEvidence([task, ...(contextRaw?.trim() ? [contextRaw] : [])], explicitItemChars(selected), explicitBudget(selected), 'task');
        const problem = bounded[0];
        const referenceContext = bounded[1];
        // Both judge comparisons read the same block the drafts were given; appending it to the problem
        // is what makes "same context everywhere" true rather than aspirational.
        const judgedProblem = referenceContext === undefined ? problem : problem + '\n\n' + renderReferenceContext(problem, referenceContext);
        // N independent drafts, in parallel. A failure is captured per draft so the error below can
        // name it; a draft that fails is never substituted with another one.
        // Accumulated from the first generation call onward, so a failure in ANY phase (a draft, the
        // tournament, the baseline comparison) carries everything already spent instead of zero.
        const generation = emptyRunStats();
        let unknownDrafts = 0;
        const finishGeneration = () => {
            generation.estimatedCostUsd = ((generation.inputTokens + generation.cachedInputTokens) * selected.estimatedInputUsdPerMillion + generation.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000;
            return generation;
        };
        const failWithUsage = (error) => {
            attachUsage(error, finishGeneration());
            throw error;
        };
        const attempts = await Promise.all(Array.from({ length: count }, async (_unused, index) => {
            const prompt = buildGenerationPrompt(problem, index, count, referenceContext);
            try {
                const completion = await generateCandidate(verifier.client, target, prompt, signal);
                trace?.({ label: 'draft ' + (index + 1), channel: completion.scoringMode, prompt, output: completion.text });
                return { ok: true, text: completion.text, usage: completion.usage, truncated: completion.truncated };
            }
            catch (error) {
                // Carry the error OBJECT (not just its message): the retry chain folds every attempt's
                // tokens and attempt count into it, and a response-less failure still knows its attempts.
                return { ok: false, message: error instanceof Error ? error.message : String(error), billed: partialStats(error), attempts: requestAttempts(error) };
            }
        }));
        const survivors = [];
        const failures = [];
        attempts.forEach((attempt, index) => {
            if (attempt.ok) {
                survivors.push({ attempt: index + 1, text: attempt.text, usage: attempt.usage, truncated: attempt.truncated });
                // mergeRunStats (not addUsage) so a survivor whose earlier retry attempt lost its usage
                // keeps the usageIncomplete flag it carries.
                mergeRunStats(generation, attempt.usage);
            }
            else {
                failures.push('draft ' + (index + 1) + ': ' + attempt.message);
                if (attempt.billed !== undefined)
                    mergeRunStats(generation, attempt.billed);
                else {
                    // No usage carrier at all: the attempt count the transport knows about still counts.
                    generation.attempts += attempt.attempts;
                    generation.retries += Math.max(0, attempt.attempts - 1);
                }
                // A draft whose tokens never came back makes the total a floor, not a measurement.
                if (attempt.billed === undefined || attempt.billed.usageIncomplete === true)
                    unknownDrafts += 1;
            }
        });
        if (survivors.length < MIN_BEST_OF_N)
            failWithUsage(new Error('llm-verifier: best-of-n produced ' + survivors.length + ' usable draft(s) out of ' + count + '; at least ' + MIN_BEST_OF_N + ' are required to choose between them' + (failures.length === 0 ? '' : ' — ' + failures.join('; '))));
        let ranked;
        try {
            ranked = await verifier.select({ problem: judgedProblem, candidates: survivors.map(survivor => survivor.text), criteria: rankingRubric.criteria, ...(rankingRubric.groundTruthNote ? { groundTruthNote: rankingRubric.groundTruthNote } : {}), repeats: rounds, pivots: Math.min(2, survivors.length), seed: 0, reviewStage: 'proposal', domain: rankingRubric.source, ...(trace ? { trace } : {}) }, signal);
        }
        catch (error) {
            // The drafts are already paid for; a tournament failure must not hide them.
            mergeRunStats(generation, partialStats(error));
            attachUsage(error, finishGeneration());
            throw error;
        }
        mergeRunStats(generation, ranked.stats);
        // The absolute, gate-comparable measurement. Same fixed baseline, same threshold rule as the
        // automatic final acceptance, so "passes" here means the same thing it means at the gate.
        // The label prefix keeps the snapshot readable: this compare reuses the same criteria as the
        // tournament above, so without it two different comparisons share one set of labels.
        let compared;
        try {
            compared = await verifier.compare({ problem: judgedProblem, candidateA: ranked.best, candidateB: EMPTY_WORK_BASELINE, criteria: baselineRubric.criteria, traceLabelPrefix: 'baseline: ', reviewStage: 'artifact', domain: baselineRubric.source, ...(baselineRubric.groundTruthNote ? { groundTruthNote: baselineRubric.groundTruthNote } : {}), repeats: rounds, ...(trace ? { trace } : {}) }, signal);
        }
        catch (error) {
            // Baseline scoring failed: keep the generation AND tournament usage that preceded it.
            mergeRunStats(generation, partialStats(error));
            attachUsage(error, finishGeneration());
            throw error;
        }
        mergeRunStats(generation, compared.stats);
        const criteria = compared.criteria.map(row => ({ id: row.id, name: row.name, score: row.scoreA }));
        const threshold = selected.autoVerifyThreshold;
        const passesThreshold = sessionAccepted({ score: compared.scoreA, winner: compared.winner, criteria }, threshold);
        // One cost line for the whole invocation, generation included: the drafts are real tokens the
        // operator paid for even though no judge scored them. Their price is estimated with the
        // configured verifier table (the only one the plugin has), which the README states.
        const stats = finishGeneration();
        if (unknownDrafts > 0)
            stats.usageIncomplete = true;
        const result = {
            best: ranked.best,
            index: ranked.index,
            /**
             * The drafts are text this tool generated; it never executed or tested them.
             *
             * Reported explicitly so a caller cannot read the tournament ranking as evidence that the
             * winning draft was verified — only `score`/`passesThreshold` (from the baseline
             * comparison) carry the gate's meaning.
             */
            rankingStage: 'proposal',
            rankingCriteriaSource: rankingRubric.source,
            rankingCriteriaCount: rankingRubric.criteria.length,
            baselineCriteriaSource: baselineRubric.source,
            baselineCriteriaCount: baselineRubric.criteria.length,
            /** Whether the optional reference context was supplied and therefore seen by every call. */
            contextIncluded: referenceContext !== undefined,
            /** 1-based draft numbers of the survivors, in `scores`/`ranking` order. */
            sources: survivors.map(survivor => survivor.attempt),
            scores: ranked.scores,
            ranking: ranked.ranking,
            comparisons: ranked.comparisons,
            pivots: ranked.pivots,
            generated: survivors.length,
            failed: failures.length,
            failures,
            /** 1-based draft numbers still truncated after their escalated retry; empty is the normal case. */
            truncated: survivors.filter(survivor => survivor.truncated).map(survivor => survivor.attempt),
            score: compared.scoreA,
            baselineScore: compared.scoreB,
            winner: compared.winner,
            criteria: compared.criteria,
            threshold,
            passesThreshold,
            failedCriteria: failedAcceptanceCriteria(criteria, threshold).map(criterion => criterion.id),
            calls: stats.calls,
            stats,
            generatorProvider: target.provider,
            generatorModel: target.model,
            // Every judge call of this invocation, not just the tournament's: the winner-vs-baseline
            // comparison runs on the same clients, and the top-level call count already includes it.
            // `ok` therefore covers both comparisons while `scores`/`ranking` stay tournament-shaped.
            judges: ranked.judges.map((judge, index) => {
                const baseline = compared.judges[index];
                if (baseline === undefined)
                    return judge;
                return {
                    ...judge,
                    ok: judge.ok && baseline.ok,
                    calls: judge.calls + baseline.calls,
                    ...(judge.error === undefined && baseline.error !== undefined ? { error: baseline.error } : {}),
                };
            }),
        };
        return { result, selected };
    });
    const classifyRoute = async (agent, prompt, signal, phase, observation) => record('verifier_route_classify', agent, async (trace) => {
        const { verifier, selected } = await engine(agent);
        const completion = await callVerifierText(verifier.client, prompt, signal);
        trace?.({ label: 'route classify', channel: completion.scoringMode, prompt, output: completion.text });
        const stats = { ...completion.usage, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: ((completion.usage.inputTokens + completion.usage.cachedInputTokens) * selected.estimatedInputUsdPerMillion + completion.usage.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000, topLogprobScores: 0, explicitTagScores: 1 };
        return { result: { text: completion.text, stats }, selected };
    }, phase, observation);
    const extractTask = async (agent, fromSeq, toSeq, maxChars, signal) => extractSession(agent, async (ref) => { const stored = await services.attachments.readImage(ref, signal); return { data: stored.data, mediaType: stored.ref.mediaType }; }, { fromSeq, toSeq, includeAssistantText: true, maxChars });
    const routePolicy = (selected, minFinalModelCalls) => ({ mode: selected.autoVerifyMode, minConfidence: selected.autoRouteMinConfidence, maxCandidates: selected.autoRouteMaxCandidates, maxRoutePerTask: selected.autoRouteMaxPerTask, maxRoutePerSession: selected.autoRouteMaxPerSession, maxFinalPerTask: selected.autoVerifyMaxPerTask, maxFinalPerSession: selected.autoVerifyMaxPerSession, maxModelCallsPerTask: selected.autoMaxModelCallsPerTask, maxModelCallsPerSession: selected.autoMaxModelCallsPerSession, maxInputChars: selected.autoRouteMaxInputChars, maxItemChars: selected.autoRouteMaxItemChars, minFinalModelCalls, maxProcessPerTask: MAX_PROCESS_PER_TASK });
    /**
     * The policy one process-selection cycle is admitted under.
     *
     * Deliberately built from the SAME resolver as every other route, so the mandatory final
     * acceptance keeps its floor and the process cycle can never spend it.
     */
    const processPolicy = async () => routePolicy(current(), (await configuredCriteria()).criteria.length * current().autoVerifyFinalRepeats * current().judges.length);
    /** One candidate's locator for automatic feedback: label plus identity/event position, never its text. */
    const candidateRef = (candidate) => ({ label: candidate.label, id: candidate.id, fromSeq: candidate.fromSeq, toSeq: candidate.toSeq });
    /**
     * Wrap a routed result for steering.
     *
     * The whole message — fixed opening, detail and fixed instruction — is redacted and bounded
     * by one shared budget, because the locator lines added by S04 count against it too.
     */
    /**
     * Append a candidate group's scope annotation to an automatic feedback body.
     *
     * A v2 trusted workflow envelope MAY declare the task range / source reference its group was
     * produced for; putting it in the feedback is what makes it checkable by the agent that receives
     * the verdict instead of only by the plugin's own logs.
     * @param detail - the rendered feedback body.
     * @param scope - the group's scope annotation, when it declared one.
     * @returns The body, bounded by the shared feedback budget.
     */
    const withScope = (detail, scope) => scope === undefined
        ? detail
        : sanitizeVerifierText(detail + '\nCandidate group scope: ' + scope, MAX_ROUTE_FEEDBACK_CHARS);
    const routeFeedback = (decision, detail) => createUserMessage({ content: [{ type: 'text', text: sanitizeVerifierText('[Automatic verifier routing: ' + decision.kind + ']\n' + detail + '\nUse this independent result to continue the actual task. Do not merely restate the ranking or progress score; implement, correct, and verify the required work.', MAX_ROUTE_FEEDBACK_CHARS) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier', form: 'notice', summary: 'Automatic verifier routed ' + decision.kind } });
    /**
     * Early candidate review for the `agent/pre-step` entry (S02).
     *
     * Handles ONLY a completed, version-correct trusted workflow candidate envelope, and runs
     * ONLY the compare/select it yields: no semantic classification, no track, no final
     * acceptance, no candidate generation. The feedback is returned as a message for the
     * CURRENT step, so the choice shapes the very next model request instead of arriving after
     * it. The router reservation/fingerprint is shared with the stop boundary, so one candidate
     * set is scored exactly once no matter which entry saw it first.
     *
     * Every failure path returns undefined and leaves the host's own step decision untouched:
     * smart keeps working, and the stop boundary remains the fallback.
     * @param agent - the agent proposing the step.
     * @param signal - the turn's cancellation signal.
     * @returns The feedback message to inject, or undefined to leave the step alone.
     */
    const earlyCandidateReview = async (agent, signal) => {
        const selected = current();
        // First version is smart-only: strict keeps its stop-boundary blocking semantics, and
        // manual has no automatic routing to move.
        if (!selected.enabled || selected.autoVerifyMode !== 'smart')
            return undefined;
        const events = sessionEvents(agent.session);
        const taskStartSeq = latestDirectUserSeq(events);
        if (taskStartSeq === undefined)
            return undefined;
        const admittedLastSeq = events.at(-1)?.seq ?? -1;
        const snapshot = events.filter(event => event.seq <= admittedLastSeq);
        const decision = analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars, { processed: fingerprint => autoRouter.completedFingerprint(agent, fingerprint) });
        // Track is the stop boundary's business: a progress score cannot change the next action.
        if (decision === undefined || decision.kind === 'track')
            return undefined;
        const policy = routePolicy(selected, (await configuredCriteria()).criteria.length * selected.autoVerifyFinalRepeats * selected.judges.length);
        // boundDecision widens back to RouteDecision, so the track exclusion is re-stated here.
        const bounded = boundDecision(decision, policy);
        if (bounded === undefined || bounded.kind === 'track')
            return undefined;
        const rubric = await configuredCriteria();
        const repeats = routedRepeats(bounded, selected.autoVerifyRepeats, selected.autoTrackRepeats);
        const expectedCalls = estimateRoutedCalls(bounded, repeats, rubric.criteria.length) * selected.judges.length;
        // The same reservation the stop boundary would take: an already-routed object, an
        // in-flight review or a spent budget all refuse here, and smart simply continues.
        const reservation = autoRouter.reserve(agent, bounded.kind, bounded.fingerprint, expectedCalls, policy);
        if (reservation === undefined)
            return undefined;
        const stillCurrent = () => !signal.aborted && (sessionEvents(agent.session).at(-1)?.seq ?? -1) === admittedLastSeq;
        const observation = { cycleId: reservation.id, trigger: 'pre-step', stage: 'execution', destination: bounded.kind, attempt: reservation.attempt, reservedCalls: reservation.expectedCalls };
        try {
            const extracted = await extractTask(agent, taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
            if (!stillCurrent()) {
                autoRouter.fail(agent, reservation, false);
                return undefined;
            }
            const stage = bounded.candidates[0].reviewStage;
            if (bounded.kind === 'compare') {
                const result = await compareCandidates(agent, extracted.problem, bounded.candidates[0].content, bounded.candidates[1].content, repeats, signal, rubric, extracted.images, 'compare', observation, stage);
                if (!stillCurrent()) {
                    autoRouter.fail(agent, reservation, false);
                    return undefined;
                }
                if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                    return undefined;
                return routeFeedback(bounded, withScope(compareRouteFeedbackDetail([candidateRef(bounded.candidates[0]), candidateRef(bounded.candidates[1])], { winner: result.winner, scoreA: result.scoreA, scoreB: result.scoreB, ...(result.identical === true ? { identical: true } : {}) }, MAX_ROUTE_FEEDBACK_CHARS, stage), bounded.scope));
            }
            const result = await selectCandidates(agent, extracted.problem, bounded.candidates.map(candidate => candidate.content), repeats, signal, rubric, extracted.images, 'select', observation, stage);
            if (!stillCurrent()) {
                autoRouter.fail(agent, reservation, false);
                return undefined;
            }
            if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                return undefined;
            return routeFeedback(bounded, withScope(selectRouteFeedbackDetail(bounded.candidates.map(candidateRef), { index: result.index, ranking: result.ranking, scores: result.scores, ...(result.identical === true ? { identical: true } : {}) }, MAX_ROUTE_FEEDBACK_CHARS, stage), bounded.scope));
        }
        catch (error) {
            autoRouter.fail(agent, reservation, false);
            ctx.logger.warn('llm-verifier early candidate review failed; leaving the step to the stop-boundary fallback: ' + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    };
    /**
     * P06: the request-level selector.
     *
     * Every decision point reads live settings, live budget and the live session, so a settings
     * change, a new task or a spent budget invalidates an unconsumed intent without extra
     * bookkeeping. The judge calls go through the ordinary engine (proposal stage, so the default
     * rubric is the unexecuted one), and the whole cycle is reported as ONE statistics row whose
     * usage covers the extra generation plus every judge call.
     */
    const processSelector = new ProcessSelector({
        settings: () => {
            const selected = current();
            return {
                active: selected.enabled && selected.autoProcessSelection,
                smart: selected.autoVerifyMode === 'smart',
                timeoutMs: selected.timeoutMs,
                maxItemChars: selected.autoRouteMaxItemChars,
                maxInputChars: selected.autoRouteMaxInputChars,
                alternativeModel: selected.autoProcessAlternativeModel,
                candidates: selected.autoProcessCandidates,
            };
        },
        // The same sanitizer every other judge input goes through. A candidate reply is untrusted text
        // like any other: redacting only the saved snapshot would still send a live credential to the
        // judge prompt.
        sanitize: (text, maxChars) => sanitizeVerifierText(text, maxChars),
        policy: processPolicy,
        router: () => autoRouter,
        store: agent => topic(agent.session.header).process,
        // The whole task, not just the user's question: the judge has to judge whether the next step
        // addresses the REAL failure, which needs the constraints the request was made under, the
        // execution trace and the failed verification runs that triggered this cycle.
        taskStatement: async (agent, fromSeq, signal) => {
            const target = agent;
            const toSeq = sessionEvents(target.session).at(-1)?.seq ?? fromSeq;
            const extracted = await extractTask(target, fromSeq, toSeq, current().autoVerifyMaxChars, signal);
            return { problem: extracted.problem, evidence: extracted.trace };
        },
        current: intent => latestDirectUserSeq(sessionEvents(intent.agent.session)) === intent.taskStartSeq,
        stream: options => ctx.llm.stream(options),
        judges: () => current().judges.length,
        compare: async (request) => {
            const agent = request.agent;
            const { verifier, selected } = await engine(agent);
            const calls = [];
            const trace = current().captureDecisions ? call => { calls.push(call); } : undefined;
            const startedAt = Date.now();
            const result = await verifier.compare({
                problem: request.problem,
                candidateA: request.candidateA,
                candidateB: request.candidateB,
                ...(request.context === undefined ? {} : { context: request.context }),
                criteria: request.criteria,
                repeats: request.repeats,
                reviewStage: 'proposal',
                ...(trace ? { trace } : {}),
            }, request.signal);
            // The decision snapshot is written here, but the STATISTICS row is written once for the whole
            // cycle (see record below): a second row would count the same judge calls twice.
            if (calls.length > 0) {
                await topic(agent.session.header).decisions.record({
                    toolName: 'verifier_compare',
                    phase: 'process',
                    startedAt,
                    provider: selected.provider,
                    model: selected.model,
                    calls: boundDecisionCalls([...calls].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))),
                }).catch(() => { });
            }
            return result;
        },
        // The tournament seam. Optional by construction: it is only reached when autoProcessCandidates
        // asks for more than two candidates, and a cycle without it compares one pair instead.
        select: async (request) => {
            const agent = request.agent;
            const { verifier, selected } = await engine(agent);
            const calls = [];
            const trace = current().captureDecisions ? call => { calls.push(call); } : undefined;
            const startedAt = Date.now();
            const result = await verifier.select({
                problem: request.problem,
                candidates: request.candidates,
                ...(request.context === undefined ? {} : { context: request.context }),
                criteria: request.criteria,
                repeats: request.repeats,
                reviewStage: 'proposal',
                ...(trace ? { trace } : {}),
            }, request.signal);
            // One decision snapshot, one statistics row for the whole cycle — exactly like the pair path.
            if (calls.length > 0) {
                await topic(agent.session.header).decisions.record({
                    toolName: 'verifier_select',
                    phase: 'process',
                    startedAt,
                    provider: selected.provider,
                    model: selected.model,
                    calls: boundDecisionCalls([...calls].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))),
                }).catch(() => { });
            }
            return result;
        },
        record: async (report) => {
            const agent = report.agent;
            const selected = current();
            // One price line for the cycle: the generation tokens are real cost, and the plugin only has
            // the verifier table (the same estimate best-of-n documents). Tokens are reported too.
            const stats = {
                ...report.usage,
                estimatedCostUsd: ((report.usage.inputTokens + report.usage.cachedInputTokens) * selected.estimatedInputUsdPerMillion + report.usage.outputTokens * selected.estimatedOutputUsdPerMillion) / 1_000_000,
            };
            // The row is the SAME shape for both cycle sizes; only the tool name and the summarizer differ,
            // so a tournament row still reports the process phase, the route observation and its usage.
            const thresholds = {
                autoVerifyThreshold: selected.autoVerifyThreshold,
                autoTrackCompletionThreshold: selected.autoTrackCompletionThreshold,
            };
            const verdict = report.compare !== undefined
                ? summarizeVerdict('verifier_compare', { ...report.compare, reviewStage: 'proposal', criteriaSource: 'process' }, 'process', thresholds)
                : report.select !== undefined
                    ? summarizeVerdict('verifier_select', { ...report.select, reviewStage: 'proposal', criteriaSource: 'process' }, 'process', thresholds)
                    : { phase: 'process', outcome: report.outcome };
            const failedCall = report.outcome === 'generation-failed' || report.outcome === 'comparison-failed';
            await topic(agent.session.header).statistics.record({
                toolName: report.select === undefined ? 'verifier_compare' : 'verifier_select',
                sessionId: String(agent.id),
                startedAt: report.startedAt,
                success: !failedCall,
                ...(report.error === undefined ? {} : { errorName: 'ProcessSelection', errorMessage: report.error }),
                provider: selected.provider,
                model: selected.model,
                stats,
                verdict,
                route: report.observation,
            }).catch(() => { });
        },
        /**
         * Correct the statistics row of a cycle whose delivery changed after it was written.
         *
         * `route.replayed` means what the HOST received: leaving the intention in place would report a
         * replacement that never happened and inflate the replacement rate. The cycle sidecar is
         * corrected by the selector, which owns it.
         */
        correctDelivery: async (correction) => {
            const target = correction.agent;
            await topic(target.session.header).statistics.amend(correction.cycleId, { outcome: correction.outcome, replayed: correction.replayed });
        },
        logger: { warn: message => ctx.logger.warn(message) },
        now: () => Date.now(),
        diagnosticCycleId: nextDiagnosticCycleId,
    });
    clearProcessIntents = () => processSelector.clearAll();
    /**
     * Arm one process-selection intent when the task is stuck in the two-failure recovery.
     *
     * Registration buys nothing by itself: it records that the NEXT real main request of this task
     * may be worth an alternative reply. Every precondition is re-checked when a request actually
     * arrives, so a stale intent can only ever be ignored. A log that cannot be read does NOT buy —
     * the safe side of "already purchased or unknown" is to keep the original path.
     * @param agent - the agent proposing the step.
     * @param signal - the turn's cancellation signal.
     */
    const registerProcessIntent = async (agent, signal) => {
        const selected = current();
        if (!selected.enabled || !selected.autoProcessSelection || selected.autoVerifyMode !== 'smart')
            return;
        if (signal.aborted)
            return;
        const sessionId = String(agent.id);
        if (processSelector.pending(sessionId))
            return;
        const events = sessionEvents(agent.session);
        const taskStartSeq = latestDirectUserSeq(events);
        if (taskStartSeq === undefined)
            return;
        if (autoRouter.hasProcessAttempt(agent))
            return;
        const lookup = await topic(agent.session.header).process.lookup(sessionId, taskStartSeq);
        if (!lookup.ok) {
            ctx.logger.warn('llm-verifier process selection: the cycle log could not be read (' + String(lookup.reason) + '); no cycle will be bought for this task');
            return;
        }
        if (lookup.purchased)
            return;
        const recovery = inspectRecoverySignal(events, selected.autoRouteMaxItemChars);
        if (recovery === undefined)
            return;
        // Handing the alternative the failure evidence is what makes it a differently informed attempt
        // instead of a resample of a reply already shown to fail; the toggle exists so the controlled
        // comparison can run the other arm.
        const failureContext = selected.autoProcessFailureContext ? recovery.failureContext : undefined;
        processSelector.register({ sessionId, agent, taskStartSeq, signal: recovery.signature, registeredAt: Date.now(), lastSeq: events.at(-1)?.seq ?? taskStartSeq, ...(failureContext === undefined ? {} : { failureContext }) });
    };
    const handleStatisticsQuery = async (payload) => {
        // A malformed range used to be swallowed by the Promise.allSettled fan-out below and
        // answered as an empty "success" with a NaN range, so validate the payload up front.
        const parsed = parseStatisticsQuery(payload);
        if (!parsed.ok)
            return rpcFailure(parsed.message);
        const query = parsed.query;
        try {
            const headers = (await sessionHeaders()).filter(header => query.sessionId === undefined || String(header.id) === query.sessionId);
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
    /**
     * One decision snapshot by invocation id, across every topic.
     *
     * The dashboard shows merged topics, so the lookup fans out the same way the
     * statistics query does instead of guessing which topic owns the record.
     * @param id - invocation id the snapshot was stored under.
     */
    const handleDecisionQuery = async (id) => {
        if (typeof id !== 'string' || id.length === 0)
            return rpcFailure('decision id must be a non-empty string');
        try {
            for (const header of await sessionHeaders()) {
                const found = await topic(header).decisions.find(id).catch(() => undefined);
                if (found)
                    return rpcSuccess({ decision: found });
            }
            return rpcFailure('decision snapshot not found: it was pruned, never captured, or belongs to a deleted topic');
        }
        catch (error) {
            return rpcFailure(error instanceof Error ? error.message : String(error));
        }
    };
    /** Whether a payload asks for a decision snapshot instead of a statistics overview. */
    const isDecisionQuery = (payload) => typeof payload === 'object' && payload !== null && payload.kind === 'decision';
    /**
     * Judge diagnostics: one real, bounded judge call per configured judge plus the resolved rubric.
     *
     * Answers the two questions a user actually has after configuring the plugin: "which scoring
     * channel is this judge using" (a silent explicit-tag downgrade is invisible otherwise) and
     * "is the rubric I configured the one in effect" (a broken custom file degrades quietly).
     * Deliberately NOT recorded in the statistics: it is a diagnostic, not a verification.
     * @returns Per-judge probe results and the rubric in effect.
     */
    const handleProbe = async () => {
        try {
            // The dashboard is a GLOBAL page: there is usually no current initiator, so requiring one
            // made the probe unusable exactly where its button lives. Fall back to the newest topic,
            // which is also where the re-probed channel verdict should be remembered.
            const initiator = ctx.agents.currentInitiator();
            const header = initiator?.session.header ?? (await sessionHeaders())[0];
            if (header === undefined)
                return rpcFailure('llm-verifier: the judge probe needs one session to attach its capability memory to, and no session exists yet — start a session, then probe again');
            const { verifier } = await engineForHeader(header);
            const rubric = await configuredCriteria();
            const criterion = rubric.criteria[0];
            if (criterion === undefined)
                return rpcFailure('llm-verifier: the configured rubric has no criteria');
            const prompt = buildPairwisePrompt(PROBE_TASK, PROBE_A, PROBE_B, criterion, rubric.groundTruthNote ?? DEFAULT_GROUND_TRUTH_NOTE);
            const judges = [];
            for (const client of verifier.clients) {
                const label = client.label ?? client.provider + '/' + client.model;
                const startedAt = Date.now();
                // Forget the cached channel verdict for this judge before probing. A mark written up to 24h
                // ago — possibly before the provider was (re)configured, and certainly before a host
                // restart — would make the probe replay a stale answer instead of checking, which is the one
                // thing a diagnostic must not do. It also means a provider that CAN return logprobs starts
                // using that better channel for subsequent real verifications.
                client.topLogprobCapabilities.forget(client.provider, client.model);
                try {
                    const completion = await callVerifier({ ...client, timeoutMs: Math.min(client.timeoutMs, PROBE_TIMEOUT_MS), maxRetries: 0 }, prompt);
                    judges.push({
                        label,
                        provider: client.provider,
                        model: client.model,
                        ok: true,
                        channelProbed: true,
                        channel: completion.scoringMode,
                        scoreA: extractScore(completion, '<score_A>'),
                        scoreB: extractScore(completion, '<score_B>'),
                        latencyMs: Date.now() - startedAt,
                        ...completion.usage,
                    });
                }
                catch (error) {
                    judges.push({ label, provider: client.provider, model: client.model, ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
                }
            }
            return rpcSuccess({
                judges,
                channelProbed: true,
                rubric: { source: rubric.source, count: rubric.criteria.length, ...(rubric.file ? { file: rubric.file } : {}), ...(rubric.error ? { error: rubric.error } : {}) },
            });
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
                    const isProbe = typeof payload === 'object' && payload !== null && payload.kind === 'probe';
                    const outcome = isDecisionQuery(payload) ? await handleDecisionQuery(payload.id) : isProbe ? await handleProbe() : await handleStatisticsQuery(payload);
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
                if (endpoint === 'decision')
                    return handleDecisionQuery(payload?.id);
                if (endpoint === 'probe')
                    return handleProbe();
                if (endpoint !== 'statistics')
                    return rpcFailure('unknown llm-verifier endpoint');
                return handleStatisticsQuery(payload);
            });
        }
        catch (e) {
            ctx.logger.warn('failed to register /llm-verifier rpc fallback: ' + String(e));
        }
    }
    ctx.on('agent/disposed', ({ agent }) => { autoRouter.release(agent); topics.delete(String(agent.id)); processSelector.clear(String(agent.id)); });
    // P06: the host's ONE request-level interception point. The handler binds a registered intent to
    // a real main-loop request (host marker + session id) and otherwise delegates untouched; the
    // alternative reply is dispatched as a fresh request that is not an agent-loop request, so this
    // listener can never recurse into itself.
    ctx.on('llm/stream', (options, next) => {
        const intent = processSelector.take(options);
        if (intent === undefined)
            return next();
        return processSelector.handle(options, next, intent);
    });
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
        // Reserve the floor for one final acceptance before any route is admitted, so an
        // expensive route cannot arm the mandatory gate and then leave it unaffordable.
        const policy = routePolicy(selected, (await configuredCriteria()).criteria.length * selected.autoVerifyFinalRepeats * selected.judges.length);
        const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold }, String(agent.id));
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
            const classified = await classifyRoute(agent, buildPlanPreReviewPrompt(extracted.problem, plan, selected.autoRouteMaxInputChars), exec.signal, 'plan_review', { cycleId: reservation.id, trigger: 'plan', stage: 'classification', destination: 'plan_review', attempt: reservation.attempt, reservedCalls: reservation.expectedCalls });
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
    // S02: review a finished trusted workflow candidate envelope BEFORE the next model
    // request, so the chosen option shapes the very next action instead of arriving after it.
    // Deliberately narrow — the stop boundary still owns semantic routing, track and the final
    // acceptance, and remains the fallback for everything this entry declines to do.
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        // A rejected or cancelled step is never resurrected by an injected prompt.
        if (decision.kind === 'reject')
            return decision;
        const selected = current();
        if (!selected.enabled || selected.autoVerifyMode !== 'smart')
            return decision;
        if (payload.signal.aborted)
            return decision;
        if (!selected.autoVerifySubagents && isSubagentSession(payload.agent))
            return decision;
        // A step carrying a fresh direct or team task belongs to the operator, not to us.
        const carriesTask = payload.messages.some(message => {
            const kind = message.source?.kind;
            return kind === 'user' || kind === 'team-message';
        });
        if (carriesTask)
            return decision;
        // Respect host admission. The plugin sees only the FINAL waterfall decision, so it can
        // tell a normal tool-follow-up from a continuation a downstream listener cleared by
        // comparing that decision with what the step was OFFERED:
        //   - the driver's first step with nothing to enter (the host ends the turn), or
        //   - a step that was offered messages but came back with none (cleared downstream),
        // must stay empty. Only a tool-follow-up — nothing offered, nothing cleared — may receive
        // an injected message; injecting into a cleared step resurrects a suppressed step and
        // spends judge calls on it.
        const clearedContinuation = payload.messages.length > 0 && decision.messages.length === 0;
        if (decision.messages.length === 0 && (payload.step <= 1 || clearedContinuation))
            return decision;
        const injected = await earlyCandidateReview(payload.agent, payload.signal);
        // P06 comes AFTER the existing-candidate review: a trusted pair that was just scored takes
        // priority over generating a new reply, and so does an in-flight review (the router refuses
        // the later reservation anyway). Registration itself calls no model.
        if (injected === undefined)
            await registerProcessIntent(payload.agent, payload.signal);
        if (injected === undefined)
            return decision;
        return { kind: 'enter', messages: [...decision.messages, injected] };
    });
    ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
        const selected = current();
        if (!selected.enabled || selected.autoVerifyMode === 'manual' || signal.aborted)
            return;
        // Delegated child sessions are seeded with a real user message, so they would
        // otherwise be gated (and steered) as if they were the operator's own task.
        if (!selected.autoVerifySubagents && isSubagentSession(agent))
            return;
        // Reserve the floor for one final acceptance before any route is admitted, so an
        // expensive route cannot arm the mandatory gate and then leave it unaffordable.
        const policy = routePolicy(selected, (await configuredCriteria()).criteria.length * selected.autoVerifyFinalRepeats * selected.judges.length);
        const evidence = analyzeAutoTask(sessionEvents(agent.session), { mode: selected.autoVerifyMode, minToolCalls: selected.autoVerifyMinToolCalls, maxPerTask: selected.autoVerifyMaxPerTask, maxPerSession: selected.autoVerifyMaxPerSession, threshold: selected.autoVerifyThreshold }, String(agent.id));
        const admittedLastSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1;
        const snapshot = sessionEvents(agent.session).filter(event => event.seq <= admittedLastSeq);
        const stillCurrent = () => !signal.aborted && (sessionEvents(agent.session).at(-1)?.seq ?? -1) === admittedLastSeq;
        // A manual `verifier_current_session` that covered the whole task and passed is the
        // strongest acceptance signal available; it discharges the mandatory final gate
        // BEFORE another routed decision is purchased. `analyzeAutoTask` already refused any
        // verdict that is stale, partial, malformed or from another session, so reaching here
        // means the review really does cover the current state.
        if (evidence.manualVerificationAccepted) {
            autoRouter.acceptManual(agent);
            return;
        }
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
                    const classified = await classifyRoute(agent, prompt, signal, 'team_task', { cycleId: taskReservation.id, trigger: 'team', stage: 'classification', destination: 'team_task', attempt: taskReservation.attempt, reservedCalls: taskReservation.expectedCalls });
                    if (!stillCurrent()) {
                        autoRouter.fail(agent, taskReservation, false);
                        return;
                    }
                    const verdict = parseVerdictLetter(classified.text);
                    if (verdict === undefined) {
                        // Fail closed in strict mode like every other routed phase: an unparseable
                        // verdict must not silently leave the task ungated.
                        const strict = selected.autoVerifyMode === 'strict';
                        autoRouter.fail(agent, taskReservation, strict);
                        ctx.logger.warn('llm-verifier team task verification produced no verdict line; task ' + task.id + (strict ? ' stays blocked' : ' was not gated'));
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
        // A previous track route already cleared the completion threshold (preferFinal): the
        // final gate is mandatory and already armed, so buying another route first would only
        // delay it with evidence whose steered text would be identical. The preference is
        // consumed by the final reservation, so a failed acceptance releases routing again.
        const finalPreferred = autoRouter.finalPreferred(agent);
        // The mandatory gate is read here as well because S03 decides whether the progress route
        // is worth buying, and a forced gate changes that answer.
        // Read once, but reassigned when THIS boundary itself arms the mandatory gate (see the track
        // branch): a stale read would send the acceptance to the next boundary for no reason.
        let forcedFromSeq = autoRouter.finalRequired(agent);
        // S03 delivery phase: every todo completed AND a real verification run exists. This only
        // decides whether the progress score is worth buying — never whether the task passes —
        // and it deliberately ignores the run's success, because a failing run is exactly what
        // the judge must see.
        const delivery = inspectDeliveryPhase(snapshot);
        const deliverySignature = delivery?.signature;
        const deliveryReady = delivery !== undefined && delivery.todosComplete && delivery.verification !== undefined
            && deliverySignature !== undefined && !autoRouter.deliveryConsumed(agent, deliverySignature)
            && (evidence.eligible || forcedFromSeq !== undefined);
        const structured = finalPreferred ? undefined : analyzeStructuredRoute(snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars, { processed: fingerprint => autoRouter.completedFingerprint(agent, fingerprint) });
        let decision = finalPreferred ? undefined : boundDecision(structured, policy);
        if (structured !== undefined && decision === undefined) {
            ctx.logger.warn('llm-verifier automatic ' + structured.kind + ' route dropped: its evidence exceeds the per-item/total routing caps (' + selected.autoRouteMaxItemChars + '/' + selected.autoRouteMaxInputChars + ' characters)');
            await recordSkippedRoute(agent, structured.kind, 'structured', 'dropped-over-budget', { cycleId: nextCycleId(), trigger: 'turn-stopping', stage: 'skipped', destination: structured.kind, skipReason: 'dropped-over-budget' });
        }
        // S03: the delivery phase skips the PROGRESS route, never an unprocessed candidate
        // selection (a compare/select is step 3, before this shortcut). The skipped track cycle is
        // recorded and the completion signal is consumed, so a failed acceptance cannot keep
        // skipping routing on the same finished state — only new work or a new verification run
        // changes the signature and re-arms it.
        const deliveryFastPath = deliveryReady && !finalPreferred && (decision?.kind === 'track' || (decision === undefined && !semanticRouteHint(snapshot)));
        if (deliveryFastPath) {
            if (decision?.kind === 'track') {
                ctx.logger.warn('llm-verifier automatic track route skipped: the task is in its delivery phase (todos complete + verification evidence)');
                await recordSkippedRoute(agent, 'track', 'structured', 'delivery-phase', { cycleId: nextCycleId(), trigger: 'turn-stopping', stage: 'skipped', destination: 'track', skipReason: 'delivery-phase' });
            }
            decision = undefined;
            if (deliverySignature !== undefined)
                autoRouter.consumeDelivery(agent, deliverySignature);
        }
        // One logical routing cycle consumes exactly ONE route attempt. A classification that
        // resolves to a decision is PROMOTED on its own reservation instead of committed and
        // re-reserved: the commit-then-reserve pair spent two attempts per cycle, so the shipped
        // default of two could never afford "plan pre-review → classify → compare".
        let cycleReservation;
        if (!finalPreferred && !deliveryFastPath && decision === undefined && selected.autoRouteSemantic && (selected.autoVerifyMode === 'strict' || semanticRouteHint(snapshot))) {
            // Build the evidence view FIRST so the cycle's identity is its RENDERED EVIDENCE rather
            // than the last event sequence: appending a narrative message changes admittedLastSeq but
            // not one byte of the classifier prompt, and re-buying an identical classification is
            // exactly what the cycle budget forbids. Rendering makes no model call, so a failure here
            // costs nothing and must NOT steer — no attempt was consumed.
            let view;
            let viewError;
            try {
                const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                // Build the prompt and the set of citable references from ONE bounded view: the budget
                // can omit artifacts/checkpoints, and citing a dropped one is an invalid reference
                // rather than a decision the classifier is allowed to make.
                view = buildSemanticRouteView(extracted.problem, snapshot, selected.autoRouteMaxCandidates, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars);
            }
            catch (error) {
                viewError = error;
            }
            if (view === undefined) {
                // Reading the evidence failed (an image fetch, a redaction). This is NOT a budget stop,
                // so it must not silence the gate: consume one attempt to authorize any strict steering,
                // record why, and FALL THROUGH to the mandatory final acceptance.
                const message = viewError instanceof Error ? viewError.message : String(viewError);
                ctx.logger.warn('llm-verifier semantic routing could not read its evidence: ' + message);
                const failed = autoRouter.reserve(agent, 'semantic', stableHash({ phase: 'semantic-unreadable', from: evidence.taskStartSeq, to: admittedLastSeq, model: selected.provider + '/' + selected.model }), 1, policy);
                if (failed) {
                    await recordSkippedRoute(agent, 'none', 'semantic', 'evidence-unreadable', { cycleId: failed.id, trigger: 'turn-stopping', stage: 'skipped', destination: 'none', attempt: failed.attempt, reservedCalls: failed.expectedCalls, skipReason: 'evidence-unreadable', canceled: false });
                    autoRouter.fail(agent, failed, selected.autoVerifyMode === 'strict');
                    if (selected.autoVerifyMode === 'strict' && !signal.aborted)
                        agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict semantic routing could not read the evidence: ' + message + '\nThe failure is recorded; the mandatory final acceptance still runs.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                }
            }
            else {
                const fingerprint = stableHash({ phase: 'semantic', model: selected.provider + '/' + selected.model, prompt: view.prompt });
                const reservation = autoRouter.reserve(agent, 'semantic', fingerprint, 1, policy);
                if (reservation) {
                    try {
                        // Shared by every outcome of this cycle: a promoted execution row keeps the same id.
                        const cycle = { cycleId: reservation.id, trigger: 'turn-stopping', stage: 'classification', destination: 'unresolved', attempt: reservation.attempt, reservedCalls: reservation.expectedCalls, ...viewObservation(view) };
                        const classified = await classifyRoute(agent, view.prompt, signal, 'semantic', cycle);
                        if (!stillCurrent()) {
                            await recordSkippedRoute(agent, 'none', 'semantic', 'canceled', { ...cycle, stage: 'skipped', destination: 'canceled', canceled: true });
                            autoRouter.fail(agent, reservation, false);
                            return;
                        }
                        const parsed = parseSemanticRoute(classified.text, selected.autoRouteMaxCandidates);
                        if (!parsed)
                            throw new Error('semantic router returned invalid strict JSON');
                        if (parsed.kind === 'none' || parsed.confidence < selected.autoRouteMinConfidence) {
                            // A "none" classification is a decision even at full confidence, and a
                            // low-confidence one is too: record either so the dashboard can explain "not
                            // routed" instead of showing only the classifier call.
                            const skipReason = parsed.kind === 'none' ? 'none' : 'low-confidence';
                            await recordSkippedRoute(agent, 'none', 'semantic', skipReason, { ...cycle, stage: 'skipped', destination: parsed.kind, skipReason });
                            autoRouter.commit(agent, reservation);
                        }
                        else if (!semanticReferencesVisible(parsed, view)) {
                            ctx.logger.warn('llm-verifier semantic router returned ' + parsed.kind + ' but referenced evidence outside the rendered view');
                            await recordSkippedRoute(agent, parsed.kind, 'semantic', 'invalid-references', { ...cycle, stage: 'skipped', destination: parsed.kind, skipReason: 'invalid-references' });
                            if (selected.autoVerifyMode === 'strict') {
                                // Strict mode refuses to treat an out-of-view citation as a silent pass, but it
                                // must NOT end the review: mark the task blocked, steer once, and fall through so
                                // the mandatory final acceptance still runs at this boundary. The reservation is
                                // already spent, so a retry is bounded by the route budget, not a loop.
                                autoRouter.fail(agent, reservation, true);
                                if (!signal.aborted)
                                    agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nStrict semantic routing was rejected: the classifier cited evidence outside the rendered view. The rejection is recorded; continue only with work that can be verified.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                            }
                            else {
                                autoRouter.commit(agent, reservation);
                            }
                        }
                        else {
                            const resolved = semanticDecision(parsed, snapshot, selected.autoRouteMaxItemChars, selected.autoRouteMaxInputChars, view);
                            const bounded = resolved === undefined ? undefined : boundDecision(resolved, policy);
                            if (resolved === undefined) {
                                // The classification was valid but produced nothing executable (the same
                                // candidate set was already reviewed, or a cited call is not evidence).
                                await recordSkippedRoute(agent, parsed.kind, 'semantic', 'no-executable-decision', { ...cycle, stage: 'skipped', destination: parsed.kind, skipReason: 'no-executable-decision' });
                                autoRouter.commit(agent, reservation);
                            }
                            else if (bounded === undefined) {
                                ctx.logger.warn('llm-verifier semantic ' + resolved.kind + ' route dropped: its evidence exceeds the per-item/total routing caps (' + selected.autoRouteMaxItemChars + '/' + selected.autoRouteMaxInputChars + ' characters)');
                                await recordSkippedRoute(agent, resolved.kind, 'semantic', 'dropped-over-budget', { ...cycle, stage: 'skipped', destination: resolved.kind, skipReason: 'dropped-over-budget' });
                                autoRouter.commit(agent, reservation);
                            }
                            else if (autoRouter.completedFingerprint(agent, bounded.fingerprint)) {
                                await recordSkippedRoute(agent, bounded.kind, 'semantic', 'already-routed', { ...cycle, stage: 'skipped', destination: bounded.kind, skipReason: 'already-routed' });
                                autoRouter.commit(agent, reservation);
                            }
                            else {
                                // Promote the SAME cycle: the classification already consumed this cycle's route
                                // attempt, so its execution must not buy a second one. The extra model calls are
                                // checked atomically against the budget, including the final-acceptance floor.
                                const repeats = routedRepeats(bounded, selected.autoVerifyRepeats, selected.autoTrackRepeats);
                                const rubric = await configuredCriteria();
                                const expectedCalls = estimateRoutedCalls(bounded, repeats, rubric.criteria.length) * selected.judges.length;
                                if (autoRouter.promote(agent, reservation, bounded.kind, bounded.fingerprint, expectedCalls, policy)) {
                                    decision = bounded;
                                    cycleReservation = reservation;
                                }
                                else {
                                    // Classification succeeded, scoring did not. Recorded as exactly that — never as
                                    // "none" (nothing was decided about the work) and never as a completed review.
                                    ctx.logger.warn('llm-verifier semantic ' + bounded.kind + ' route classified but not executed: the task/session budget cannot cover ' + expectedCalls + ' model calls');
                                    await recordSkippedRoute(agent, bounded.kind, 'semantic', 'classification-only-budget', { ...cycle, stage: 'skipped', destination: bounded.kind, skipReason: 'classification-only-budget' });
                                    autoRouter.commit(agent, reservation);
                                }
                            }
                        }
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
        }
        if (!stillCurrent())
            return;
        if (decision) {
            // Every judge scores every match, and compare/select round the repeat count up to an
            // even number so the A/B slots get swapped, so the reservation has to cover both.
            const repeats = routedRepeats(decision, selected.autoVerifyRepeats, selected.autoTrackRepeats);
            const rubric = await configuredCriteria();
            const expectedCalls = estimateRoutedCalls(decision, repeats, rubric.criteria.length) * selected.judges.length;
            // A decision that came out of a classification cycle already owns its reservation, on
            // the same cycle id; reserving again would be refused (that cycle is still in flight)
            // and would spend a second route attempt on one logical cycle.
            const reservation = cycleReservation ?? autoRouter.reserve(agent, decision.kind, decision.fingerprint, expectedCalls, policy);
            if (reservation === undefined) {
                // A refused reservation used to drop the whole routed decision silently.
                // Three different refusals used to share one misleading message.
                const exhausted = autoRouter.budgetExhausted(agent, expectedCalls, policy);
                const alreadyRan = autoRouter.completedFingerprint(agent, decision.fingerprint);
                const refusal = exhausted
                    ? 'the task/session budget cannot cover ' + expectedCalls + ' model calls'
                    : alreadyRan ? 'this exact evidence was already routed' : 'another verifier is active';
                ctx.logger.warn('llm-verifier automatic ' + decision.kind + ' route skipped: ' + refusal);
                const skipReason = exhausted ? 'budget-exhausted' : alreadyRan ? 'already-routed' : 'verifier-in-flight';
                await recordSkippedRoute(agent, decision.kind, decision.source, skipReason, { cycleId: nextCycleId(), trigger: 'turn-stopping', stage: 'skipped', destination: decision.kind, skipReason });
                if (exhausted && selected.autoVerifyMode === 'strict' && autoRouter.claimExhaustedNotice(agent)) {
                    agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier routing]\nA routed ' + decision.kind + ' check was skipped because the task/session model-call budget is exhausted. Do not conclude until directly relevant verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
                    return;
                }
            }
            if (reservation) {
                try {
                    const extracted = await extractTask(agent, evidence.taskStartSeq, admittedLastSeq, selected.autoVerifyMaxChars, signal);
                    const routedObservation = { cycleId: reservation.id, trigger: 'turn-stopping', stage: 'execution', destination: decision.kind, attempt: reservation.attempt, reservedCalls: reservation.expectedCalls };
                    // The stage the candidate group declared (a v2 workflow envelope may say "proposal").
                    // A track decision has no candidates at all, so it is an artifact by construction.
                    const decisionStage = decision.kind === 'track' ? 'artifact' : decision.candidates[0].reviewStage;
                    if (decision.kind === 'compare') {
                        const result = await compareCandidates(agent, extracted.problem, decision.candidates[0].content, decision.candidates[1].content, repeats, signal, rubric, extracted.images, 'compare', routedObservation, decisionStage);
                        if (!stillCurrent()) {
                            await recordSkippedRoute(agent, decision.kind, decision.source, 'canceled', { ...routedObservation, stage: 'skipped', canceled: true });
                            autoRouter.fail(agent, reservation, false);
                            return;
                        }
                        if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                            return;
                        // S04: a tie, a byte-identical pair and a real winner are three different
                        // outcomes and are reported as such, with locators instead of copied candidates.
                        agent.steer(routeFeedback(decision, withScope(compareRouteFeedbackDetail([candidateRef(decision.candidates[0]), candidateRef(decision.candidates[1])], { winner: result.winner, scoreA: result.scoreA, scoreB: result.scoreB, ...(result.identical === true ? { identical: true } : {}) }, MAX_ROUTE_FEEDBACK_CHARS, decisionStage), decision.scope)));
                        return;
                    }
                    if (decision.kind === 'select') {
                        const result = await selectCandidates(agent, extracted.problem, decision.candidates.map(candidate => candidate.content), repeats, signal, rubric, extracted.images, 'select', routedObservation, decisionStage);
                        if (!stillCurrent()) {
                            await recordSkippedRoute(agent, decision.kind, decision.source, 'canceled', { ...routedObservation, stage: 'skipped', canceled: true });
                            autoRouter.fail(agent, reservation, false);
                            return;
                        }
                        if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                            return;
                        // A selection only has relative shares: a shared top score is reported as a tie
                        // set, and the stable-sort first entry is never called the clear winner.
                        agent.steer(routeFeedback(decision, withScope(selectRouteFeedbackDetail(decision.candidates.map(candidateRef), { index: result.index, ranking: result.ranking, scores: result.scores, ...(result.identical === true ? { identical: true } : {}) }, MAX_ROUTE_FEEDBACK_CHARS, decisionStage), decision.scope)));
                        return;
                    }
                    const result = await trackProgress(agent, extracted.problem, decision.steps, decision.checkpoints, repeats, signal, extracted.images, 'track', routedObservation);
                    if (!stillCurrent()) {
                        await recordSkippedRoute(agent, decision.kind, decision.source, 'canceled', { ...routedObservation, stage: 'skipped', canceled: true });
                        autoRouter.fail(agent, reservation, false);
                        return;
                    }
                    if (!autoRouter.commit(agent, reservation, admittedLastSeq))
                        return;
                    const detail = result.scores.map((score, index) => 'Checkpoint step ' + decision.checkpoints[index] + ': ' + (score * 100).toFixed(1) + '%').join('\n');
                    // Judge the CURRENT state, not the whole history: the first checkpoint is the
                    // state right after the first todo snapshot, which is always "nothing done
                    // yet", so "any checkpoint below threshold" made the continue branch
                    // unconditional (5/5 live routes) and the threshold meaningless.
                    const latest = result.scores.length > 0 ? result.scores[result.scores.length - 1] : 0;
                    const completed = latest >= selected.autoTrackCompletionThreshold;
                    // The work already reads as done: arm the next boundary to run the mandatory final
                    // gate instead of paying for another progress route that would say the same thing.
                    if (completed)
                        autoRouter.preferFinal(agent);
                    const located = renderDiagnostics(result.diagnostics, 1200);
                    // P04 (smart only; strict keeps its historical always-steer semantics): a track result is an
                    // OBSERVATION. A generic "continue the unfinished work" instruction is only worth sending
                    // when it says something the agent could not already read off the checkpoints, so:
                    //   - something locatable and unfinished  -> steer those findings;
                    //   - completed, or low score with nothing locatable -> hand the boundary over to the final
                    //     acceptance, which is the decision that can still fail the turn.
                    if (selected.autoVerifyMode !== 'smart') {
                        const continuation = completed ? '\nPrepare final delivery evidence; final session verification is mandatory.' : '\nContinue the unfinished work.';
                        agent.steer(routeFeedback(decision, detail + continuation));
                        return;
                    }
                    if (!completed && located !== '') {
                        agent.steer(routeFeedback(decision, detail + '\n' + located));
                        return;
                    }
                    // Falling through is only useful when the mandatory gate can actually run here; otherwise the
                    // historical nudge stays, so a task is never left with no guidance at all.
                    const gateArmed = autoRouter.finalRequired(agent) !== undefined;
                    if (forcedFromSeq === undefined && !evidence.eligible && !gateArmed) {
                        const fallback = completed ? '\nPrepare final delivery evidence; final session verification is mandatory.' : '\nContinue the unfinished work.';
                        agent.steer(routeFeedback(decision, detail + fallback));
                        return;
                    }
                    if (forcedFromSeq === undefined)
                        forcedFromSeq = admittedLastSeq;
                    await recordSkippedRoute(agent, 'track', decision.source, completed ? 'track-completed' : 'no-diagnostics', {
                        cycleId: nextCycleId(),
                        trigger: 'turn-stopping',
                        stage: 'skipped',
                        destination: 'track',
                        skipReason: completed ? 'track-completed' : 'no-diagnostics',
                    });
                    // Deliberately no return: the final acceptance runs at THIS stop boundary.
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
        // Exact planning instead of a flat 4-per-repeat guess: one comparison per
        // criterion per repeat, repeated for every judge in the ensemble.
        const finalRubric = await configuredCriteria();
        const finalReservation = autoRouter.reserve(agent, 'final', finalFingerprint, Math.max(1, finalRubric.criteria.length * selected.autoVerifyFinalRepeats) * selected.judges.length, policy);
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
        const finalObservation = { cycleId: finalReservation.id, trigger: 'turn-stopping', stage: 'final', destination: 'final', attempt: finalReservation.attempt, reservedCalls: finalReservation.expectedCalls };
        try {
            const result = await verifySession(agent, { fromSeq: finalFromSeq, toSeq: admittedLastSeq, includeAssistantText: true, maxChars: selected.autoVerifyMaxChars, repeats: selected.autoVerifyFinalRepeats }, signal, 'final', finalRubric, finalObservation);
            if (!stillCurrent()) {
                await recordSkippedRoute(agent, 'final', 'final', 'canceled', { ...finalObservation, stage: 'skipped', canceled: true });
                autoRouter.fail(agent, finalReservation, false);
                return;
            }
            // The mean over criteria used to hide a single failed requirement, and the fixed
            // empty-work baseline can never win on its own, so the gate is (a) the winner,
            // (b) the mean score and (c) every criterion on its own.
            const failed = failedAcceptanceCriteria(result.criteria, selected.autoVerifyThreshold);
            const passed = sessionAccepted({ score: result.score, winner: result.winner, criteria: result.criteria }, selected.autoVerifyThreshold);
            if (passed)
                autoRouter.commit(agent, finalReservation);
            else {
                autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict');
                // S04: the failure names the criteria that failed AND the interval the judge actually
                // read, and says so explicitly when it reported no breakdown or the bound omitted evidence.
                agent.steer(createUserMessage({ content: [{ type: 'text', text: sanitizeVerifierText(automaticFeedback(result.score, result.baselineScore, result.winner, selected.autoVerifyThreshold, failed, { sessionId: result.sessionId, fromSeq: result.fromSeq, toSeq: result.toSeq, omittedCharacters: result.omittedCharacters }, result.criteria.length, result.diagnostics), MAX_ROUTE_FEEDBACK_CHARS) }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
            }
        }
        catch (error) {
            autoRouter.fail(agent, finalReservation, selected.autoVerifyMode === 'strict');
            const finalMessage = error instanceof Error ? error.message : String(error);
            ctx.logger.warn('llm-verifier automatic final verification failed: ' + finalMessage);
            // A failed gate must leave a row: zero statistics reads as "nothing was ever attempted"
            // and hides a broken evidence read behind a silent turn close.
            await recordSkippedRoute(agent, 'final', 'final', 'failed', { cycleId: finalReservation.id, trigger: 'turn-stopping', stage: 'skipped', destination: 'final', attempt: finalReservation.attempt, reservedCalls: finalReservation.expectedCalls, skipReason: 'failed', canceled: false });
            if (selected.autoVerifyMode === 'strict' && !signal.aborted)
                agent.steer(createUserMessage({ content: [{ type: 'text', text: '[Automatic verifier gate]\nStrict final verification failed: ' + finalMessage + '\nDo not conclude until verification succeeds.' }], source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } }));
        }
    });
    ctx.tools.register(defineTool({ name: 'verifier_compare', description: 'Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings (or the configured judge ensemble) with top-logprob A–T expectations when supported and explicit-tag fallback otherwise. Pass review_stage="proposal" when neither side has been executed yet: the default rubric then becomes goal/constraints, feasibility and verification design, and the verdict reports reviewStage and criteriaSource. A proposal win is never evidence that the task was completed.', parameters: { problem: { type: 'string', required: true }, candidate_a: { type: 'string', required: true }, candidate_b: { type: 'string', required: true }, review_stage: reviewStageParam, ...commonParams }, output: { schema: { type: 'object', additionalProperties: false, properties: { scoreA: { type: 'number', required: true }, scoreB: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: criterionResultSchema, required: true }, identical: { type: 'boolean' }, reviewStage: reviewStageField, criteriaSource: criteriaSourceField, diagnostics: diagnosticsSchema, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_compare', agent, async (trace) => { const { verifier, selected } = await engine(agent); const [problem, candidateA, candidateB] = explicitEvidence([args.problem, args.candidate_a, args.candidate_b], explicitItemChars(selected), explicitBudget(selected), 'compare input'); const stage = parseReviewStage(args.review_stage); const rubric = await stageRubric(stage, args.criteria); const repeats = capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'); const planned = rubric.criteria.length * repeats * selected.judges.length; if (planned > MAX_EXPLICIT_PLANNED_CALLS)
            throw new Error('llm-verifier: this comparison would issue about ' + planned + ' judge calls; reduce repeats, criteria or judges'); const result = await verifier.compare({ problem, candidateA, candidateB, criteria: rubric.criteria, ...(rubric.groundTruthNote ? { groundTruthNote: rubric.groundTruthNote } : {}), repeats, reviewStage: stage, domain: rubricDomain(rubric), images: await images(args.images, exec.signal), ...(trace ? { trace } : {}) }, exec.signal); return { result: { ...result, reviewStage: stage, criteriaSource: rubric.source }, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_select', description: 'Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates. Generating extra candidates pays off only when the artifact is a final deliverable and choosing wrong is expensive: produce them (for example with parallel subagents), then rank the real ones here. Do not pad the list with near-duplicates. Deterministic orchestrators should call this directly once they have three or more real candidates. Pass review_stage="proposal" to rank unexecuted plans or drafts: the default rubric then becomes goal/constraints, feasibility and verification design, and the verdict reports reviewStage and criteriaSource — relative shares, never an acceptance result.', parameters: { problem: { type: 'string', required: true }, candidates: { type: 'array', items: { type: 'string' }, required: true }, review_stage: reviewStageParam, ...commonParams, pivots: { type: 'integer' }, seed: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', required: true }, best: { type: 'string', required: true }, identical: { type: 'boolean' }, reviewStage: reviewStageField, criteriaSource: criteriaSourceField, diagnostics: diagnosticsSchema, scores: { type: 'array', items: { type: 'number' }, required: true }, ranking: { type: 'array', items: { type: 'integer' }, required: true }, pivots: { type: 'array', items: { type: 'integer' }, required: true }, comparisons: { type: 'integer', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 100, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_select', agent, async (trace) => { const { verifier, selected } = await engine(agent); const limit = explicitCandidateLimit(selected); if (args.candidates.length > limit)
            throw new Error('llm-verifier: candidates must contain at most ' + limit + ' entries'); const candidates = explicitEvidence(args.candidates, explicitItemChars(selected), explicitBudget(selected), 'candidates'); const stage = parseReviewStage(args.review_stage); const rubric = await stageRubric(stage, args.criteria); const criteria = rubric.criteria; const repeats = capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'); const pivots = capped(args.pivots, 2, Math.max(1, candidates.length), 'pivots'); const planned = selectComparisonsUpperBound(candidates.length, pivots) * criteria.length * repeats * selected.judges.length; if (planned > MAX_EXPLICIT_PLANNED_CALLS)
            throw new Error('llm-verifier: this selection would issue about ' + planned + ' judge calls (candidates x criteria x repeats x judges); reduce candidates, pivots, criteria, repeats or judges'); const result = await verifier.select({ problem: sanitizeVerifierText(args.problem, explicitItemChars(selected)), candidates, criteria, ...(rubric.groundTruthNote ? { groundTruthNote: rubric.groundTruthNote } : {}), repeats, pivots, seed: args.seed ?? 0, reviewStage: stage, domain: rubricDomain(rubric), images: await images(args.images, exec.signal), ...(trace ? { trace } : {}) }, exec.signal); return { result: { ...result, reviewStage: stage, criteriaSource: rubric.source }, selected }; }); } }));
    ctx.tools.register(defineTool({ name: 'verifier_track', description: 'Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.', parameters: { problem: { type: 'string', required: true }, steps: { type: 'array', items: { type: 'string' }, required: true }, checkpoints: { type: 'array', items: { type: 'integer' }, required: true }, repeats: commonParams.repeats, images: commonParams.images }, output: { schema: { type: 'object', additionalProperties: false, properties: { scores: { type: 'array', items: { type: 'number' }, required: true }, perRepeat: { type: 'array', items: { type: 'array', items: { type: 'number' } }, required: true }, diagnostics: diagnosticsSchema, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return record('verifier_track', agent, async (trace) => { const { verifier, selected } = await engine(agent); if (args.steps.length > MAX_TRACK_STEPS)
            throw new Error('llm-verifier: steps must contain at most ' + MAX_TRACK_STEPS + ' entries'); const steps = explicitEvidence(args.steps, explicitItemChars(selected), explicitBudget(selected), 'steps'); const result = await verifier.track(sanitizeVerifierText(args.problem, explicitItemChars(selected)), steps, args.checkpoints, capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats'), exec.signal, await images(args.images, exec.signal), trace); return { result, selected }; }); } }));
    ctx.tools.register(defineTool({
        name: 'verifier_best_of_n',
        description: 'Use ONLY when a final deliverable is expensive to get wrong and no candidate exists yet: this drafts n independent candidates with the current session model, has the independent verifier rank them, and then re-scores the winner against the same fixed empty-work baseline the automatic acceptance gate uses. A draft that hits its output ceiling is kept and listed in truncated — the judge sees the incomplete text and scores it as such, and discarding it would waste a generation already paid for. It is by far the most expensive verifier tool: on the default 3-criterion rubric it costs 2 generations + 12 judge calls at n=2, 3 + 24 at n=3, and 4 + 36..60 at n=4 — never call it per turn, for trivial questions, or to compare candidates you already have (rank those with verifier_select or verifier_compare). By default the tournament ranks the drafts with the proposal rubric (they are unexecuted text, so the artifact rubric would fail them by construction) while the winner-vs-baseline step keeps the configured delivery rubric; an explicit criteria applies to both. rankingStage/rankingCriteriaSource/baselineCriteriaSource report which rubric each phase used. scores are RELATIVE tournament shares; only score, criteria, threshold and passesThreshold are absolute and comparable with the acceptance gate. Requires a session whose model is already known; if the session has no logged request header, write the candidates with parallel subagents and call verifier_select instead.',
        parameters: {
            task: { type: 'string', required: true, description: 'The request every draft must answer. Bound to the explicit per-item evidence cap after redaction.' },
            n: { type: 'integer', description: 'How many independent drafts to generate; between 2 and 4, default 3. Cost grows with n.' },
            context: { type: 'string', description: 'Optional repository constraints, interfaces, file excerpts and known facts the drafts must respect. Redacted, per-item bounded and charged against the same explicit evidence budget as task. Every draft AND both judge comparisons see the identical block; omitted keeps the task-only input of earlier versions.' },
            criteria: commonParams.criteria,
            repeats: commonParams.repeats,
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    best: { type: 'string', required: true },
                    index: { type: 'integer', required: true },
                    rankingStage: { type: 'string', required: true },
                    rankingCriteriaSource: { type: 'string', required: true },
                    rankingCriteriaCount: { type: 'integer', required: true },
                    baselineCriteriaSource: { type: 'string', required: true },
                    baselineCriteriaCount: { type: 'integer', required: true },
                    contextIncluded: { type: 'boolean', required: true },
                    sources: { type: 'array', items: { type: 'integer' }, required: true },
                    scores: { type: 'array', items: { type: 'number' }, required: true },
                    ranking: { type: 'array', items: { type: 'integer' }, required: true },
                    comparisons: { type: 'integer', required: true },
                    pivots: { type: 'array', items: { type: 'integer' }, required: true },
                    generated: { type: 'integer', required: true },
                    failed: { type: 'integer', required: true },
                    failures: { type: 'array', items: { type: 'string' }, required: true },
                    truncated: { type: 'array', items: { type: 'integer' }, required: true },
                    score: { type: 'number', required: true },
                    baselineScore: { type: 'number', required: true },
                    winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true },
                    criteria: { type: 'array', items: criterionResultSchema, required: true },
                    threshold: { type: 'number', required: true },
                    passesThreshold: { type: 'boolean', required: true },
                    failedCriteria: { type: 'array', items: { type: 'string' }, required: true },
                    calls: { type: 'integer', required: true },
                    stats: { ...statsSchema, required: true },
                    generatorProvider: { type: 'string', required: true },
                    generatorModel: { type: 'string', required: true },
                    provider: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    judges: judgesSchema,
                },
            },
            render: (_args, value) => renderJson(value),
        },
        timeoutMs: entry.timeoutMs * 100,
        async execute(args, exec) {
            requireEnabled();
            const agent = requireAgent(exec.agent);
            return bestOfN(agent, args.task, args.n ?? DEFAULT_BEST_OF_N, args.repeats, exec.signal, args.criteria, args.context);
        },
    }));
    ctx.tools.register(defineTool({ name: 'verifier_current_session', description: 'Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.', parameters: { from_seq: { type: 'integer' }, to_seq: { type: 'integer' }, include_assistant_text: { type: 'boolean' }, redact_patterns: { type: 'array', items: { type: 'string' } }, max_chars: { type: 'integer' }, repeats: { type: 'integer' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { sessionId: { type: 'string', required: true }, problem: { type: 'string', required: true }, score: { type: 'number', required: true }, baselineScore: { type: 'number', required: true }, winner: { type: 'string', enum: ['A', 'B', 'tie'], required: true }, criteria: { type: 'array', items: acceptanceCriterionResultSchema, required: true }, diagnostics: diagnosticsSchema, fromSeq: { type: 'integer', required: true }, toSeq: { type: 'integer', required: true }, omittedCharacters: { type: 'integer', required: true }, agreement: { type: 'number', required: true }, calls: { type: 'integer', required: true }, stats: { ...statsSchema, required: true }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, judges: judgesSchema } }, render: (_args, value) => renderJson(value) }, timeoutMs: entry.timeoutMs * 20, async execute(args, exec) { requireEnabled(); const agent = requireAgent(exec.agent); return verifySession(agent, { fromSeq: args.from_seq, toSeq: args.to_seq, includeAssistantText: args.include_assistant_text, redactPatterns: args.redact_patterns, maxChars: args.max_chars === undefined ? undefined : capped(args.max_chars, 200000, MAX_SESSION_CHARS, 'max_chars'), repeats: capped(args.repeats, 2, MAX_EXPLICIT_REPEATS, 'repeats') }, exec.signal); } }));
}
//# sourceMappingURL=index.js.map