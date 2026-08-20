import { a as TopLogprobCapabilityCache, i as emptyUsage, n as addUsage, r as callVerifier, t as RequestLimiter } from "./caller-BXrUTAoL.js";
import { DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, GRANULARITY, LETTERS, SCALE_DESCRIPTION, accumulatePairs, bradleyTerry, buildPairwisePrompt, buildProgressPrompt, extractProgressScore, extractScore, normalizeScoreLetter, pivotRoundPairs, rankScores, ringCycle, seededRandom, topPivots } from "./core.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
//#region src/config.ts
const VERIFIER_SETTINGS_NAMESPACE = settingsNamespace("llm-verifier");
const Config = z.object({
	enabled: z.boolean().default(true),
	autoVerifyMode: z.union([
		"manual",
		"smart",
		"strict"
	]).default("smart"),
	autoVerifyThreshold: z.number().min(0).max(1).default(.65),
	autoVerifyRepeats: z.number().step(1).min(1).default(1),
	autoVerifyMinToolCalls: z.number().step(1).min(1).default(3),
	autoVerifyMaxChars: z.number().step(1).min(1e3).default(8e4),
	autoVerifyMaxPerTask: z.number().step(1).min(1).default(2),
	autoVerifyMaxPerSession: z.number().step(1).min(1).default(8),
	provider: z.string().default("deepseek-official"),
	model: z.string().default("deepseek-v4-flash"),
	reasoningEffort: z.string(),
	maxTokens: z.number().step(1).min(1).default(32768),
	timeoutMs: z.number().step(1).min(1).default(3e5),
	maxConcurrency: z.number().step(1).min(1).default(8),
	maxRetries: z.number().step(1).min(0).default(3),
	retryBaseDelayMs: z.number().step(1).min(1).default(500),
	cacheDir: z.string().default(".dsh-verifier-cache"),
	cacheMaxEntries: z.number().step(1).min(1).default(1e4),
	estimatedInputUsdPerMillion: z.number().min(0).default(0),
	estimatedOutputUsdPerMillion: z.number().min(0).default(0)
});
function resolveConfig(config = {}) {
	const provider = (config.provider ?? "deepseek-official").trim();
	const model = (config.model ?? "deepseek-v4-flash").trim();
	if (!provider) throw new Error("llm-verifier: provider must be non-empty");
	if (!model) throw new Error("llm-verifier: model must be non-empty");
	const autoVerifyMode = config.autoVerifyMode ?? "smart";
	if (![
		"manual",
		"smart",
		"strict"
	].includes(autoVerifyMode)) throw new Error("llm-verifier: autoVerifyMode must be manual, smart, or strict");
	const autoVerifyThreshold = config.autoVerifyThreshold ?? .65;
	if (!Number.isFinite(autoVerifyThreshold) || autoVerifyThreshold < 0 || autoVerifyThreshold > 1) throw new Error("llm-verifier: autoVerifyThreshold must be between 0 and 1");
	const values = {
		autoVerifyRepeats: config.autoVerifyRepeats ?? 1,
		autoVerifyMinToolCalls: config.autoVerifyMinToolCalls ?? 3,
		autoVerifyMaxChars: config.autoVerifyMaxChars ?? 8e4,
		autoVerifyMaxPerTask: config.autoVerifyMaxPerTask ?? 2,
		autoVerifyMaxPerSession: config.autoVerifyMaxPerSession ?? 8,
		maxTokens: config.maxTokens ?? 32768,
		timeoutMs: config.timeoutMs ?? 3e5,
		maxConcurrency: config.maxConcurrency ?? 8,
		retryBaseDelayMs: config.retryBaseDelayMs ?? 500,
		cacheMaxEntries: config.cacheMaxEntries ?? 1e4
	};
	for (const [name, value] of Object.entries(values)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("llm-verifier: " + name + " must be a positive safe integer");
	if (values.autoVerifyMaxChars < 1e3) throw new Error("llm-verifier: autoVerifyMaxChars must be at least 1000");
	const maxRetries = config.maxRetries ?? 3;
	if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error("llm-verifier: maxRetries must be a non-negative safe integer");
	const cacheDir = (config.cacheDir ?? ".dsh-verifier-cache").trim();
	if (!cacheDir) throw new Error("llm-verifier: cacheDir must be non-empty");
	const estimatedInputUsdPerMillion = config.estimatedInputUsdPerMillion ?? 0;
	const estimatedOutputUsdPerMillion = config.estimatedOutputUsdPerMillion ?? 0;
	if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("llm-verifier: estimated token prices must be finite non-negative numbers");
	const reasoningEffort = config.reasoningEffort?.trim();
	return {
		enabled: config.enabled ?? true,
		autoVerifyMode,
		autoVerifyThreshold,
		provider,
		model,
		...reasoningEffort ? { reasoningEffort } : {},
		maxRetries,
		cacheDir,
		estimatedInputUsdPerMillion,
		estimatedOutputUsdPerMillion,
		...values
	};
}
function installVerifierSettings(ctx, entry, onChange) {
	let source = () => entry;
	installSettingsSection(ctx, VERIFIER_SETTINGS_NAMESPACE, Config, entry, {
		setSource(current) {
			source = current;
		},
		onChange,
		validate(value) {
			resolveConfig(value);
		}
	});
	return () => resolveConfig(source());
}
//#endregion
//#region src/cache.ts
function stableHash(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function resolveCacheFile(cacheDir, cwd = process.cwd()) {
	return join(isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir), "scores-v1.json");
}
var ScoreCache = class {
	file;
	maxEntries;
	loaded = false;
	entries = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	writing = Promise.resolve();
	constructor(file, maxEntries) {
		this.file = file;
		this.maxEntries = maxEntries;
	}
	async load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const document = JSON.parse(await readFile(this.file, "utf8"));
			if (document.version !== 1 || typeof document.entries !== "object" || document.entries === null) return;
			this.entries = new Map(Object.entries(document.entries).map(([key, value]) => [key, {
				...value,
				scoringMode: value.scoringMode ?? "explicit-tag"
			}]));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	async getOrCreate(key, create) {
		await this.load();
		const cached = this.entries.get(key);
		if (cached !== void 0) return {
			value: cached,
			hit: true
		};
		const existing = this.inflight.get(key);
		if (existing !== void 0) return {
			value: await existing,
			hit: true
		};
		const pending = create();
		this.inflight.set(key, pending);
		try {
			const value = await pending;
			this.entries.set(key, value);
			this.trim();
			await this.persist();
			return {
				value,
				hit: false
			};
		} finally {
			this.inflight.delete(key);
		}
	}
	trim() {
		if (this.entries.size <= this.maxEntries) return;
		const sorted = [...this.entries].sort((a, b) => a[1].createdAt - b[1].createdAt);
		for (let index = 0; index < sorted.length - this.maxEntries; index += 1) this.entries.delete(sorted[index][0]);
	}
	async persist() {
		const snapshot = {
			version: 1,
			entries: Object.fromEntries(this.entries)
		};
		this.writing = this.writing.then(async () => {
			await mkdir(dirname(this.file), { recursive: true });
			const temporary = this.file + ".tmp-" + process.pid;
			await writeFile(temporary, JSON.stringify(snapshot), "utf8");
			try {
				await rename(temporary, this.file);
			} catch (error) {
				await unlink(temporary).catch(() => {});
				throw error;
			}
		});
		await this.writing;
	}
};
//#endregion
//#region src/engine.ts
function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
}
function blankStats() {
	return {
		...emptyUsage(),
		cacheHits: 0,
		cacheMisses: 0,
		estimatedCostUsd: 0,
		topLogprobScores: 0,
		explicitTagScores: 0
	};
}
var VerifierEngine = class {
	client;
	maxConcurrency;
	cache;
	inputPrice;
	outputPrice;
	constructor(client, maxConcurrency = 8, cache, prices = {
		input: 0,
		output: 0
	}) {
		this.client = client;
		this.maxConcurrency = maxConcurrency;
		this.cache = cache;
		this.inputPrice = prices.input;
		this.outputPrice = prices.output;
	}
	finishStats(stats) {
		stats.estimatedCostUsd = ((stats.inputTokens + stats.cachedInputTokens) * this.inputPrice + stats.outputTokens * this.outputPrice) / 1e6;
		return stats;
	}
	async scoreOne(options, candidateA, candidateB, criterion, repeat, signal) {
		const ground = options.groundTruthNote ?? "**IMPORTANT:** Focus on observed tool and terminal output as ground truth. Do NOT trust the agent's self-assessment or claims of success.";
		const prompt = buildPairwisePrompt(options.problem, candidateA, candidateB, criterion, ground);
		const imageKey = options.images?.map((image) => stableHash([image.mediaType, Buffer.from(image.data).toString("base64")]));
		const key = stableHash({
			version: 2,
			scoringPolicy: "auto-top-logprobs",
			provider: this.client.provider,
			model: this.client.model,
			effort: this.client.reasoningEffort,
			maxTokens: this.client.maxTokens,
			problem: options.problem,
			candidateA,
			candidateB,
			criterion,
			ground,
			repeat,
			imageKey
		});
		const create = async () => {
			const completion = await callVerifier(this.client, prompt, signal, options.images);
			return {
				scoreA: extractScore(completion, "<score_A>"),
				scoreB: extractScore(completion, "<score_B>"),
				usage: completion.usage,
				scoringMode: completion.scoringMode,
				createdAt: Date.now()
			};
		};
		if (this.cache === void 0) {
			const value = await create();
			return {
				scores: [value.scoreA, value.scoreB],
				usage: value.usage,
				scoringMode: value.scoringMode,
				hit: false
			};
		}
		const cached = await this.cache.getOrCreate(key, create);
		return {
			scores: [cached.value.scoreA, cached.value.scoreB],
			usage: cached.hit ? emptyUsage() : cached.value.usage,
			scoringMode: cached.value.scoringMode,
			hit: cached.hit
		};
	}
	async mapLimited(items, worker) {
		const results = new Array(items.length);
		let cursor = 0;
		const runners = Array.from({ length: Math.min(this.maxConcurrency, items.length) }, async () => {
			while (cursor < items.length) {
				const index = cursor++;
				results[index] = await worker(items[index]);
			}
		});
		await Promise.all(runners);
		return results;
	}
	async compare(options, signal) {
		const criteria = options.criteria?.length ? options.criteria : DEFAULT_CRITERIA;
		const repeats = options.repeats ?? 2;
		const jobs = criteria.flatMap((criterion) => Array.from({ length: repeats }, (_, repeat) => ({
			criterion,
			repeat
		})));
		const warm = jobs.slice(0, 1);
		const rest = jobs.slice(1);
		const run = async (batch) => this.mapLimited(batch, async ({ criterion, repeat }) => {
			const swapped = repeat % 2 === 1;
			const result = await this.scoreOne(options, swapped ? options.candidateB : options.candidateA, swapped ? options.candidateA : options.candidateB, criterion, repeat, signal);
			return {
				criterion,
				scoreA: swapped ? result.scores[1] : result.scores[0],
				scoreB: swapped ? result.scores[0] : result.scores[1],
				usage: result.usage,
				scoringMode: result.scoringMode,
				hit: result.hit
			};
		});
		const values = [...await run(warm), ...await run(rest)];
		const stats = blankStats();
		for (const value of values) {
			addUsage(stats, value.usage);
			value.hit ? stats.cacheHits++ : stats.cacheMisses++;
			value.scoringMode === "top-logprobs" ? stats.topLogprobScores++ : stats.explicitTagScores++;
		}
		const byCriterion = criteria.map((criterion) => {
			const rows = values.filter((value) => value.criterion.id === criterion.id);
			return {
				id: criterion.id,
				name: criterion.name,
				scoreA: average(rows.map((row) => row.scoreA)),
				scoreB: average(rows.map((row) => row.scoreB))
			};
		});
		const scoreA = average(byCriterion.map((value) => value.scoreA));
		const scoreB = average(byCriterion.map((value) => value.scoreB));
		return {
			scoreA,
			scoreB,
			winner: Math.abs(scoreA - scoreB) < 1e-12 ? "tie" : scoreA > scoreB ? "A" : "B",
			criteria: byCriterion,
			calls: stats.calls,
			stats: this.finishStats(stats)
		};
	}
	async scorePairs(options, pairs, signal) {
		const unique = [...new Map(pairs.map((pair) => [pair[0] + "," + pair[1], pair])).values()];
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
				images: options.images
			}, signal)
		}));
		const rewards = /* @__PURE__ */ new Map();
		const stats = blankStats();
		for (const value of values) {
			rewards.set(value.a + "," + value.b, [value.result.scoreA, value.result.scoreB]);
			addUsage(stats, value.result.stats);
			stats.cacheHits += value.result.stats.cacheHits;
			stats.cacheMisses += value.result.stats.cacheMisses;
			stats.topLogprobScores += value.result.stats.topLogprobScores;
			stats.explicitTagScores += value.result.stats.explicitTagScores;
		}
		return {
			rewards,
			stats: this.finishStats(stats)
		};
	}
	async track(problem, steps, checkpoints, repeats = 2, signal, images) {
		if (!steps.length || !checkpoints.length) throw new Error("llm-verifier: steps and checkpoints must not be empty");
		for (const checkpoint of checkpoints) if (!Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > steps.length) throw new Error("llm-verifier: each checkpoint must be an integer between 1 and steps.length");
		const prompt = buildProgressPrompt(problem, steps, checkpoints);
		const completions = await this.mapLimited(Array.from({ length: repeats }, (_, index) => index), async () => callVerifier(this.client, prompt, signal, images));
		const stats = blankStats();
		for (const completion of completions) {
			addUsage(stats, completion.usage);
			completion.scoringMode === "top-logprobs" ? stats.topLogprobScores++ : stats.explicitTagScores++;
		}
		const runs = completions.map((completion) => checkpoints.map((_, index) => extractProgressScore(completion, "<c" + (index + 1) + ">")));
		return {
			scores: checkpoints.map((_, index) => average(runs.map((run) => run[index]))),
			perRepeat: runs,
			calls: stats.calls,
			stats: this.finishStats(stats)
		};
	}
	async select(options, signal) {
		if (!options.candidates.length) throw new Error("llm-verifier: candidates must not be empty");
		if (options.candidates.length === 1) return {
			index: 0,
			best: options.candidates[0],
			scores: [1],
			ranking: [0],
			pivots: [0],
			comparisons: 0,
			calls: 0,
			stats: blankStats()
		};
		const ring = ringCycle(options.candidates.length, options.seed ?? 0);
		const ringScores = await this.scorePairs(options, ring, signal);
		const firstWins = new Array(options.candidates.length).fill(0);
		const firstCounts = new Array(options.candidates.length).fill(0);
		accumulatePairs(ring, ringScores.rewards, firstWins, firstCounts);
		const pivots = topPivots(firstWins, firstCounts, options.pivots ?? 2);
		const rounds = pivotRoundPairs(options.candidates.length, pivots);
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
		return {
			index,
			best: options.candidates[index],
			scores: Array.from({ length: options.candidates.length }, (_, candidate) => wins[candidate] / (counts[candidate] || 1)),
			ranking: ranked.map((value) => value.index),
			pivots,
			comparisons: ring.length + rounds.length,
			calls: stats.calls,
			stats: this.finishStats(stats)
		};
	}
};
function normalizeCriteria(input) {
	if (input === void 0) return DEFAULT_CRITERIA;
	if (!Array.isArray(input) || !input.length) throw new Error("llm-verifier: criteria must be a non-empty array");
	return input.map((value, index) => {
		if (typeof value !== "object" || value === null) throw new Error("llm-verifier: criteria[" + index + "] must be an object");
		const row = value;
		for (const key of [
			"id",
			"name",
			"description"
		]) if (typeof row[key] !== "string" || row[key].trim().length === 0) throw new Error("llm-verifier: criteria[" + index + "]." + key + " must be non-empty");
		return {
			id: String(row.id),
			name: String(row.name),
			description: String(row.description)
		};
	});
}
//#endregion
//#region src/images.ts
const TYPES = /* @__PURE__ */ new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
function parseDataUrl(value) {
	const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
	if (!match) return void 0;
	const data = Buffer.from(match[2].replace(/\s/g, ""), "base64");
	if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("llm-verifier: image exceeds 20 MiB");
	return {
		mediaType: match[1].toLowerCase(),
		data
	};
}
async function loadVerifierImages(inputs, signal) {
	const images = [];
	for (const input of inputs ?? []) {
		const data = parseDataUrl(input);
		if (data !== void 0) {
			images.push(data);
			continue;
		}
		let url;
		try {
			url = new URL(input);
		} catch {
			throw new Error("llm-verifier: images accept only HTTPS URLs or data:image/...;base64 URLs");
		}
		if (url.protocol !== "https:") throw new Error("llm-verifier: remote images must use HTTPS");
		const response = await fetch(url, {
			redirect: "error",
			signal
		});
		if (!response.ok) throw new Error("llm-verifier: image fetch returned HTTP " + response.status);
		const type = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
		if (!TYPES.has(type)) throw new Error("llm-verifier: unsupported image media type " + type);
		if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("llm-verifier: image exceeds 20 MiB");
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("llm-verifier: image exceeds 20 MiB");
		images.push({
			mediaType: type,
			data: bytes
		});
	}
	return images;
}
//#endregion
//#region src/session.ts
function textOf(blocks) {
	const parts = [];
	for (const block of blocks) if (block.type === "text") parts.push(block.text);
	else if (block.type === "reasoning") parts.push("[Reasoning] " + block.text);
	else if (block.type === "tool-call") parts.push("[Tool Call] " + block.name + " " + block.arguments);
	else if (block.type === "tool-result") parts.push("[Tool Result] " + textOf(block.content));
	return parts.join("\n");
}
function redact(text, patterns) {
	let result = text;
	for (const pattern of patterns) {
		let regex;
		try {
			regex = new RegExp(pattern, "giu");
		} catch {
			throw new Error("llm-verifier: invalid redact pattern: " + pattern);
		}
		result = result.replace(regex, "[REDACTED]");
	}
	return result;
}
async function extractSession(agent, loadImage, options = {}) {
	const all = agent.session.events;
	const from = options.fromSeq ?? 0;
	const to = options.toSeq ?? Number.MAX_SAFE_INTEGER;
	const events = all.filter((event) => event.seq >= from && event.seq <= to);
	const patterns = [...["Bearers+[A-Za-z0-9._~+/=-]+", "(?:api[_-]?key|token|password|secret)s*[:=]s*[^s,;]+"], ...options.redactPatterns ?? []];
	let problem = "";
	const trace = [];
	const images = [];
	for (const event of events) if (event.type === "user/message") {
		if (event.data.source.kind !== "user") continue;
		const text = textOf(event.data.content);
		if (!problem && text.trim()) problem = text.trim();
		for (const block of event.data.content) if (block.type === "image") images.push(await loadImage(block.attachment));
		trace.push("--- User seq " + event.seq + " ---\n" + text);
	} else if (event.type === "assistant/message" && options.includeAssistantText !== false) trace.push("--- Assistant turn " + event.data.turn + " step " + event.data.step + " ---\n" + textOf(event.data.message.content));
	else if (event.type === "tool/call") trace.push("--- Tool Call turn " + event.data.turn + " step " + event.data.step + " ---\n[Command] " + event.data.name + " " + event.data.arguments);
	else if (event.type === "tool/result") trace.push("--- Tool Result turn " + event.data.turn + " step " + event.data.step + " ---\n[Output] " + textOf(event.data.message.content));
	const raw = redact(trace.join("\n\n"), patterns);
	const maxChars = options.maxChars ?? 2e5;
	const omittedCharacters = Math.max(0, raw.length - maxChars);
	const bounded = omittedCharacters ? "[Earlier trace truncated: " + omittedCharacters + " characters omitted]\n" + raw.slice(-maxChars) : raw;
	return {
		problem: redact(problem, patterns),
		trace: bounded,
		images,
		sessionId: String(agent.id),
		fromSeq: events[0]?.seq ?? from,
		toSeq: events.at(-1)?.seq ?? from,
		omittedCharacters
	};
}
//#endregion
//#region src/auto.ts
const PASSIVE_TOOLS = /* @__PURE__ */ new Set([
	"read",
	"read_image",
	"glob",
	"grep",
	"web_search",
	"ssh_list",
	"job_list",
	"job_output",
	"list_agents",
	"get_goal",
	"skill",
	"mcp__codegraph__codegraph_explore"
]);
const VERIFIER_TOOLS = /* @__PURE__ */ new Set([
	"verifier_compare",
	"verifier_select",
	"verifier_track",
	"verifier_current_session"
]);
const CONSEQUENTIAL_TOOLS = /* @__PURE__ */ new Set([
	"edit",
	"write",
	"pwsh",
	"bash",
	"run_code",
	"codex_image_generate",
	"ssh_exec",
	"ssh_upload",
	"ssh_download",
	"ssh_tunnel",
	"ssh_cluster",
	"job_kill",
	"workbench_session_delete",
	"create_goal",
	"update_goal"
]);
function latestDirectUserSeq(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type === "user/message" && event.data.source.kind === "user") return event.seq;
	}
}
function isConsequential(name) {
	if (CONSEQUENTIAL_TOOLS.has(name)) return true;
	if (PASSIVE_TOOLS.has(name) || VERIFIER_TOOLS.has(name)) return false;
	return /(?:edit|write|patch|apply|deploy|upload|delete|remove|kill|exec|shell|command|migration|database|tunnel|cluster)/iu.test(name);
}
function analyzeAutoTask(events, policy) {
	const taskStartSeq = latestDirectUserSeq(events);
	if (taskStartSeq === void 0) return {
		taskStartSeq: 0,
		toolCalls: 0,
		completedToolResults: 0,
		consequentialToolCalls: 0,
		hasManualSessionVerification: false,
		eligible: false,
		reason: "no-direct-user-task"
	};
	const relevant = events.filter((event) => event.seq >= taskStartSeq);
	const calls = relevant.filter((event) => event.type === "tool/call");
	const toolCalls = calls.filter((event) => !VERIFIER_TOOLS.has(event.data.name)).length;
	const completedToolResults = relevant.filter((event) => event.type === "tool/result" && event.data.error === void 0 && event.data.message.content.every((block) => block.isError !== true)).length;
	const consequentialToolCalls = calls.filter((event) => isConsequential(event.data.name)).length;
	const hasManualSessionVerification = calls.some((event) => event.data.name === "verifier_current_session");
	if (policy.mode === "manual") return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: false,
		reason: "manual-mode"
	};
	if (hasManualSessionVerification) return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: false,
		reason: "already-verified"
	};
	if (consequentialToolCalls === 0) return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: false,
		reason: "no-consequential-work"
	};
	if (completedToolResults === 0) return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: false,
		reason: "no-completed-evidence"
	};
	if (policy.mode === "smart" && toolCalls < policy.minToolCalls) return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: false,
		reason: "insufficient-tool-evidence"
	};
	return {
		taskStartSeq,
		toolCalls,
		completedToolResults,
		consequentialToolCalls,
		hasManualSessionVerification,
		eligible: true,
		reason: policy.mode + "-eligible"
	};
}
var AutoVerificationBudget = class {
	states = /* @__PURE__ */ new Map();
	claim(agent, evidence, policy) {
		if (!evidence.eligible) return false;
		const id = String(agent.id);
		const state = this.states.get(id) ?? {
			taskStartSeq: evidence.taskStartSeq,
			taskAttempts: 0,
			sessionAttempts: 0,
			lastEvaluatedSeq: -1
		};
		if (state.taskStartSeq !== evidence.taskStartSeq) {
			state.taskStartSeq = evidence.taskStartSeq;
			state.taskAttempts = 0;
			state.lastEvaluatedSeq = -1;
		}
		const lastSeq = agent.session.events.at(-1)?.seq ?? -1;
		if (lastSeq <= state.lastEvaluatedSeq || state.taskAttempts >= policy.maxPerTask || state.sessionAttempts >= policy.maxPerSession) {
			this.states.set(id, state);
			return false;
		}
		state.taskAttempts += 1;
		state.sessionAttempts += 1;
		state.lastEvaluatedSeq = lastSeq;
		this.states.set(id, state);
		return true;
	}
	release(agent) {
		this.states.delete(String(agent.id));
	}
};
function automaticFeedback(score, baselineScore, winner, threshold) {
	const percent = (value) => (value * 100).toFixed(1) + "%";
	return [
		"[Automatic verifier gate]",
		`The independent verifier did not clear this task for completion: evidence score ${percent(score)}, baseline ${percent(baselineScore)}, verdict ${winner}, required ${percent(threshold)}.`,
		"Re-open the task requirements, inspect the actual tool outputs for unresolved errors or missing proof, make any necessary corrections, and run a directly relevant verification command before concluding. Do not merely restate that the task is complete."
	].join("\n");
}
//#endregion
//#region src/statistics.ts
const VERIFIER_TOOL_NAMES = [
	"verifier_compare",
	"verifier_select",
	"verifier_track",
	"verifier_current_session"
];
function ratio(numerator, denominator) {
	return denominator > 0 ? numerator / denominator : 0;
}
function tokens(stats) {
	return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens;
}
function cleanError(value) {
	return value === void 0 ? void 0 : value.slice(0, 500);
}
function blankTotals() {
	return {
		invocations: 0,
		successes: 0,
		failures: 0,
		successRate: 0,
		averageDurationMs: 0,
		calls: 0,
		attempts: 0,
		retries: 0,
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		tokens: 0,
		cacheHits: 0,
		cacheMisses: 0,
		cacheHitRate: 0,
		estimatedCostUsd: 0,
		topLogprobScores: 0,
		explicitTagScores: 0
	};
}
function addRecord(target, record) {
	const stats = record.stats;
	target.invocations += 1;
	record.success ? target.successes += 1 : target.failures += 1;
	target.averageDurationMs += record.durationMs;
	target.calls += stats.calls;
	target.attempts += stats.attempts;
	target.retries += stats.retries;
	target.inputTokens += stats.inputTokens;
	target.cachedInputTokens += stats.cachedInputTokens;
	target.outputTokens += stats.outputTokens;
	target.reasoningTokens += stats.reasoningTokens;
	target.tokens += tokens(stats);
	target.cacheHits += stats.cacheHits;
	target.cacheMisses += stats.cacheMisses;
	target.estimatedCostUsd += stats.estimatedCostUsd;
	target.topLogprobScores += stats.topLogprobScores;
	target.explicitTagScores += stats.explicitTagScores;
}
function finishTotals(target) {
	target.averageDurationMs = target.invocations > 0 ? target.averageDurationMs / target.invocations : 0;
	target.successRate = ratio(target.successes, target.invocations);
	target.cacheHitRate = ratio(target.cacheHits, target.cacheHits + target.cacheMisses);
	return target;
}
function localDate(time, timezoneOffsetMinutes) {
	return (/* @__PURE__ */ new Date(time - timezoneOffsetMinutes * 6e4)).toISOString().slice(0, 10);
}
function isRecord(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	return typeof row.id === "string" && VERIFIER_TOOL_NAMES.includes(row.toolName) && typeof row.startedAt === "number" && typeof row.finishedAt === "number" && typeof row.durationMs === "number" && typeof row.success === "boolean" && typeof row.provider === "string" && typeof row.model === "string" && typeof row.stats === "object" && row.stats !== null;
}
function resolveStatisticsFile(cacheFile) {
	return join(dirname(cacheFile), "statistics-v1.json");
}
var StatisticsStore = class {
	file;
	maxEntries;
	loaded = false;
	records = [];
	writing = Promise.resolve();
	constructor(file, maxEntries = 5e4) {
		this.file = file;
		this.maxEntries = maxEntries;
		if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error("llm-verifier: statistics maxEntries must be a positive integer");
	}
	async record(input) {
		const finishedAt = input.finishedAt ?? Date.now();
		const record = {
			id: randomUUID(),
			toolName: input.toolName,
			...input.sessionId ? { sessionId: input.sessionId } : {},
			startedAt: input.startedAt,
			finishedAt,
			durationMs: Math.max(0, finishedAt - input.startedAt),
			success: input.success,
			...input.errorName ? { errorName: cleanError(input.errorName) } : {},
			...input.errorMessage ? { errorMessage: cleanError(input.errorMessage) } : {},
			provider: input.provider,
			model: input.model,
			stats: { ...input.stats }
		};
		const operation = async () => {
			await this.load();
			this.records.push(record);
			if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries);
			await this.persist();
		};
		this.writing = this.writing.then(operation, operation);
		await this.writing;
		return record;
	}
	async overview(query) {
		if (!Number.isFinite(query.fromMs) || !Number.isFinite(query.toMs) || query.fromMs >= query.toMs) throw new Error("llm-verifier: statistics range must be finite and increasing");
		await this.writing.catch(() => {});
		await this.load();
		const offset = Number.isFinite(query.timezoneOffsetMinutes) ? Math.trunc(query.timezoneOffsetMinutes ?? 0) : 0;
		const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)));
		const selected = this.records.filter((record) => record.startedAt >= query.fromMs && record.startedAt < query.toMs && (query.sessionId === void 0 || record.sessionId === query.sessionId));
		const totals = blankTotals();
		const daily = /* @__PURE__ */ new Map();
		const tools = /* @__PURE__ */ new Map();
		const models = /* @__PURE__ */ new Map();
		for (const record of selected) {
			addRecord(totals, record);
			const date = localDate(record.startedAt, offset);
			const day = daily.get(date) ?? {
				date,
				invocations: 0,
				successes: 0,
				failures: 0,
				calls: 0,
				tokens: 0,
				estimatedCostUsd: 0,
				byTool: {}
			};
			day.invocations += 1;
			record.success ? day.successes += 1 : day.failures += 1;
			day.calls += record.stats.calls;
			day.tokens += tokens(record.stats);
			day.estimatedCostUsd += record.stats.estimatedCostUsd;
			day.byTool[record.toolName] = (day.byTool[record.toolName] ?? 0) + 1;
			daily.set(date, day);
			const tool = tools.get(record.toolName) ?? {
				totals: blankTotals(),
				duration: 0
			};
			addRecord(tool.totals, record);
			tool.duration += record.durationMs;
			tools.set(record.toolName, tool);
			const modelKey = record.provider + "\0" + record.model;
			const model = models.get(modelKey) ?? {
				provider: record.provider,
				model: record.model,
				invocations: 0,
				calls: 0,
				tokens: 0,
				estimatedCostUsd: 0
			};
			model.invocations += 1;
			model.calls += record.stats.calls;
			model.tokens += tokens(record.stats);
			model.estimatedCostUsd += record.stats.estimatedCostUsd;
			models.set(modelKey, model);
		}
		finishTotals(totals);
		const toolRows = [...tools.entries()].map(([toolName, value]) => {
			const summary = finishTotals(value.totals);
			return {
				toolName,
				invocations: summary.invocations,
				successes: summary.successes,
				failures: summary.failures,
				successRate: summary.successRate,
				averageDurationMs: summary.averageDurationMs,
				calls: summary.calls,
				tokens: summary.tokens,
				cacheHits: summary.cacheHits,
				cacheMisses: summary.cacheMisses,
				estimatedCostUsd: summary.estimatedCostUsd
			};
		}).sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName));
		return {
			generatedAt: Date.now(),
			fromMs: query.fromMs,
			toMs: query.toMs,
			...query.sessionId ? { sessionId: query.sessionId } : {},
			totals,
			daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
			tools: toolRows,
			models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
			recent: [...selected].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
		};
	}
	async load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const document = JSON.parse(await readFile(this.file, "utf8"));
			if (document.version === 1 && Array.isArray(document.records)) this.records = document.records.filter(isRecord).slice(-this.maxEntries);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	async persist() {
		const snapshot = {
			version: 1,
			records: this.records
		};
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = this.file + ".tmp-" + process.pid + "-" + randomUUID();
		await writeFile(temporary, JSON.stringify(snapshot), "utf8");
		try {
			await rename(temporary, this.file);
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
	}
};
function emptyRunStats() {
	return {
		calls: 0,
		attempts: 0,
		retries: 0,
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		cacheHits: 0,
		cacheMisses: 0,
		estimatedCostUsd: 0,
		topLogprobScores: 0,
		explicitTagScores: 0
	};
}
function errorDetails(error) {
	if (error instanceof Error) return {
		errorName: error.name || "Error",
		errorMessage: error.message || String(error)
	};
	return {
		errorName: "Error",
		errorMessage: String(error)
	};
}
//#endregion
//#region src/index.ts
const name = "llm-verifier";
const inject = [
	"tools",
	"agents",
	"attachments",
	"llm",
	"connection"
];
const criterionSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		description: {
			type: "string",
			required: true
		}
	}
};
const statsSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		calls: {
			type: "integer",
			required: true
		},
		attempts: {
			type: "integer",
			required: true
		},
		retries: {
			type: "integer",
			required: true
		},
		inputTokens: {
			type: "integer",
			required: true
		},
		cachedInputTokens: {
			type: "integer",
			required: true
		},
		outputTokens: {
			type: "integer",
			required: true
		},
		reasoningTokens: {
			type: "integer",
			required: true
		},
		cacheHits: {
			type: "integer",
			required: true
		},
		cacheMisses: {
			type: "integer",
			required: true
		},
		estimatedCostUsd: {
			type: "number",
			required: true
		},
		topLogprobScores: {
			type: "integer",
			required: true
		},
		explicitTagScores: {
			type: "integer",
			required: true
		}
	}
};
const criterionResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		name: {
			type: "string",
			required: true
		},
		scoreA: {
			type: "number",
			required: true
		},
		scoreB: {
			type: "number",
			required: true
		}
	}
};
const commonParams = {
	criteria: {
		type: "array",
		items: criterionSchema
	},
	repeats: { type: "integer" },
	images: {
		type: "array",
		items: { type: "string" },
		description: "Optional HTTPS or data:image/...;base64 images. The selected DSH model must accept image input."
	}
};
function renderJson(value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}
function positive(value, fallback, field) {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) throw new Error("llm-verifier: " + field + " must be a positive integer");
	return result;
}
function numberField(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function statsFrom(value) {
	if (typeof value !== "object" || value === null || !("stats" in value)) return emptyRunStats();
	const source = value.stats;
	if (typeof source !== "object" || source === null) return emptyRunStats();
	const row = source;
	return {
		calls: numberField(row.calls, 0),
		attempts: numberField(row.attempts, 0),
		retries: numberField(row.retries, 0),
		inputTokens: numberField(row.inputTokens, 0),
		cachedInputTokens: numberField(row.cachedInputTokens, 0),
		outputTokens: numberField(row.outputTokens, 0),
		reasoningTokens: numberField(row.reasoningTokens, 0),
		cacheHits: numberField(row.cacheHits, 0),
		cacheMisses: numberField(row.cacheMisses, 0),
		estimatedCostUsd: numberField(row.estimatedCostUsd, 0),
		topLogprobScores: numberField(row.topLogprobScores, 0),
		explicitTagScores: numberField(row.explicitTagScores, 0)
	};
}
function rpcSuccess(value) {
	return {
		ok: true,
		value
	};
}
function rpcFailure(message) {
	return {
		ok: false,
		error: {
			code: "bad-request",
			message,
			details: { issues: [] }
		}
	};
}
function apply(ctx, config = {}) {
	const services = ctx;
	const entry = resolveConfig(config);
	let limiter = new RequestLimiter(entry.maxConcurrency);
	const current = installVerifierSettings(ctx, entry, () => {
		limiter = new RequestLimiter(current().maxConcurrency);
	});
	const cacheFile = resolveCacheFile(entry.cacheDir);
	const cache = new ScoreCache(cacheFile, entry.cacheMaxEntries);
	const statistics = new StatisticsStore(resolveStatisticsFile(cacheFile));
	const topLogprobCapabilities = new TopLogprobCapabilityCache();
	const autoBudget = new AutoVerificationBudget();
	const engine = async () => {
		const selected = current();
		await ctx.llm.resolveCallConfig({
			provider: selected.provider,
			model: selected.model,
			...selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {},
			maxTokens: selected.maxTokens
		});
		return {
			verifier: new VerifierEngine({
				...selected,
				ctx,
				llm: ctx.llm,
				attachments: services.attachments,
				topLogprobCapabilities,
				limiter
			}, selected.maxConcurrency, cache, {
				input: selected.estimatedInputUsdPerMillion,
				output: selected.estimatedOutputUsdPerMillion
			}),
			selected
		};
	};
	const images = (values, signal) => loadVerifierImages(values, signal);
	const route = (selected) => ({
		provider: selected.provider,
		model: selected.model
	});
	const requireEnabled = () => {
		if (!current().enabled) throw new Error("llm-verifier: verifier tools are disabled — enable them in Settings → LLM Verifier");
	};
	const record = async (toolName, agent, operation) => {
		const startedAt = Date.now();
		let selected = current();
		try {
			const completed = await operation();
			selected = completed.selected;
			const value = {
				...completed.result,
				...route(selected)
			};
			await statistics.record({
				toolName,
				...agent ? { sessionId: String(agent.id) } : {},
				startedAt,
				success: true,
				provider: selected.provider,
				model: selected.model,
				stats: statsFrom(value)
			}).catch(() => {});
			return value;
		} catch (error) {
			const details = errorDetails(error);
			await statistics.record({
				toolName,
				...agent ? { sessionId: String(agent.id) } : {},
				startedAt,
				success: false,
				...details,
				provider: selected.provider,
				model: selected.model,
				stats: emptyRunStats()
			}).catch(() => {});
			throw error;
		}
	};
	const verifySession = async (agent, options, signal) => record("verifier_current_session", agent, async () => {
		const extracted = await extractSession(agent, async (ref) => {
			const stored = await services.attachments.readImage(ref, signal);
			return {
				data: stored.data,
				mediaType: stored.ref.mediaType
			};
		}, {
			fromSeq: options.fromSeq,
			toSeq: options.toSeq,
			includeAssistantText: options.includeAssistantText,
			redactPatterns: options.redactPatterns,
			maxChars: options.maxChars
		});
		const { verifier, selected } = await engine();
		const compared = await verifier.compare({
			problem: extracted.problem,
			candidateA: extracted.trace,
			candidateB: "(No useful work or verification was performed.)",
			repeats: positive(options.repeats, 2, "repeats"),
			images: extracted.images
		}, signal);
		return {
			result: {
				sessionId: extracted.sessionId,
				problem: extracted.problem,
				score: compared.scoreA,
				baselineScore: compared.scoreB,
				winner: compared.winner,
				fromSeq: extracted.fromSeq,
				toSeq: extracted.toSeq,
				omittedCharacters: extracted.omittedCharacters,
				calls: compared.calls,
				stats: compared.stats
			},
			selected
		};
	});
	ctx.effect(() => services.connection.rpc.handle("/llm-verifier", async (endpoint, payload) => {
		if (endpoint !== "statistics") return rpcFailure("unknown llm-verifier endpoint");
		if (typeof payload !== "object" || payload === null) return rpcFailure("statistics payload must be an object");
		const row = payload;
		const sessionId = typeof row.sessionId === "string" && row.sessionId.length > 0 ? row.sessionId : void 0;
		try {
			return rpcSuccess(await statistics.overview({
				fromMs: numberField(row.fromMs, NaN),
				toMs: numberField(row.toMs, NaN),
				timezoneOffsetMinutes: numberField(row.timezoneOffsetMinutes, 0),
				recentLimit: numberField(row.recentLimit, 40),
				...sessionId ? { sessionId } : {}
			}));
		} catch (error) {
			return rpcFailure(error instanceof Error ? error.message : String(error));
		}
	}, { authority: "loopback" }), "llm-verifier: statistics rpc");
	ctx.on("agent/disposed", ({ agent }) => {
		autoBudget.release(agent);
	});
	ctx.on("agent/turn-stopping", async ({ agent, signal }) => {
		const selected = current();
		if (!selected.enabled || selected.autoVerifyMode === "manual" || signal.aborted) return;
		const evidence = analyzeAutoTask(agent.session.events, {
			mode: selected.autoVerifyMode,
			minToolCalls: selected.autoVerifyMinToolCalls,
			maxPerTask: selected.autoVerifyMaxPerTask,
			maxPerSession: selected.autoVerifyMaxPerSession
		});
		if (!autoBudget.claim(agent, evidence, {
			mode: selected.autoVerifyMode,
			minToolCalls: selected.autoVerifyMinToolCalls,
			maxPerTask: selected.autoVerifyMaxPerTask,
			maxPerSession: selected.autoVerifyMaxPerSession
		})) return;
		try {
			const result = await verifySession(agent, {
				fromSeq: evidence.taskStartSeq,
				includeAssistantText: true,
				maxChars: selected.autoVerifyMaxChars,
				repeats: selected.autoVerifyRepeats
			}, signal);
			if (!(result.winner === "A" && result.score >= selected.autoVerifyThreshold)) agent.steer(createUserMessage({
				content: [{
					type: "text",
					text: automaticFeedback(result.score, result.baselineScore, result.winner, selected.autoVerifyThreshold)
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-llm-verifier"
				}
			}));
		} catch (error) {
			ctx.logger.warn("llm-verifier automatic session verification failed: " + (error instanceof Error ? error.message : String(error)));
			if (selected.autoVerifyMode === "strict" && !signal.aborted) agent.steer(createUserMessage({
				content: [{
					type: "text",
					text: "[Automatic verifier gate]\nThe required strict verification could not run: " + (error instanceof Error ? error.message : String(error)) + "\nInspect the task evidence and run a directly relevant verification command before concluding."
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-llm-verifier"
				}
			}));
		}
	});
	ctx.tools.register(defineTool({
		name: "verifier_compare",
		description: "Use autonomously when exactly two substantive answers, patches, plans, or execution trajectories need an independent evidence-based comparison and the choice is consequential or uncertain. Do not use for trivial deterministic questions or when there is only one candidate. Uses the verifier model selected in DSH Settings, with top-logprob A–T expectations when supported and explicit-tag fallback otherwise.",
		parameters: {
			problem: {
				type: "string",
				required: true
			},
			candidate_a: {
				type: "string",
				required: true
			},
			candidate_b: {
				type: "string",
				required: true
			},
			...commonParams
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					scoreA: {
						type: "number",
						required: true
					},
					scoreB: {
						type: "number",
						required: true
					},
					winner: {
						type: "string",
						enum: [
							"A",
							"B",
							"tie"
						],
						required: true
					},
					criteria: {
						type: "array",
						items: criterionResultSchema,
						required: true
					},
					calls: {
						type: "integer",
						required: true
					},
					stats: {
						...statsSchema,
						required: true
					},
					provider: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		timeoutMs: entry.timeoutMs * 20,
		async execute(args, exec) {
			requireEnabled();
			return record("verifier_compare", exec.agent, async () => {
				const { verifier, selected } = await engine();
				return {
					result: await verifier.compare({
						problem: args.problem,
						candidateA: args.candidate_a,
						candidateB: args.candidate_b,
						criteria: normalizeCriteria(args.criteria),
						repeats: positive(args.repeats, 2, "repeats"),
						images: await images(args.images, exec.signal)
					}, exec.signal),
					selected
				};
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_select",
		description: "Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Deterministic orchestrators should call this directly once they have three or more real candidates.",
		parameters: {
			problem: {
				type: "string",
				required: true
			},
			candidates: {
				type: "array",
				items: { type: "string" },
				required: true
			},
			...commonParams,
			pivots: { type: "integer" },
			seed: { type: "integer" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					index: {
						type: "integer",
						required: true
					},
					best: {
						type: "string",
						required: true
					},
					scores: {
						type: "array",
						items: { type: "number" },
						required: true
					},
					ranking: {
						type: "array",
						items: { type: "integer" },
						required: true
					},
					pivots: {
						type: "array",
						items: { type: "integer" },
						required: true
					},
					comparisons: {
						type: "integer",
						required: true
					},
					calls: {
						type: "integer",
						required: true
					},
					stats: {
						...statsSchema,
						required: true
					},
					provider: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		timeoutMs: entry.timeoutMs * 100,
		async execute(args, exec) {
			requireEnabled();
			return record("verifier_select", exec.agent, async () => {
				const { verifier, selected } = await engine();
				return {
					result: await verifier.select({
						problem: args.problem,
						candidates: args.candidates,
						criteria: normalizeCriteria(args.criteria),
						repeats: positive(args.repeats, 2, "repeats"),
						pivots: positive(args.pivots, 2, "pivots"),
						seed: args.seed ?? 0,
						images: await images(args.images, exec.signal)
					}, exec.signal),
					selected
				};
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_track",
		description: "Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Deterministic goal/workflow orchestrators should call this directly when real checkpoints already exist. Do not use for a single completed answer or invent checkpoints.",
		parameters: {
			problem: {
				type: "string",
				required: true
			},
			steps: {
				type: "array",
				items: { type: "string" },
				required: true
			},
			checkpoints: {
				type: "array",
				items: { type: "integer" },
				required: true
			},
			repeats: commonParams.repeats,
			images: commonParams.images
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					scores: {
						type: "array",
						items: { type: "number" },
						required: true
					},
					perRepeat: {
						type: "array",
						items: {
							type: "array",
							items: { type: "number" }
						},
						required: true
					},
					calls: {
						type: "integer",
						required: true
					},
					stats: {
						...statsSchema,
						required: true
					},
					provider: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		timeoutMs: entry.timeoutMs * 20,
		async execute(args, exec) {
			requireEnabled();
			return record("verifier_track", exec.agent, async () => {
				const { verifier, selected } = await engine();
				return {
					result: await verifier.track(args.problem, args.steps, args.checkpoints, positive(args.repeats, 2, "repeats"), exec.signal, await images(args.images, exec.signal)),
					selected
				};
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_current_session",
		description: "Explicitly verify the current DSH session. Smart/strict policy can also invoke this gate automatically at the turn-stopping lifecycle boundary after consequential work with real tool evidence. Extracts the session, applies redaction and bounds, then sends the evidence to the configured verifier model.",
		parameters: {
			from_seq: { type: "integer" },
			to_seq: { type: "integer" },
			include_assistant_text: { type: "boolean" },
			redact_patterns: {
				type: "array",
				items: { type: "string" }
			},
			max_chars: { type: "integer" },
			repeats: { type: "integer" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: {
						type: "string",
						required: true
					},
					problem: {
						type: "string",
						required: true
					},
					score: {
						type: "number",
						required: true
					},
					baselineScore: {
						type: "number",
						required: true
					},
					winner: {
						type: "string",
						enum: [
							"A",
							"B",
							"tie"
						],
						required: true
					},
					fromSeq: {
						type: "integer",
						required: true
					},
					toSeq: {
						type: "integer",
						required: true
					},
					omittedCharacters: {
						type: "integer",
						required: true
					},
					calls: {
						type: "integer",
						required: true
					},
					stats: {
						...statsSchema,
						required: true
					},
					provider: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => renderJson(value)
		},
		timeoutMs: entry.timeoutMs * 20,
		async execute(args, exec) {
			requireEnabled();
			const agent = exec.agent ?? ctx.agents.currentInitiator();
			if (agent === void 0) throw new Error("llm-verifier: verifier_current_session requires an agent-owned tool call");
			return verifySession(agent, {
				fromSeq: args.from_seq,
				toSeq: args.to_seq,
				includeAssistantText: args.include_assistant_text,
				redactPatterns: args.redact_patterns,
				maxChars: args.max_chars,
				repeats: args.repeats
			}, exec.signal);
		}
	}));
}
//#endregion
export { AutoVerificationBudget, Config, DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, GRANULARITY, LETTERS, RequestLimiter, SCALE_DESCRIPTION, ScoreCache, StatisticsStore, VERIFIER_TOOL_NAMES, VerifierEngine, accumulatePairs, analyzeAutoTask, apply, automaticFeedback, bradleyTerry, buildPairwisePrompt, buildProgressPrompt, callVerifier, emptyRunStats, errorDetails, extractProgressScore, extractScore, inject, name, normalizeCriteria, normalizeScoreLetter, pivotRoundPairs, rankScores, resolveCacheFile, resolveStatisticsFile, ringCycle, seededRandom, stableHash, topPivots };

//# sourceMappingURL=index.js.map