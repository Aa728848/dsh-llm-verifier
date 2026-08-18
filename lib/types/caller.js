import { BlockAssembler, ReasoningEffortId, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm';
import { TopLogprobCapabilityCache, TopLogprobsUnsupportedError, callTopLogprobs, resolveTopLogprobRoute } from "./top-logprobs.js";
function failureMessage(finish) {
    if (finish.kind === 'error' || finish.kind === 'aborted')
        return finish.failure.message;
    if (finish.kind === 'max-tokens')
        return 'verifier response reached max tokens before completing its answer';
    return undefined;
}
async function delay(ms, signal) {
    if (signal?.aborted)
        throw signal.reason;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        signal?.addEventListener('abort', abort, { once: true });
    });
}
function usage(attempts, value = {}) {
    return { calls: 1, attempts, retries: attempts - 1, inputTokens: value.inputTokens ?? 0, cachedInputTokens: (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0), outputTokens: value.outputTokens ?? 0, reasoningTokens: value.reasoningTokens ?? 0 };
}
async function callExplicitTag(config, prompt, signal, images) {
    let attempt = 0;
    while (true) {
        attempt += 1;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('llm-verifier: request timed out')), config.timeoutMs);
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const content = [{ type: 'text', text: prompt }];
            for (const image of images ?? []) {
                const ref = await config.attachments.saveImage({ data: image.data, mediaType: image.mediaType });
                content.push({ type: 'image', attachment: ref });
            }
            const messages = [createUserMessage({ content, source: { kind: 'plugin', plugin: 'dsh-llm-verifier' } })];
            const assembler = new BlockAssembler();
            const options = deepFreeze({
                provider: config.provider,
                model: config.model,
                ...(config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(config.reasoningEffort) } : {}),
                messages,
                maxTokens: config.maxTokens,
                temperature: 1,
                signal: controller.signal,
            });
            for await (const chunk of config.llm.stream(options))
                assembler.push(chunk);
            const failed = failureMessage(assembler.finish);
            if (failed !== undefined)
                throw new Error('llm-verifier: model call failed: ' + failed);
            const text = assembler.blocks().filter((block) => block.type === 'text').map(block => block.text).join('');
            if (!text.trim())
                throw new Error('llm-verifier: selected DSH model produced no text');
            // DSH adapters expose provider-neutral text/usage but not top-logprob candidates.
            // extractScore() therefore uses the model's explicit final A–T tags.
            return { text, tokens: [], positions: [], scoringMode: 'explicit-tag', usage: usage(attempt, assembler.usage) };
        }
        catch (error) {
            if (signal?.aborted)
                throw signal.reason;
            if (attempt > config.maxRetries || !(error instanceof Error) || !/rate|quota|timeout|timed out|temporar|network|fetch|socket|5dd/i.test(error.message))
                throw error;
            await delay(Math.min(30000, config.retryBaseDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4)), signal);
        }
        finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        }
    }
}
export class RequestLimiter {
    limit;
    active = 0;
    queue = [];
    constructor(limit) {
        this.limit = limit;
    }
    async run(operation, signal) {
        if (this.active >= this.limit)
            await new Promise((resolve, reject) => {
                const enter = () => { signal?.removeEventListener('abort', abort); resolve(); };
                const abort = () => { const index = this.queue.indexOf(enter); if (index >= 0)
                    this.queue.splice(index, 1); reject(signal?.reason); };
                this.queue.push(enter);
                signal?.addEventListener('abort', abort, { once: true });
            });
        if (signal?.aborted)
            throw signal.reason;
        this.active += 1;
        try {
            return await operation();
        }
        finally {
            this.active -= 1;
            this.queue.shift()?.();
        }
    }
}
async function callAutomatic(config, prompt, signal, images) {
    if (!config.topLogprobCapabilities.isUnsupported(config.provider, config.model)) {
        const route = await resolveTopLogprobRoute(config.ctx, config.provider);
        if (route !== undefined) {
            try {
                return await callTopLogprobs(route, config.model, prompt, config.maxTokens, config.reasoningEffort, signal, images);
            }
            catch (error) {
                if (!(error instanceof TopLogprobsUnsupportedError))
                    throw error;
                config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
            }
        }
        else
            config.topLogprobCapabilities.markUnsupported(config.provider, config.model);
    }
    return callExplicitTag(config, prompt, signal, images);
}
export async function callVerifier(config, prompt, signal, images) {
    const invoke = () => callAutomatic(config, prompt, signal, images);
    return config.limiter === undefined ? invoke() : config.limiter.run(invoke, signal);
}
export function addUsage(target, source) { for (const key of ['calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'])
    target[key] += source[key]; }
export function emptyUsage() { return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }; }
//# sourceMappingURL=caller.js.map