import { extractScore } from "./core.js";
import { D as latestDirectUserSeq, N as semanticRouteHint, p as sessionAccepted, r as analyzeAutoTask, v as analyzeStructuredRoute, w as inspectDeliveryPhase } from "./auto-DpNooy0d.js";
//#region src/replay.ts
function numberAt(row, key) {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** Loose reader for one persisted route observation; an unknown shape is dropped, never fatal. */
function parseRouteObservation(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const row = value;
	if (typeof row.cycleId !== "string" || !row.cycleId || typeof row.trigger !== "string" || typeof row.stage !== "string" || typeof row.destination !== "string") return void 0;
	const observation = {
		cycleId: row.cycleId,
		trigger: row.trigger,
		stage: row.stage,
		destination: row.destination
	};
	for (const key of [
		"attempt",
		"reservedCalls",
		"evidenceKept",
		"evidenceOmitted",
		"evidenceChars"
	]) {
		const candidate = row[key];
		if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) observation[key] = Math.trunc(candidate);
	}
	if (typeof row.skipReason === "string" && row.skipReason) observation.skipReason = row.skipReason;
	for (const key of ["generatedCalls", "judgeCalls"]) {
		const candidate = row[key];
		if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) observation[key] = Math.trunc(candidate);
	}
	if (row.usageIncomplete === true) observation.usageIncomplete = true;
	if (row.canceled === true) observation.canceled = true;
	if (typeof row.replayed === "string" && row.replayed) observation.replayed = row.replayed;
	if (row.sameCandidate === true) observation.sameCandidate = true;
	if (row.alternativeAugmented === true) observation.alternativeAugmented = true;
	if (typeof row.alternativeModel === "string" && row.alternativeModel) observation.alternativeModel = row.alternativeModel;
	return observation;
}
/**
* Read one topic's statistics file into the records a threshold sweep can replay.
*
* Loose on purpose, exactly like the store's own loader: a record written by an older or newer
* plugin must not abort the replay. Records that carry no verdict (failed invocations) come back
* with no score, and the sweep reports them as unscored rather than as acceptances.
* @param text - raw `verifier/statistics-v1.json`.
* @returns The parsed invocations; an unreadable document yields an empty list.
*/
function parseStatisticsRecords(text) {
	let document;
	try {
		document = JSON.parse(text);
	} catch {
		return [];
	}
	const records = typeof document === "object" && document !== null ? document.records : void 0;
	if (!Array.isArray(records)) return [];
	const out = [];
	for (const entry of records) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry;
		const verdict = typeof row.verdict === "object" && row.verdict !== null ? row.verdict : {};
		const criteria = [];
		for (const item of Array.isArray(verdict.criteria) ? verdict.criteria : []) {
			if (typeof item !== "object" || item === null) continue;
			const criterion = item;
			if (typeof criterion.id !== "string") continue;
			const score = numberAt(criterion, "score");
			if (score !== void 0) criteria.push({
				id: criterion.id,
				score
			});
		}
		const score = numberAt(verdict, "score");
		const baselineScore = numberAt(verdict, "baselineScore");
		const winner = verdict.winner === "A" || verdict.winner === "B" || verdict.winner === "tie" ? verdict.winner : void 0;
		const outcome = typeof verdict.outcome === "string" && verdict.outcome ? verdict.outcome : void 0;
		const stats = typeof row.stats === "object" && row.stats !== null ? row.stats : {};
		const route = parseRouteObservation(row.route);
		out.push({
			toolName: typeof row.toolName === "string" ? row.toolName : "",
			startedAt: numberAt(row, "startedAt") ?? 0,
			success: row.success === true,
			calls: numberAt(stats, "calls") ?? 0,
			criteria,
			...score !== void 0 ? { score } : {},
			...baselineScore !== void 0 ? { baselineScore } : {},
			...winner !== void 0 ? { winner } : {},
			...outcome !== void 0 ? { outcome } : {},
			...route !== void 0 ? { route } : {}
		});
	}
	return out;
}
/**
* Re-score every recorded session acceptance at each threshold with the LIVE acceptance rule.
*
* This is the tuning tool the plan calls for: `autoVerifyThreshold` (and the per-criterion
* floor that {@link sessionAccepted} applies) is currently a hand-picked number with no evidence
* behind it. The stored verdict already carries the session score, the baseline score, the winner
* and the per-criterion scores — everything the gate looked at — so a sweep costs no model calls.
*
* Only `verifier_current_session` records are gate decisions; routed compare/select/track
* verdicts use different thresholds and are skipped.
* @param invocations - records from {@link parseStatisticsRecords}.
* @param thresholds - thresholds to test, typically 0.5..0.9.
* @returns One row per threshold, in the given order.
*/
function sweepThresholds(invocations, thresholds) {
	const gateRecords = invocations.filter((record) => record.toolName === "verifier_current_session");
	return thresholds.map((threshold) => {
		const row = {
			threshold,
			total: gateRecords.length,
			accepted: 0,
			rejectedVerdict: 0,
			rejectedMean: 0,
			rejectedCriterion: 0,
			unscored: 0
		};
		for (const record of gateRecords) {
			if (record.score === void 0 || record.winner === void 0) {
				row.unscored += 1;
				continue;
			}
			if (sessionAccepted({
				score: record.score,
				winner: record.winner,
				criteria: record.criteria
			}, threshold)) {
				row.accepted += 1;
				continue;
			}
			if (record.winner !== "A") row.rejectedVerdict += 1;
			else if (record.score < threshold) row.rejectedMean += 1;
			else row.rejectedCriterion += 1;
		}
		return row;
	});
}
/**
* Re-parse captured judge answers with the current score parser.
*
* A snapshot stores the raw answer, so the parser can be replayed offline: a pairwise call must
* parse back to exactly the score it produced, and a drift means the parser (or the prompt format)
* changed under a stored answer. A top-logprobs call's stored score is an expectation over a token
* distribution the snapshot does not keep, so a text-channel re-parse is expected to differ and is
* reported as drift — read those rows as informational, not as regressions.
*
* The tag depends on the call: pairwise judging answers `<score_A>`, while progress judging answers
* `<c1>..<cN>` and the trace stores the LAST checkpoint, inverted (progress runs A = nothing done
* .. T = certainly done, the reverse of the pairwise scale). A call with neither tag is a route
* classification, i.e. not a score at all.
* @param calls - captured calls with their raw answers.
* @returns One row per call.
*/
function replayDecisionScores(calls) {
	return calls.map((call) => {
		const completion = {
			text: call.output,
			tokens: [],
			positions: []
		};
		const progressTags = [...call.output.matchAll(/<c(\d+)>/gu)].map((match) => "<c" + match[1] + ">");
		const tagged = call.output.includes("<score_A>") || progressTags.length > 0;
		let reparsed;
		if (tagged) try {
			reparsed = call.output.includes("<score_A>") ? extractScore(completion, "<score_A>") : 1 - extractScore(completion, progressTags[progressTags.length - 1]);
		} catch {
			reparsed = void 0;
		}
		const head = {
			label: call.label,
			channel: call.channel,
			...call.score !== void 0 ? { stored: call.score } : {}
		};
		if (!tagged) return {
			...head,
			mode: "not-scored"
		};
		if (reparsed === void 0) return {
			...head,
			mode: "unreadable"
		};
		return {
			...head,
			reparsed,
			mode: call.score !== void 0 && Math.abs(call.score - reparsed) < 1e-9 ? "match" : "drift"
		};
	});
}
/**
* Summarize the automatic routing cycles recorded by S05-A.
*
* Every unit here is deliberately distinct: a CYCLE is not a model call, a diagnostic row is
* not a purchase, and a reserved call is not an actual one. The report exists so those three
* are never added together.
* @param invocations - records from parseStatisticsRecords.
* @returns Counts and shares across every observed cycle.
*/
function summarizeRouteCycles(invocations) {
	const routed = invocations.filter((record) => record.route !== void 0);
	const summary = {
		cycles: 0,
		classificationRows: 0,
		executionRows: 0,
		finalRows: 0,
		skippedRows: 0,
		classificationOnly: 0,
		canceled: 0,
		usageIncomplete: 0,
		preStepExecutions: 0,
		reservedCalls: 0,
		actualScoringCalls: 0,
		preStepShare: 0,
		classificationOnlyShare: 0,
		byTrigger: {},
		byDestination: {},
		bySkipReason: {}
	};
	const cycles = /* @__PURE__ */ new Set();
	const reservedByCycle = /* @__PURE__ */ new Map();
	for (const record of routed) {
		const route = record.route;
		cycles.add(route.cycleId);
		summary.byTrigger[route.trigger] = (summary.byTrigger[route.trigger] ?? 0) + 1;
		summary.byDestination[route.destination] = (summary.byDestination[route.destination] ?? 0) + 1;
		if (route.skipReason !== void 0) summary.bySkipReason[route.skipReason] = (summary.bySkipReason[route.skipReason] ?? 0) + 1;
		reservedByCycle.set(route.cycleId, Math.max(reservedByCycle.get(route.cycleId) ?? 0, route.reservedCalls ?? 0));
		if (route.canceled === true) summary.canceled += 1;
		if (route.usageIncomplete === true) summary.usageIncomplete += 1;
		if (route.skipReason === "classification-only-budget") summary.classificationOnly += 1;
		if (route.stage === "classification") summary.classificationRows += 1;
		else if (route.stage === "execution") {
			summary.executionRows += 1;
			summary.actualScoringCalls += record.calls;
			if (route.trigger === "pre-step") summary.preStepExecutions += 1;
		} else if (route.stage === "final") {
			summary.finalRows += 1;
			summary.actualScoringCalls += record.calls;
		} else if (route.stage === "skipped") summary.skippedRows += 1;
	}
	summary.cycles = cycles.size;
	summary.reservedCalls = [...reservedByCycle.values()].reduce((total, value) => total + value, 0);
	summary.preStepShare = summary.executionRows > 0 ? summary.preStepExecutions / summary.executionRows : 0;
	summary.classificationOnlyShare = summary.classificationRows > 0 ? summary.classificationOnly / summary.classificationRows : 0;
	return summary;
}
/**
* Summarize the recorded P06 cycles.
*
* Reads only what the rows state: `replayed` is the delivery, not the decision, and a cycle whose
* winner was withheld is therefore counted as an original replay (the plugin corrects that row for
* exactly this reason). Rates are 0 when their denominator is 0, never NaN.
* @param invocations - records from parseStatisticsRecords.
* @returns Counts, arm split and rates across every observed process cycle.
*/
function summarizeProcessCycles(invocations) {
	const rows = invocations.filter((record) => record.route !== void 0 && record.route.destination === "process");
	const summary = {
		purchased: 0,
		skipped: 0,
		byOutcome: {},
		bySkipReason: {},
		replayedOriginal: 0,
		replayedCandidate: 0,
		replayedNone: 0,
		effectiveReplacementRate: 0,
		sameCandidate: 0,
		sameCandidateRate: 0,
		augmented: 0,
		augmentedReplacementRate: 0,
		plainReplacementRate: 0,
		addedCalls: 0,
		generatedCalls: 0,
		judgeCalls: 0
	};
	let augmentedReplays = 0;
	let plainPurchased = 0;
	let plainReplays = 0;
	for (const record of rows) {
		const route = record.route;
		if (route.stage === "skipped") {
			summary.skipped += 1;
			const reason = route.skipReason ?? "unknown";
			summary.bySkipReason[reason] = (summary.bySkipReason[reason] ?? 0) + 1;
			continue;
		}
		summary.purchased += 1;
		summary.addedCalls += record.calls;
		summary.generatedCalls += route.generatedCalls ?? 0;
		summary.judgeCalls += route.judgeCalls ?? 0;
		const outcome = record.outcome ?? "unknown";
		summary.byOutcome[outcome] = (summary.byOutcome[outcome] ?? 0) + 1;
		if (route.replayed === "candidate") summary.replayedCandidate += 1;
		else if (route.replayed === "none") summary.replayedNone += 1;
		else summary.replayedOriginal += 1;
		if (route.sameCandidate === true) summary.sameCandidate += 1;
		if (route.alternativeAugmented === true) {
			summary.augmented += 1;
			if (route.replayed === "candidate") augmentedReplays += 1;
		} else {
			plainPurchased += 1;
			if (route.replayed === "candidate") plainReplays += 1;
		}
	}
	summary.effectiveReplacementRate = summary.purchased > 0 ? summary.replayedCandidate / summary.purchased : 0;
	summary.sameCandidateRate = summary.purchased > 0 ? summary.sameCandidate / summary.purchased : 0;
	summary.augmentedReplacementRate = summary.augmented > 0 ? augmentedReplays / summary.augmented : 0;
	summary.plainReplacementRate = plainPurchased > 0 ? plainReplays / plainPurchased : 0;
	return summary;
}
/** Sample strata the labeled evaluation must cover (the plan six groups). */
const EVALUATION_CATEGORIES = [
	"code",
	"research",
	"writing",
	"candidates",
	"long-task",
	"conversational"
];
const DEFAULT_EVALUATION_POLICY = {
	mode: "smart",
	minToolCalls: 3,
	maxPerTask: 2,
	maxPerSession: 8,
	threshold: .65
};
/**
* Run the deterministic routing layers over one labeled sample.
*
* Uses the PRODUCTION detectors (structured route, semantic hint, delivery phase, eligibility)
* instead of a reimplementation, so the offline numbers cannot drift from the shipped
* scheduling. It never calls a model: a semantic hint is only a hint, and whether the
* classifier would really route is a question for the real-model comparison.
* @param sample - labeled sample.
* @param policy - eligibility policy; defaults to the shipped smart defaults.
* @returns What the strategy would do.
*/
function evaluateSample(sample, policy = DEFAULT_EVALUATION_POLICY) {
	const events = sample.events;
	const observedPhases = [];
	let observedTrigger = false;
	if (latestDirectUserSeq(events) !== void 0) {
		const decision = analyzeStructuredRoute(events, 8, 2e4, 6e4);
		if (decision !== void 0) {
			observedTrigger = true;
			observedPhases.push(decision.kind);
		} else if (semanticRouteHint(events)) {
			observedTrigger = true;
			observedPhases.push("semantic");
		}
	}
	const delivery = inspectDeliveryPhase(events);
	const deliveryReady = delivery !== void 0 && delivery.todosComplete && delivery.verification !== void 0;
	const eligible = analyzeAutoTask(events, policy).eligible;
	if (eligible) {
		observedPhases.push("final");
		observedTrigger = true;
	}
	const outcome = sample.shouldReview ? observedTrigger ? "hit" : "miss" : observedTrigger ? "false-trigger" : "correct-skip";
	return {
		id: sample.id,
		category: sample.category,
		expectedReview: sample.shouldReview,
		observedTrigger,
		observedPhases,
		deliveryReady,
		eligible,
		outcome
	};
}
function ratio(numerator, denominator) {
	return denominator > 0 ? numerator / denominator : 0;
}
/**
* Aggregate the labeled evaluation.
*
* Precision/recall are reported together with the sample counts and the per-category breakdown,
* because a 30-sample set cannot establish a low false-accept rate on its own.
* @param samples - labeled samples.
* @param policy - eligibility policy.
* @returns Trigger precision/recall, per-category counts and per-phase coverage.
*/
function summarizeEvaluation(samples, policy = DEFAULT_EVALUATION_POLICY) {
	const outcomes = samples.map((sample) => evaluateSample(sample, policy));
	const hits = outcomes.filter((entry) => entry.outcome === "hit").length;
	const misses = outcomes.filter((entry) => entry.outcome === "miss").length;
	const falseTriggers = outcomes.filter((entry) => entry.outcome === "false-trigger").length;
	const correctSkips = outcomes.filter((entry) => entry.outcome === "correct-skip").length;
	const byCategory = EVALUATION_CATEGORIES.map((category) => {
		const rows = outcomes.filter((entry) => entry.category === category);
		return {
			category,
			samples: rows.length,
			hits: rows.filter((entry) => entry.outcome === "hit").length,
			misses: rows.filter((entry) => entry.outcome === "miss").length,
			falseTriggers: rows.filter((entry) => entry.outcome === "false-trigger").length,
			correctSkips: rows.filter((entry) => entry.outcome === "correct-skip").length
		};
	});
	const phaseMatches = [
		"compare",
		"select",
		"track",
		"final"
	].map((phase) => ({
		phase,
		expected: samples.filter((sample) => sample.expectedPhases?.includes(phase) === true).length,
		observed: outcomes.filter((entry) => entry.observedPhases.includes(phase)).length
	}));
	return {
		samples: samples.length,
		hits,
		misses,
		falseTriggers,
		correctSkips,
		precision: ratio(hits, hits + falseTriggers),
		recall: ratio(hits, hits + misses),
		byCategory,
		phaseMatches,
		outcomes
	};
}
/** Loose reader for one labeled sample file entry. */
function parseEvaluationSample(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const row = value;
	if (typeof row.id !== "string" || !row.id || !EVALUATION_CATEGORIES.includes(row.category) || typeof row.shouldReview !== "boolean" || !Array.isArray(row.events)) return void 0;
	const expected = Array.isArray(row.expectedPhases) ? row.expectedPhases.filter((phase) => phase === "compare" || phase === "select" || phase === "track" || phase === "final") : void 0;
	return {
		id: row.id,
		category: row.category,
		events: row.events,
		shouldReview: row.shouldReview,
		...expected === void 0 ? {} : { expectedPhases: expected }
	};
}
//#endregion
export { EVALUATION_CATEGORIES, evaluateSample, parseEvaluationSample, parseRouteObservation, parseStatisticsRecords, replayDecisionScores, summarizeEvaluation, summarizeProcessCycles, summarizeRouteCycles, sweepThresholds };

//# sourceMappingURL=replay.js.map