import * as LlmModule from "@deepseek-ai/dsh-llm";
import { BlockAssembler, ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";
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
/**
* A provider-level rejection of the direct transport that is not a logprobs
* capability answer (bad request, auth, quota, malformed body). It downgrades
* this topic to the DSH stream instead of failing the whole verification.
*/
var TopLogprobsRouteError = class extends TopLogprobsUnsupportedError {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
		this.name = "TopLogprobsRouteError";
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
		const value = settings ? object(settings.get("llm-deepseek")) ?? {} : {};
		const apiKey = await credential(ctx, text(value.apiKeyEnv) ?? "DEEPSEEK_API_KEY");
		if (!apiKey) return void 0;
		return {
			baseURL: text(value.baseURL) ?? "https://api.deepseek.com",
			apiKey,
			deepSeekThinking: true
		};
	}
	if (!settings) return void 0;
	const profile = object(object(object(settings.get("llm-pi-ai"))?.providers)?.[provider]);
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
async function callTopLogprobs(route, model, prompt, maxTokens, reasoningEffort, signal, images, attempt = 1, temperature = .2) {
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
			temperature,
			logprobs: true,
			top_logprobs: 20,
			...thinking
		})
	});
	const raw = await response.text();
	if (!response.ok) {
		const excerpt = raw.slice(0, 1e3);
		const message = "llm-verifier: top_logprobs request failed with HTTP " + response.status + ": " + excerpt;
		if ([
			400,
			404,
			405,
			415,
			422
		].includes(response.status) && /logprob|top_logprobs|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|not support/i.test(excerpt)) throw new TopLogprobsUnsupportedError("provider rejected top_logprobs: HTTP " + response.status + " " + excerpt);
		if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) throw new Error(message);
		throw new TopLogprobsRouteError(message, response.status);
	}
	let body;
	try {
		body = object(JSON.parse(raw)) ?? {};
	} catch {
		throw new TopLogprobsRouteError("llm-verifier: top_logprobs endpoint returned invalid JSON", response.status);
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
			attempts: attempt,
			retries: attempt - 1,
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
	/** Expired marks are dropped so a provider that later gains logprobs support is re-probed. */
	isUnsupported(provider, model) {
		const key = provider + "\0" + model;
		const markedAt = this.unsupported.get(key);
		if (markedAt === void 0) return false;
		if (this.now() - markedAt > 864e5) {
			this.unsupported.delete(key);
			return false;
		}
		return true;
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
		this.persist();
	}
	/**
	* Forget one provider/model mark so the next call re-probes instead of replaying a cached answer.
	*
	* The judge probe exists to answer "which scoring channel is this judge on". Replaying a mark
	* written up to {@link CAPABILITY_TTL_MS} ago — possibly under a different provider
	* configuration — would answer a different, stale question. The removal is persisted, so a host
	* restart cannot resurrect the old mark.
	*
	* The delete is repeated INSIDE the serialized write: hydration max-merges the file into memory,
	* so deleting only beforehand would let the very write we schedule put the entry back.
	* @param provider - provider id the mark belongs to.
	* @param model - model id the mark belongs to.
	*/
	forget(provider, model) {
		const key = provider + "\0" + model;
		this.unsupported.delete(key);
		if (this.file === void 0) return;
		this.writing = this.writing.then(() => this.ensureLoaded()).then(() => {
			this.unsupported.delete(key);
			return this.writeDocument();
		}).catch(() => {});
	}
	/** Serialize behind hydration so an early mark never clobbers not-yet-loaded entries. */
	persist() {
		if (this.file === void 0) return;
		this.writing = this.writing.then(() => this.ensureLoaded()).then(() => this.writeDocument()).catch(() => {});
	}
	async writeDocument() {
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
	}
	/** Resolves once the trailing persistence attempt settles; exposed for tests. */
	flush() {
		return this.writing;
	}
};
//#endregion
//#region src/caller.ts
function deepFreeze(value) {
	const mod = LlmModule;
	if (typeof mod.deepFreeze === "function") return mod.deepFreeze(value);
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze(value[key]);
	}
	return value;
}
/**
* Where a finally-failed request records how many attempts it already spent.
*
* A failure that never returned usage leaves the tokens UNKNOWN, not zero. The attempt
* count is the one fact the transport does know, so it is carried on the error itself
* (the engine catches per-judge errors) instead of being discarded.
*/
const REQUEST_ATTEMPTS = Symbol("llm-verifier.requestAttempts");
/** Attempts one failed verifier request already spent; 0 when the error carries none. */
function requestAttempts(error) {
	if (typeof error !== "object" || error === null) return 0;
	const value = error[REQUEST_ATTEMPTS];
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
/**
* Usage the transport DID return for a response that then turned out unusable.
*
* A parse failure or a truncated judge answer happened after the request was billed, so the
* engine must not fold it into a zero-cost failure. The usage rides on the error next to the
* attempt count; one error can carry both (a retried call whose final answer also failed).
*/
const PARTIAL_USAGE = Symbol("llm-verifier.partialUsage");
/** Usage a completed-but-unusable response already cost; undefined when the error carries none. */
function partialUsage(error) {
	if (typeof error !== "object" || error === null) return void 0;
	const value = error[PARTIAL_USAGE];
	return typeof value === "object" && value !== null ? value : void 0;
}
/** Attach the usage a completed-but-unusable response already cost to its error. */
function attachUsage(error, usage) {
	if (typeof error === "object" && error !== null) error[PARTIAL_USAGE] = usage;
}
/**
* An error for a response that came back and was billed but produced no usable verdict.
*
* The usage is attached so the failure row reports known requests and tokens instead of zero.
*/
function unusable(reason, attempt, raw) {
	const error = /* @__PURE__ */ new Error("llm-verifier: " + reason);
	attachUsage(error, usage(attempt, raw ?? {}));
	return error;
}
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
/** Transient failures worth another attempt; anything else fails fast. */
const RETRYABLE_MESSAGE = /rate|quota|timeout|timed out|temporar|network|fetch|socket|5\d\d/i;
/**
* Run one logical verifier request under the configured timeout, retrying
* transient failures with exponential backoff.
*
* Every channel goes through this wrapper — including the direct top_logprobs
* transport, which used to bypass both the timeout and the retry budget.
* @param config - resolved verifier client configuration.
* @param signal - caller's abort signal (tool call or turn boundary).
* @param run - one attempt; receives its own deadline signal and 1-based attempt number.
* @returns The first successful completion.
*/
function attachAttempts(error, attempt) {
	if (typeof error === "object" && error !== null) error[REQUEST_ATTEMPTS] = attempt;
}
/**
* A fresh error for one aborted call.
*
* Never annotate and rethrow the shared `signal.reason`: several concurrent requests share it,
* and the engine attaches its accumulator to the thrown error, so one object carries several
* accumulators and they get merged repeatedly. The wrapper preserves the message and name.
*/
function abortFailure(reason, attempt) {
	const source = reason instanceof Error ? reason : new Error(reason === void 0 ? "llm-verifier: request aborted" : String(reason));
	const error = new Error(source.message);
	error.name = source.name;
	attachAttempts(error, attempt);
	return error;
}
/** Token-only addition: call/attempt counters already describe the logical request. */
function addTokens(target, source) {
	target.inputTokens += source.inputTokens;
	target.cachedInputTokens += source.cachedInputTokens;
	target.outputTokens += source.outputTokens;
	target.reasoningTokens += source.reasoningTokens;
}
async function retrying(config, signal, run) {
	let attempt = 0;
	const carried = {
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0
	};
	let unknownFailure = false;
	while (true) {
		if (signal?.aborted) throw abortFailure(signal.reason, attempt);
		attempt += 1;
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort(/* @__PURE__ */ new Error("llm-verifier: request timed out"));
		}, config.timeoutMs);
		const abort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const value = await run(controller.signal, attempt);
			if (typeof value === "object" && value !== null) {
				const usage = value.usage;
				if (usage !== void 0) {
					addTokens(usage, carried);
					if (unknownFailure) usage.usageIncomplete = true;
				}
			}
			return value;
		} catch (error) {
			if (signal?.aborted) throw abortFailure(signal.reason ?? error, attempt);
			const retryable = timedOut || error instanceof Error && RETRYABLE_MESSAGE.test(error.message);
			if (attempt > config.maxRetries || !retryable) {
				attachAttempts(error, attempt);
				throw error;
			}
			const billed = partialUsage(error);
			if (billed === void 0) unknownFailure = true;
			else addTokens(carried, billed);
			try {
				await delay(Math.min(3e4, config.retryBaseDelayMs * 2 ** (attempt - 1) * (.8 + Math.random() * .4)), signal);
			} catch (waitError) {
				throw abortFailure(signal?.reason ?? waitError, attempt);
			}
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		}
	}
}
/** One attachment per image object per process: retries must not duplicate attachments. */
const imageRefs = /* @__PURE__ */ new WeakMap();
/**
* One plain-text completion through the DSH stream.
*
* Shared by the explicit-tag judge path and by best-of-N generation, which differ in exactly one
* place: a `max-tokens` finish. A truncated JUDGE answer is unusable — its verdict tags may never
* have been emitted — so it stays a hard error. A truncated DRAFT is still a candidate the operator
* already paid for, and the judge can see that the text stops mid-sentence and score it accordingly,
* so generation receives the text plus a `truncated` flag.
* @param config - resolved verifier client configuration.
* @param prompt - the rendered prompt.
* @param signal - the attempt's deadline signal.
* @param images - attachments to send, if any.
* @param attempt - 1-based attempt number for usage accounting.
* @param tolerateTruncation - return the text of a max-tokens finish instead of throwing.
* @returns The completion (with `truncated`) when it produced text.
*/
async function callTextCompletion(config, prompt, signal, images, attempt, tolerateTruncation) {
	const content = [{
		type: "text",
		text: prompt
	}];
	for (const image of images ?? []) {
		let pending = imageRefs.get(image);
		if (pending === void 0) {
			pending = Promise.resolve().then(() => config.attachments.saveImage({
				data: image.data,
				mediaType: image.mediaType
			})).catch((error) => {
				if (imageRefs.get(image) === pending) imageRefs.delete(image);
				throw error;
			});
			imageRefs.set(image, pending);
		}
		content.push({
			type: "image",
			attachment: await pending
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
		temperature: config.temperature,
		signal
	});
	for await (const chunk of config.llm.stream(options)) assembler.push(chunk);
	let truncated = false;
	if (assembler.finish.kind === "max-tokens") {
		if (!tolerateTruncation) throw unusable("model call failed: " + failureMessage(assembler.finish), attempt, assembler.usage);
		truncated = true;
	} else {
		const failed = failureMessage(assembler.finish);
		if (failed !== void 0) throw unusable("model call failed: " + failed, attempt, assembler.usage);
	}
	const text = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("");
	if (!text.trim()) throw unusable("selected DSH model produced no text", attempt, assembler.usage);
	return {
		text,
		tokens: [],
		positions: [],
		scoringMode: "explicit-tag",
		usage: usage(attempt, assembler.usage),
		truncated
	};
}
/** Explicit-tag judge completion: fail-closed, so a truncated answer is an error and never a score. */
async function callExplicitTag(config, prompt, signal, images, attempt) {
	return callTextCompletion(config, prompt, signal, images, attempt, false);
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
		if (signal?.aborted) throw signal.reason;
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
		if (signal?.aborted) {
			this.queue.shift()?.();
			throw signal.reason;
		}
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
async function callAutomatic(config, prompt, signal, images, attempt) {
	await config.topLogprobCapabilities.ensureLoaded();
	let fellBack = false;
	if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
		const route = await resolveTopLogprobRoute(config.ctx, config.provider);
		if (route !== void 0) try {
			return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images, attempt, config.temperature);
		} catch (error) {
			if (!(error instanceof TopLogprobsUnsupportedError)) throw error;
			config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
			fellBack = true;
		}
		else config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
	}
	const completion = await callExplicitTag(config, prompt, signal, images, attempt);
	return fellBack ? {
		...completion,
		channelFallback: true
	} : completion;
}
async function callVerifier(config, prompt, signal, images) {
	const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callAutomatic(config, prompt, attemptSignal, images, attempt));
	return config.limiter === void 0 ? invoke() : config.limiter.run(invoke, signal);
}
/**
* Best-of-N generation sampling constants.
*
* Deliberately NOT the judge's temperature: best-of-N only pays off when the drafts actually
* differ, and the judge's low default (0.2) would produce N near-copies — the tool would then
* spend N times the money choosing between the same answer.
*/
const GENERATION_TEMPERATURE = 1;
/**
* Output ceiling for one draft.
*
* 4096 was a guess in the plan, and the first real end-to-end acceptance disproved it: a
* "function + 12 test cases + a note" task truncated ALL THREE drafts, so the tool returned
* nothing at all. The measured cause is reasoning tokens: on a trivial 2-draft run the session
* model (deepseek-official/deepseek-flash) spent 16363 reasoning tokens out of 17254 output
* tokens — roughly 8k of reasoning PER DRAFT, which eats any 4096 budget before the answer starts.
*
* 16384 is about 2x that measured per-draft spend, and it is also the largest ceiling that keeps
* a pairwise judge prompt inside the plugin's own evidence limit: two drafts at 16384 tokens are
* roughly 130k characters against a 240k explicit-evidence ceiling (EXPLICIT_MAX_TOTAL_CHARS).
* `maxTokens` is a ceiling rather than a reservation, so a draft that needs less room costs
* exactly what it did before. A task whose answer genuinely needs more is too large for this tool,
* and its truncation is REPORTED instead of being silently returned.
*/
const GENERATION_MAX_TOKENS = 16384;
/**
* Re-point an existing verifier client at the model that should draft the candidates.
*
* Everything transport-shaped (context, llm runtime, attachments, capability memory, limiter,
* timeout, retry budget) is inherited; only the route and the two generation-specific scalars
* are replaced. `reasoningEffort` comes from the target and is never inherited from the base,
* because the base is a judge: a leftover judge effort would silently draft with the wrong model
* settings.
* @param base - any configured verifier client (the primary judge is the cheapest source).
* @param target - the model that writes the drafts.
* @param maxTokens - output ceiling for this attempt.
* @returns A client config safe to pass to {@link callGeneratedText}.
*/
function generationClient(base, target, maxTokens = GENERATION_MAX_TOKENS) {
	return {
		ctx: base.ctx,
		llm: base.llm,
		attachments: base.attachments,
		topLogprobCapabilities: base.topLogprobCapabilities,
		provider: target.provider,
		model: target.model,
		label: target.provider + "/" + target.model,
		...target.reasoningEffort === void 0 ? {} : { reasoningEffort: target.reasoningEffort },
		maxTokens,
		temperature: 1,
		timeoutMs: base.timeoutMs,
		maxRetries: base.maxRetries,
		retryBaseDelayMs: base.retryBaseDelayMs,
		...base.limiter === void 0 ? {} : { limiter: base.limiter }
	};
}
/**
* One best-of-N draft.
*
* A named seam over the plain-text path: generation has no A–T contract and no scoring channel, and
* the name keeps it distinct from the judge calls at every call site and in the decision snapshot.
*
* Hitting the output ceiling is deliberately NOT an error here. The operator already paid for those
* tokens, and the judge can see for itself that the text stops mid-sentence. That is exactly why the
* judge's fail-closed max-tokens handling was split out of this path: before the split, one long
* task made the whole tool return zero candidates.
* @param base - any configured verifier client (the primary judge is the cheapest source).
* @param target - the model that writes the draft (normally the session model).
* @param prompt - the rendered drafting prompt.
* @param signal - caller's abort signal.
* @returns The draft text, token usage, and whether it ran into the ceiling.
*/
async function generateCandidate(base, target, prompt, signal) {
	return callGeneratedText(generationClient(base, target), prompt, signal);
}
/** Generation transport: the judge's timeout/retry/limiter wrappers, with truncation as a result. */
async function callGeneratedText(config, prompt, signal) {
	const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callTextCompletion(config, prompt, attemptSignal, void 0, attempt, true));
	return config.limiter === void 0 ? invoke() : config.limiter.run(invoke, signal);
}
/** Plain-text verifier call for conservative JSON routing; probability labels are intentionally bypassed. */
async function callVerifierText(config, prompt, signal) {
	const invoke = () => retrying(config, signal, (attemptSignal, attempt) => callExplicitTag(config, prompt, attemptSignal, void 0, attempt));
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
	]) target[key] += source[key] ?? 0;
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
export { attachUsage as a, emptyUsage as c, partialUsage as d, predictScoringChannel as f, resolveCapabilityFile as h, addUsage as i, generateCandidate as l, TopLogprobCapabilityCache as m, GENERATION_TEMPERATURE as n, callVerifier as o, requestAttempts as p, RequestLimiter as r, callVerifierText as s, GENERATION_MAX_TOKENS as t, generationClient as u };

//# sourceMappingURL=caller-Bw6g9f3W.js.map