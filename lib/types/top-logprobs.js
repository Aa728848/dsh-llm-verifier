import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
export class TopLogprobsUnsupportedError extends Error {
    constructor(message) { super(message); this.name = 'TopLogprobsUnsupportedError'; }
}
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function endpoint(baseURL) { return baseURL.replace(/\/+$/, '') + '/chat/completions'; }
function dataUrl(image) { return 'data:' + image.mediaType + ';base64,' + Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).toString('base64'); }
async function credential(ctx, name) {
    if (!name)
        return undefined;
    const provider = ctx.get('credentials');
    return (await provider?.resolve(credentialRef(name)))?.value;
}
export async function resolveTopLogprobRoute(ctx, provider) {
    const settings = ctx.get('settings');
    if (provider === 'deepseek-official') {
        const value = settings ? object(settings.get(settingsNamespace('llm-deepseek'))) ?? {} : {};
        const apiKeyEnv = text(value.apiKeyEnv) ?? 'DEEPSEEK_API_KEY';
        const apiKey = await credential(ctx, apiKeyEnv);
        if (!apiKey)
            return undefined;
        return { baseURL: text(value.baseURL) ?? 'https://api.deepseek.com', apiKey, deepSeekThinking: true };
    }
    if (!settings)
        return undefined;
    const root = object(settings.get(settingsNamespace('llm-pi-ai')));
    const profiles = object(root?.providers);
    const profile = object(profiles?.[provider]);
    // Only explicitly OpenAI-compatible profiles are safe to serialize directly.
    // Other DSH adapters keep their private protocol and use the explicit-tag fallback.
    if (!profile || profile.api !== 'openai-completions')
        return undefined;
    const baseURL = text(profile.baseURL);
    if (!baseURL || !/^https:\/\//i.test(baseURL))
        return undefined;
    const apiKey = await credential(ctx, text(profile.apiKeyEnv));
    const rawHeaders = object(profile.headers);
    const headers = rawHeaders === undefined ? undefined : Object.fromEntries(Object.entries(rawHeaders).filter((entry) => typeof entry[1] === 'string'));
    return { baseURL, ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), deepSeekThinking: false };
}
export async function callTopLogprobs(route, model, prompt, maxTokens, reasoningEffort, signal, images) {
    const content = images?.length ? [{ type: 'text', text: prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: dataUrl(image) } }))] : prompt;
    const thinking = route.deepSeekThinking && reasoningEffort ? reasoningEffort === 'off' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort } : {};
    const response = await fetch(endpoint(route.baseURL), {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', ...(route.apiKey ? { authorization: 'Bearer ' + route.apiKey } : {}), ...route.headers },
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: maxTokens, temperature: 1, logprobs: true, top_logprobs: 20, ...thinking }),
    });
    const raw = await response.text();
    if (!response.ok) {
        const excerpt = raw.slice(0, 1000);
        if ([400, 404, 405, 415, 422].includes(response.status) && /logprob|top_logprobs|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|not support/i.test(excerpt))
            throw new TopLogprobsUnsupportedError('provider rejected top_logprobs: HTTP ' + response.status + ' ' + excerpt);
        throw new Error('llm-verifier: top_logprobs request failed with HTTP ' + response.status + ': ' + excerpt);
    }
    let body;
    try {
        body = object(JSON.parse(raw)) ?? {};
    }
    catch {
        throw new Error('llm-verifier: top_logprobs endpoint returned invalid JSON');
    }
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const choice = object(choices[0]);
    const message = object(choice?.message);
    const answer = typeof message?.content === 'string' ? message.content : '';
    const logprobs = object(choice?.logprobs);
    const rows = Array.isArray(logprobs?.content) ? logprobs.content : [];
    if (!rows.length)
        throw new TopLogprobsUnsupportedError('provider returned no token logprobs');
    const tokens = [];
    const positions = [];
    for (const rawRow of rows) {
        const row = object(rawRow) ?? {};
        const token = typeof row.token === 'string' ? row.token : '';
        tokens.push(token);
        const top = Array.isArray(row.top_logprobs) ? row.top_logprobs : [];
        const alternatives = top.flatMap(value => { const item = object(value); return item && typeof item.token === 'string' && typeof item.logprob === 'number' ? [{ token: item.token, logprob: item.logprob }] : []; });
        if (!alternatives.length && typeof row.logprob === 'number')
            alternatives.push({ token, logprob: row.logprob });
        positions.push(alternatives);
    }
    const rawUsage = object(body.usage) ?? {};
    const promptDetails = object(rawUsage.prompt_tokens_details) ?? {};
    const completionDetails = object(rawUsage.completion_tokens_details) ?? {};
    const cached = Number(rawUsage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? 0) || 0;
    const input = Number(rawUsage.prompt_tokens ?? 0) || 0;
    return { text: answer, tokens, positions, scoringMode: 'top-logprobs', usage: { calls: 1, attempts: 1, retries: 0, inputTokens: Math.max(0, input - cached), cachedInputTokens: cached, outputTokens: Number(rawUsage.completion_tokens ?? 0) || 0, reasoningTokens: Number(completionDetails.reasoning_tokens ?? 0) || 0 } };
}
/** Marks older than this are dropped on hydration so a provider that later gains logprobs support is re-probed. */
export const CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
/** Resolves the capability memory file beside the score cache inside the topic verifier directory. */
export function resolveCapabilityFile(cacheDir, cwd = process.cwd()) {
    const root = isAbsolute(cacheDir) ? cacheDir : resolve(cwd, cacheDir);
    return join(root, 'capabilities-v1.json');
}
export class TopLogprobCapabilityCache {
    file;
    now;
    unsupported = new Map();
    loaded = false;
    hydrating;
    writing = Promise.resolve();
    constructor(file, now = Date.now) {
        this.file = file;
        this.now = now;
    }
    isUnsupported(provider, model) { return this.unsupported.has(provider + '\0' + model); }
    /** Hydrates persisted marks once; in-process marks always win over file contents. */
    async ensureLoaded() {
        if (this.loaded || this.file === undefined)
            return;
        this.hydrating ??= (async () => {
            try {
                const document = JSON.parse(await readFile(this.file, 'utf8'));
                const entries = document !== null && typeof document === 'object' && document.version === 1 && typeof document.entries === 'object' && document.entries !== null ? document.entries : {};
                const now = this.now();
                for (const [key, markedAt] of Object.entries(entries)) {
                    if (typeof markedAt !== 'number' || !Number.isFinite(markedAt) || markedAt < 0 || now - markedAt > CAPABILITY_TTL_MS)
                        continue;
                    // Max-merge: never let an older persisted stamp clobber a fresher in-process probe.
                    const existing = this.unsupported.get(key);
                    if (existing === undefined || existing < markedAt)
                        this.unsupported.set(key, markedAt);
                }
            }
            catch { /* a missing or unreadable file simply starts empty */ }
            this.loaded = true;
        })();
        await this.hydrating;
    }
    markUnsupported(provider, model) {
        this.unsupported.set(provider + '\0' + model, this.now());
        if (this.file === undefined)
            return;
        // Serialize behind hydration so an early mark never clobbers not-yet-loaded entries.
        this.writing = this.writing
            .then(() => this.ensureLoaded())
            .then(async () => {
            const snapshot = { version: 1, entries: Object.fromEntries(this.unsupported) };
            await mkdir(dirname(this.file), { recursive: true });
            const temporary = this.file + '.tmp-' + process.pid;
            await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
            try {
                await rename(temporary, this.file);
            }
            catch (error) {
                await unlink(temporary).catch(() => { });
                throw error;
            }
        })
            .catch(() => { });
    }
    /** Resolves once the trailing persistence attempt settles; exposed for tests. */
    flush() { return this.writing; }
}
//# sourceMappingURL=top-logprobs.js.map