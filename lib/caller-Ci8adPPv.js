import { BlockAssembler, ReasoningEffortId, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
//#region src/top-logprobs.ts
var TopLogprobsUnsupportedError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "TopLogprobsUnsupportedError";
	}
};
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function endpoint(baseURL) {
	return baseURL.replace(/\/+$/, "") + "/chat/completions";
}
function dataUrl(image) {
	return "data:" + image.mediaType + ";base64," + Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).toString("base64");
}
async function credential(ctx, name) {
	if (!name) return void 0;
	return (await ctx.get("credentials")?.resolve(credentialRef(name)))?.value;
}
async function resolveTopLogprobRoute(ctx, provider) {
	const settings = ctx.get("settings");
	if (provider === "deepseek-official") {
		const value = settings ? object(settings.get(settingsNamespace("llm-deepseek"))) ?? {} : {};
		const apiKey = await credential(ctx, text(value.apiKeyEnv) ?? "DEEPSEEK_API_KEY");
		if (!apiKey) return void 0;
		return {
			baseURL: text(value.baseURL) ?? "https://api.deepseek.com",
			apiKey,
			deepSeekThinking: true
		};
	}
	if (!settings) return void 0;
	const profile = object(object(object(settings.get(settingsNamespace("llm-pi-ai")))?.providers)?.[provider]);
	if (!profile || profile.api !== "openai-completions") return void 0;
	const baseURL = text(profile.baseURL);
	if (!baseURL || !/^https:\/\//i.test(baseURL)) return void 0;
	const apiKey = await credential(ctx, text(profile.apiKeyEnv));
	const rawHeaders = object(profile.headers);
	const headers = rawHeaders === void 0 ? void 0 : Object.fromEntries(Object.entries(rawHeaders).filter((entry) => typeof entry[1] === "string"));
	return {
		baseURL,
		...apiKey ? { apiKey } : {},
		...headers ? { headers } : {},
		deepSeekThinking: false
	};
}
async function callTopLogprobs(route, model, prompt, maxTokens, reasoningEffort, signal, images) {
	const content = images?.length ? [{
		type: "text",
		text: prompt
	}, ...images.map((image) => ({
		type: "image_url",
		image_url: { url: dataUrl(image) }
	}))] : prompt;
	const thinking = route.deepSeekThinking && reasoningEffort ? reasoningEffort === "off" ? { thinking: { type: "disabled" } } : {
		thinking: { type: "enabled" },
		reasoning_effort: reasoningEffort
	} : {};
	const response = await fetch(endpoint(route.baseURL), {
		method: "POST",
		redirect: "error",
		signal,
		headers: {
			"content-type": "application/json",
			...route.apiKey ? { authorization: "Bearer " + route.apiKey } : {},
			...route.headers
		},
		body: JSON.stringify({
			model,
			messages: [{
				role: "user",
				content
			}],
			max_tokens: maxTokens,
			temperature: 1,
			logprobs: true,
			top_logprobs: 20,
			...thinking
		})
	});
	const raw = await response.text();
	if (!response.ok) {
		const excerpt = raw.slice(0, 1e3);
		if ([
			400,
			404,
			405,
			415,
			422
		].includes(response.status) && /logprob|top_logprobs|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|not support/i.test(excerpt)) throw new TopLogprobsUnsupportedError("provider rejected top_logprobs: HTTP " + response.status + " " + excerpt);
		throw new Error("llm-verifier: top_logprobs request failed with HTTP " + response.status + ": " + excerpt);
	}
	let body;
	try {
		body = object(JSON.parse(raw)) ?? {};
	} catch {
		throw new Error("llm-verifier: top_logprobs endpoint returned invalid JSON");
	}
	const choice = object((Array.isArray(body.choices) ? body.choices : [])[0]);
	const message = object(choice?.message);
	const answer = typeof message?.content === "string" ? message.content : "";
	const logprobs = object(choice?.logprobs);
	const rows = Array.isArray(logprobs?.content) ? logprobs.content : [];
	if (!rows.length) throw new TopLogprobsUnsupportedError("provider returned no token logprobs");
	const tokens = [];
	const positions = [];
	for (const rawRow of rows) {
		const row = object(rawRow) ?? {};
		const token = typeof row.token === "string" ? row.token : "";
		tokens.push(token);
		const alternatives = (Array.isArray(row.top_logprobs) ? row.top_logprobs : []).flatMap((value) => {
			const item = object(value);
			return item && typeof item.token === "string" && typeof item.logprob === "number" ? [{
				token: item.token,
				logprob: item.logprob
			}] : [];
		});
		if (!alternatives.length && typeof row.logprob === "number") alternatives.push({
			token,
			logprob: row.logprob
		});
		positions.push(alternatives);
	}
	const rawUsage = object(body.usage) ?? {};
	const promptDetails = object(rawUsage.prompt_tokens_details) ?? {};
	const completionDetails = object(rawUsage.completion_tokens_details) ?? {};
	const cached = Number(rawUsage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? 0) || 0;
	const input = Number(rawUsage.prompt_tokens ?? 0) || 0;
	return {
		text: answer,
		tokens,
		positions,
		scoringMode: "top-logprobs",
		usage: {
			calls: 1,
			attempts: 1,
			retries: 0,
			inputTokens: Math.max(0, input - cached),
			cachedInputTokens: cached,
			outputTokens: Number(rawUsage.completion_tokens ?? 0) || 0,
			reasoningTokens: Number(completionDetails.reasoning_tokens ?? 0) || 0
		}
	};
}
/** Resolves the capability memory file beside the score cache inside the topic verifier directory. */
function resolveCapabilityFile(cacheDir, cwd = process.cwd()) {
	return join(isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir), "capabilities-v1.json");
}
var TopLogprobCapabilityCache = class {
	file;
	now;
	unsupported = /* @__PURE__ */ new Map();
	loaded = false;
	hydrating;
	writing = Promise.resolve();
	constructor(file, now = Date.now) {
		this.file = file;
		this.now = now;
	}
	isUnsupported(provider, model) {
		return this.unsupported.has(provider + "\0" + model);
	}
	/** Hydrates persisted marks once; in-process marks always win over file contents. */
	async ensureLoaded() {
		if (this.loaded || this.file === void 0) return;
		this.hydrating ??= (async () => {
			try {
				const document = JSON.parse(await readFile(this.file, "utf8"));
				const entries = document !== null && typeof document === "object" && document.version === 1 && typeof document.entries === "object" && document.entries !== null ? document.entries : {};
				const now = this.now();
				for (const [key, markedAt] of Object.entries(entries)) {
					if (typeof markedAt !== "number" || !Number.isFinite(markedAt) || markedAt < 0 || now - markedAt > 864e5) continue;
					const existing = this.unsupported.get(key);
					if (existing === void 0 || existing < markedAt) this.unsupported.set(key, markedAt);
				}
			} catch {}
			this.loaded = true;
		})();
		await this.hydrating;
	}
	markUnsupported(provider, model) {
		this.unsupported.set(provider + "\0" + model, this.now());
		if (this.file === void 0) return;
		this.writing = this.writing.then(() => this.ensureLoaded()).then(async () => {
			const snapshot = {
				version: 1,
				entries: Object.fromEntries(this.unsupported)
			};
			await mkdir(dirname(this.file), { recursive: true });
			const temporary = this.file + ".tmp-" + process.pid;
			await writeFile(temporary, JSON.stringify(snapshot), "utf8");
			try {
				await rename(temporary, this.file);
			} catch (error) {
				await unlink(temporary).catch(() => {});
				throw error;
			}
		}).catch(() => {});
	}
	/** Resolves once the trailing persistence attempt settles; exposed for tests. */
	flush() {
		return this.writing;
	}
};
//#endregion
//#region src/caller.ts
function failureMessage(finish) {
	if (finish.kind === "error" || finish.kind === "aborted") return finish.failure.message;
	if (finish.kind === "max-tokens") return "verifier response reached max tokens before completing its answer";
}
async function delay(ms, signal) {
	if (signal?.aborted) throw signal.reason;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		const abort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}
