import { a as TopLogprobCapabilityCache, i as emptyUsage, n as addUsage, r as callVerifier, t as RequestLimiter } from "./caller-CGlgZ-Su.js";
import { DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, GRANULARITY, LETTERS, SCALE_DESCRIPTION, accumulatePairs, bradleyTerry, buildPairwisePrompt, buildProgressPrompt, extractProgressScore, extractScore, normalizeScoreLetter, pivotRoundPairs, rankScores, ringCycle, seededRandom, topPivots } from "./core.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
//#region src/config.ts
const VERIFIER_SETTINGS_NAMESPACE = settingsNamespace("llm-verifier");
const Config = z.object({
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
	const values = {
		maxTokens: config.maxTokens ?? 32768,
		timeoutMs: config.timeoutMs ?? 3e5,
		maxConcurrency: config.maxConcurrency ?? 8,
		retryBaseDelayMs: config.retryBaseDelayMs ?? 500,
		cacheMaxEntries: config.cacheMaxEntries ?? 1e4
	};
	for (const [name, value] of Object.entries(values)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("llm-verifier: " + name + " must be a positive safe integer");
	const maxRetries = config.maxRetries ?? 3;
	if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error("llm-verifier: maxRetries must be a non-negative safe integer");
	const cacheDir = (config.cacheDir ?? ".dsh-verifier-cache").trim();
	if (!cacheDir) throw new Error("llm-verifier: cacheDir must be non-empty");
	const estimatedInputUsdPerMillion = config.estimatedInputUsdPerMillion ?? 0;
	const estimatedOutputUsdPerMillion = config.estimatedOutputUsdPerMillion ?? 0;
	if (![estimatedInputUsdPerMillion, estimatedOutputUsdPerMillion].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("llm-verifier: estimated token prices must be finite non-negative numbers");
	const reasoningEffort = config.reasoningEffort?.trim();
	return {
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
//#region src/index.ts
const name = "llm-verifier";
const inject = [
	"tools",
	"agents",
	"attachments",
	"llm"
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
function apply(ctx, config = {}) {
	const entry = resolveConfig(config);
	let limiter = new RequestLimiter(entry.maxConcurrency);
	const current = installVerifierSettings(ctx, entry, () => {
		limiter = new RequestLimiter(current().maxConcurrency);
	});
	const cache = new ScoreCache(resolveCacheFile(entry.cacheDir), entry.cacheMaxEntries);
	const topLogprobCapabilities = new TopLogprobCapabilityCache();
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
				attachments: ctx.attachments,
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
			const { verifier, selected } = await engine();
			return {
				...await verifier.compare({
					problem: args.problem,
					candidateA: args.candidate_a,
					candidateB: args.candidate_b,
					criteria: normalizeCriteria(args.criteria),
					repeats: positive(args.repeats, 2, "repeats"),
					images: await images(args.images, exec.signal)
				}, exec.signal),
				...route(selected)
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_select",
		description: "Use autonomously when three or more substantive candidate answers, patches, plans, or trajectories must be ranked and an independent choice is valuable. Use verifier_compare for exactly two candidates; do not generate extra candidates merely to invoke this tool. Uses the configured DSH verifier model and the O(Nk) Probabilistic Pivot Tournament.",
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
			const { verifier, selected } = await engine();
			return {
				...await verifier.select({
					problem: args.problem,
					candidates: args.candidates,
					criteria: normalizeCriteria(args.criteria),
					repeats: positive(args.repeats, 2, "repeats"),
					pivots: positive(args.pivots, 2, "pivots"),
					seed: args.seed ?? 0,
					images: await images(args.images, exec.signal)
				}, exec.signal),
				...route(selected)
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_track",
		description: "Use autonomously for a genuinely multi-step task when progress at explicit checkpoints is uncertain or needs evidence-based measurement. Do not use for a single completed answer or invent checkpoints that were not supplied by the task history. Trusts observed output rather than narration.",
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
			const { verifier, selected } = await engine();
			return {
				...await verifier.track(args.problem, args.steps, args.checkpoints, positive(args.repeats, 2, "repeats"), exec.signal, await images(args.images, exec.signal)),
				...route(selected)
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "verifier_current_session",
		description: "Use autonomously near the end of a non-trivial coding, debugging, migration, deployment, or operations task when independent completion verification would materially reduce risk and the session contains real tool evidence. Do not use for routine conversation, simple factual answers, or every turn. Extracts the current DSH session, applies secret redaction, bounds and truncation, then sends the evidence to the verifier model selected in Settings.",
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
			const agent = exec.agent ?? ctx.agents.currentInitiator();
			if (agent === void 0) throw new Error("llm-verifier: verifier_current_session requires an agent-owned tool call");
			const extracted = await extractSession(agent, async (ref) => {
				const stored = await ctx.attachments.readImage(ref, exec.signal);
				return {
					data: stored.data,
					mediaType: stored.ref.mediaType
				};
			}, {
				fromSeq: args.from_seq,
				toSeq: args.to_seq,
				includeAssistantText: args.include_assistant_text,
				redactPatterns: args.redact_patterns,
				maxChars: args.max_chars
			});
			const { verifier, selected } = await engine();
			const result = await verifier.compare({
				problem: extracted.problem,
				candidateA: extracted.trace,
				candidateB: "(No useful work or verification was performed.)",
				repeats: positive(args.repeats, 2, "repeats"),
				images: extracted.images
			}, exec.signal);
			return {
				sessionId: extracted.sessionId,
				problem: extracted.problem,
				score: result.scoreA,
				baselineScore: result.scoreB,
				winner: result.winner,
				fromSeq: extracted.fromSeq,
				toSeq: extracted.toSeq,
				omittedCharacters: extracted.omittedCharacters,
				calls: result.calls,
				stats: result.stats,
				...route(selected)
			};
		}
	}));
}
//#endregion
export { Config, DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, GRANULARITY, LETTERS, RequestLimiter, SCALE_DESCRIPTION, ScoreCache, VerifierEngine, accumulatePairs, apply, bradleyTerry, buildPairwisePrompt, buildProgressPrompt, callVerifier, extractProgressScore, extractScore, inject, name, normalizeCriteria, normalizeScoreLetter, pivotRoundPairs, rankScores, resolveCacheFile, ringCycle, seededRandom, stableHash, topPivots };

//# sourceMappingURL=index.js.map