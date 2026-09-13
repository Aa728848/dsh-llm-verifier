import { extractScore } from "./core.js";
import { a as sessionAccepted } from "./auto-Cfx8dLfQ.js";
//#region src/replay.ts
function numberAt(row, key) {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
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
		out.push({
			toolName: typeof row.toolName === "string" ? row.toolName : "",
			startedAt: numberAt(row, "startedAt") ?? 0,
			success: row.success === true,
			criteria,
			...score !== void 0 ? { score } : {},
			...baselineScore !== void 0 ? { baselineScore } : {},
			...winner !== void 0 ? { winner } : {}
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
//#endregion
export { parseStatisticsRecords, replayDecisionScores, sweepThresholds };

//# sourceMappingURL=replay.js.map