function usage(attempts, value = {}) {
	return {
		calls: 1,
		attempts,
		retries: attempts - 1,
		inputTokens: value.inputTokens ?? 0,
		cachedInputTokens: (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0),
		outputTokens: value.outputTokens ?? 0,
		reasoningTokens: value.reasoningTokens ?? 0
	};
}
async function callExplicitTag(config, prompt, signal, images) {
	let attempt = 0;
	while (true) {
		attempt += 1;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("llm-verifier: request timed out")), config.timeoutMs);
		const abort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const content = [{
				type: "text",
				text: prompt
			}];
			for (const image of images ?? []) {
				const ref = await config.attachments.saveImage({
					data: image.data,
					mediaType: image.mediaType
				});
				content.push({
					type: "image",
					attachment: ref
				});
			}
			const messages = [createUserMessage({
				content,
				source: {
					kind: "plugin",
					plugin: "dsh-llm-verifier"
				}
			})];
			const assembler = new BlockAssembler();
			const options = deepFreeze({
				provider: config.provider,
				model: config.model,
				...config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(config.reasoningEffort) } : {},
				messages,
				maxTokens: config.maxTokens,
				temperature: 1,
				signal: controller.signal
			});
			for await (const chunk of config.llm.stream(options)) assembler.push(chunk);
			const failed = failureMessage(assembler.finish);
			if (failed !== void 0) throw new Error("llm-verifier: model call failed: " + failed);
			const text = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("");
			if (!text.trim()) throw new Error("llm-verifier: selected DSH model produced no text");
			return {
				text,
				tokens: [],
				positions: [],
				scoringMode: "explicit-tag",
				usage: usage(attempt, assembler.usage)
			};
		} catch (error) {
			if (signal?.aborted) throw signal.reason;
			if (attempt > config.maxRetries || !(error instanceof Error) || !/rate|quota|timeout|timed out|temporar|network|fetch|socket|5\d\d/i.test(error.message)) throw error;
			await delay(Math.min(3e4, config.retryBaseDelayMs * 2 ** (attempt - 1) * (.8 + Math.random() * .4)), signal);
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		}
	}
}
var RequestLimiter = class {
	limit;
	active = 0;
	queue = [];
	constructor(limit) {
		this.limit = limit;
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("llm-verifier: request concurrency limit must be a positive integer");
	}
	async run(operation, signal) {
		if (this.active >= this.limit) await new Promise((resolve, reject) => {
			const enter = () => {
				signal?.removeEventListener("abort", abort);
				resolve();
			};
			const abort = () => {
				const index = this.queue.indexOf(enter);
				if (index >= 0) this.queue.splice(index, 1);
				reject(signal?.reason);
			};
			this.queue.push(enter);
			signal?.addEventListener("abort", abort, { once: true });
		});
		if (signal?.aborted) throw signal.reason;
		this.active += 1;
		try {
			return await operation();
		} finally {
			this.active -= 1;
			this.queue.shift()?.();
		}
	}
};
/** Best-effort pre-call channel prediction for cache identity only; callAutomatic() stays the runtime source of truth. */
async function predictScoringChannel(config) {
	await config.topLogprobCapabilities.ensureLoaded();
	return config.topLogprobCapabilities.isUnsupported(config.provider, config.model) ? "explicit-tag" : "top-logprobs";
}
async function callAutomatic(config, prompt, signal, images) {
	await config.topLogprobCapabilities.ensureLoaded();
	if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
		const route = await resolveTopLogprobRoute(config.ctx, config.provider);
		if (route !== void 0) try {
			return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images);
		} catch (error) {
			if (!(error instanceof TopLogprobsUnsupportedError)) throw error;
			config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
		}
		else config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
	}
	return callExplicitTag(config, prompt, signal, images);
}
async function callVerifier(config, prompt, signal, images) {
	const invoke = () => callAutomatic(config, prompt, signal, images);
	return config.limiter === void 0 ? invoke() : config.limiter.run(invoke, signal);
}
/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
async function callVerifierText(config, prompt, signal) {
	const invoke = () => callExplicitTag(config, prompt, signal);
	return config.limiter === void 0 ? invoke() : config.limiter.run(invoke, signal);
}
function addUsage(target, source) {
	for (const key of [
		"calls",
		"attempts",
		"retries",
		"inputTokens",
		"cachedInputTokens",
		"outputTokens",
		"reasoningTokens"
	]) target[key] += source[key];
}
function emptyUsage() {
	return {
		calls: 0,
		attempts: 0,
		retries: 0,
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0
	};
}
//#endregion
export { emptyUsage as a, resolveCapabilityFile as c, callVerifierText as i, addUsage as n, predictScoringChannel as o, callVerifier as r, TopLogprobCapabilityCache as s, RequestLimiter as t };

//# sourceMappingURL=caller-Ci8adPPv.js.map