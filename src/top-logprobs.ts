import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CompletionLogprobs, TokenAlternative } from './core.ts'
import type { UsageStats, VerifierImage } from './caller.ts'

export interface TopLogprobRoute {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  deepSeekThinking: boolean
}
export interface TopLogprobCompletion extends CompletionLogprobs { usage: UsageStats; scoringMode: 'top-logprobs' }
export class TopLogprobsUnsupportedError extends Error { constructor(message: string) { super(message); this.name = 'TopLogprobsUnsupportedError' } }

function object(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function endpoint(baseURL: string): string { return baseURL.replace(/\/+$/, '') + '/chat/completions' }
function dataUrl(image: VerifierImage): string { return 'data:' + image.mediaType + ';base64,' + Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).toString('base64') }

async function credential(ctx: Context, name: string | undefined): Promise<string | undefined> {
  if (!name) return undefined
  const provider = ctx.get('credentials')
  return (await provider?.resolve(credentialRef(name)))?.value
}

export async function resolveTopLogprobRoute(ctx: Context, provider: string): Promise<TopLogprobRoute | undefined> {
  const settings = ctx.get('settings')
  if (provider === 'deepseek-official') {
    const value = settings ? object(settings.get(settingsNamespace('llm-deepseek'))) ?? {} : {}
    const apiKeyEnv = text(value.apiKeyEnv) ?? 'DEEPSEEK_API_KEY'
    const apiKey = await credential(ctx, apiKeyEnv)
    if (!apiKey) return undefined
    return { baseURL: text(value.baseURL) ?? 'https://api.deepseek.com', apiKey, deepSeekThinking: true }
  }
  if (!settings) return undefined
  const root = object(settings.get(settingsNamespace('llm-pi-ai')))
  const profiles = object(root?.providers)
  const profile = object(profiles?.[provider])
  // Only explicitly OpenAI-compatible profiles are safe to serialize directly.
  // Other DSH adapters keep their private protocol and use the explicit-tag fallback.
  if (!profile || profile.api !== 'openai-completions') return undefined
  const baseURL = text(profile.baseURL)
  if (!baseURL || !/^https:\/\//i.test(baseURL)) return undefined
  const apiKey = await credential(ctx, text(profile.apiKeyEnv))
  const rawHeaders = object(profile.headers)
  const headers = rawHeaders === undefined ? undefined : Object.fromEntries(Object.entries(rawHeaders).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return { baseURL, ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), deepSeekThinking: false }
}

export async function callTopLogprobs(route: TopLogprobRoute, model: string, prompt: string, maxTokens: number, reasoningEffort: string | undefined, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<TopLogprobCompletion> {
  const content: string | Record<string, unknown>[] = images?.length ? [{ type: 'text', text: prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: dataUrl(image) } }))] : prompt
  const thinking = route.deepSeekThinking && reasoningEffort ? reasoningEffort === 'off' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort } : {}
  const response = await fetch(endpoint(route.baseURL), {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json', ...(route.apiKey ? { authorization: 'Bearer ' + route.apiKey } : {}), ...route.headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: maxTokens, temperature: 1, logprobs: true, top_logprobs: 20, ...thinking }),
  })
  const raw = await response.text()
  if (!response.ok) {
    const excerpt = raw.slice(0, 1000)
    if ([400, 404, 405, 415, 422].includes(response.status) && /logprob|top_logprobs|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|not support/i.test(excerpt)) throw new TopLogprobsUnsupportedError('provider rejected top_logprobs: HTTP ' + response.status + ' ' + excerpt)
    throw new Error('llm-verifier: top_logprobs request failed with HTTP ' + response.status + ': ' + excerpt)
  }
  let body: Record<string, unknown>
  try { body = object(JSON.parse(raw)) ?? {} } catch { throw new Error('llm-verifier: top_logprobs endpoint returned invalid JSON') }
  const choices = Array.isArray(body.choices) ? body.choices : []
  const choice = object(choices[0])
  const message = object(choice?.message)
  const answer = typeof message?.content === 'string' ? message.content : ''
  const logprobs = object(choice?.logprobs)
  const rows = Array.isArray(logprobs?.content) ? logprobs.content : []
  if (!rows.length) throw new TopLogprobsUnsupportedError('provider returned no token logprobs')
  const tokens: string[] = []
  const positions: TokenAlternative[][] = []
  for (const rawRow of rows) {
    const row = object(rawRow) ?? {}
    const token = typeof row.token === 'string' ? row.token : ''
    tokens.push(token)
    const top = Array.isArray(row.top_logprobs) ? row.top_logprobs : []
    const alternatives = top.flatMap(value => { const item = object(value); return item && typeof item.token === 'string' && typeof item.logprob === 'number' ? [{ token: item.token, logprob: item.logprob }] : [] })
    if (!alternatives.length && typeof row.logprob === 'number') alternatives.push({ token, logprob: row.logprob })
    positions.push(alternatives)
  }
  const rawUsage = object(body.usage) ?? {}
  const promptDetails = object(rawUsage.prompt_tokens_details) ?? {}
  const completionDetails = object(rawUsage.completion_tokens_details) ?? {}
  const cached = Number(rawUsage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? 0) || 0
  const input = Number(rawUsage.prompt_tokens ?? 0) || 0
  return { text: answer, tokens, positions, scoringMode: 'top-logprobs', usage: { calls: 1, attempts: 1, retries: 0, inputTokens: Math.max(0, input - cached), cachedInputTokens: cached, outputTokens: Number(rawUsage.completion_tokens ?? 0) || 0, reasoningTokens: Number(completionDetails.reasoning_tokens ?? 0) || 0 } }
}

export class TopLogprobCapabilityCache {
  private readonly unsupported = new Set<string>()
  isUnsupported(provider: string, model: string): boolean { return this.unsupported.has(provider + '\0' + model) }
  markUnsupported(provider: string, model: string): void { this.unsupported.add(provider + '\0' + model) }
}
