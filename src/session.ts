import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { VerifierImage } from './caller.ts'

/**
 * Read one session's event log.
 *
 * DSH 0.1.5 replaced the `events` array with `snapshotEvents()`; older hosts
 * expose the array directly. Both shapes are accepted so the plugin keeps
 * working across the versions it declares support for.
 * @param session - Agent session, or any object exposing one of the two shapes.
 * @returns The session's events in log order, or an empty array.
 */
export function sessionEvents(session: unknown): readonly SessionEvent[] {
  const candidate = session as { snapshotEvents?: () => readonly SessionEvent[]; events?: readonly SessionEvent[] } | undefined
  if (typeof candidate?.snapshotEvents === 'function') return candidate.snapshotEvents()
  return candidate?.events ?? []
}

export interface SessionExtractOptions {
  fromSeq?: number
  toSeq?: number
  includeAssistantText?: boolean
  redactPatterns?: readonly string[]
  maxChars?: number
}

export interface SessionExtraction {
  problem: string
  trace: string
  images: VerifierImage[]
  sessionId: string
  fromSeq: number
  toSeq: number
  omittedCharacters: number
}

function textOf(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    const blockType = (block as { type: string }).type
    if (blockType === 'text') parts.push((block as Extract<ContentBlock, { type: 'text' }>).text)
    else if (blockType === 'reasoning') parts.push('[Reasoning] ' + (block as Extract<ContentBlock, { type: 'reasoning' }>).text)
    else if (blockType === 'tool-call') parts.push('[Tool Call] ' + (block as Extract<ContentBlock, { type: 'tool-call' }>).name + ' ' + (block as Extract<ContentBlock, { type: 'tool-call' }>).arguments)
    else if (blockType === 'tool-result') parts.push('[Tool Result] ' + textOf((block as Extract<ContentBlock, { type: 'tool-result' }>).content))
    else if (blockType === 'file') {
      const fileData = block as unknown as { path?: string; filename?: string; title?: string }
      parts.push('[File] ' + (fileData.path ?? fileData.filename ?? fileData.title ?? 'attachment'))
    }
  }
  return parts.join('\n')
}

export const DEFAULT_REDACT_PATTERNS = [
  'Bearer\\s+[A-Za-z0-9._~+\\/=-]+',
  "(?:api[_-]?key|token|password|secret)\\s*[=:]\\s*[\"']?[^\\s,\"';}]+",
] as const

function validateRedactPattern(pattern: string): void {
  if (pattern.length === 0 || pattern.length > 500) throw new Error('llm-verifier: redact patterns must contain 1-500 characters')
  // Reject common nested/unbounded constructs that can cause catastrophic backtracking.
  if (/\([^)]*[+*][^)]*\)[+*{]|\.\*[+*{]|\.\+[+*{]/u.test(pattern)) throw new Error('llm-verifier: unsafe redact pattern')
}

export function redactText(text: string, patterns: readonly string[] = DEFAULT_REDACT_PATTERNS): string {
  let result = text
  for (const pattern of patterns) {
    validateRedactPattern(pattern)
    let regex: RegExp
    try { regex = new RegExp(pattern, 'giu') } catch { throw new Error('llm-verifier: invalid redact pattern: ' + pattern) }
    result = result.replace(regex, '[REDACTED]')
  }
  return result
}

export function sanitizeVerifierText(text: string, maxChars: number, patterns: readonly string[] = DEFAULT_REDACT_PATTERNS): string {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('llm-verifier: sanitizer maxChars must be a positive integer')
  const redacted = redactText(text, patterns).trim()
  if (redacted.length <= maxChars) return redacted
  // The truncation notice is part of the returned value, so it must fit inside
  // the same budget. Callers such as boundDecision() treat maxChars as a hard
  // cap, so appending the notice past the cap would reject the whole decision
  // instead of using the truncated text.
  const notice = '\n[Truncated ' + (redacted.length - maxChars) + ' characters]'
  if (notice.length >= maxChars) return redacted.slice(0, maxChars)
  return redacted.slice(0, maxChars - notice.length) + notice
}

export async function extractSession(agent: Agent, loadImage: (ref: Extract<ContentBlock, { type: 'image' }>['attachment']) => Promise<VerifierImage>, options: SessionExtractOptions = {}): Promise<SessionExtraction> {
  const all = sessionEvents(agent.session)
  const from = options.fromSeq ?? 0
  const to = options.toSeq ?? Number.MAX_SAFE_INTEGER
  const events = all.filter(event => event.seq >= from && event.seq <= to)
  const patterns = [...DEFAULT_REDACT_PATTERNS, ...(options.redactPatterns ?? [])]
  let problem = ''
  const trace: string[] = []
  const images: VerifierImage[] = []
  for (const rawEvent of events) {
    const event = rawEvent as unknown as { type: string; seq: number; data: any }
    if (event.type === 'user/message') {
      const sourceKind = event.data?.source?.kind as string
      if (sourceKind !== 'user' && sourceKind !== 'team-message') continue
      const text = textOf(event.data.content)
      if (!problem && sourceKind === 'user' && text.trim()) problem = text.trim()
      for (const block of event.data.content) if (block.type === 'image') images.push(await loadImage(block.attachment))
      const tag = sourceKind === 'team-message' ? 'Team Message' : 'User'
      trace.push('--- ' + tag + ' seq ' + event.seq + ' ---\n' + text)
    } else if (event.type === 'assistant/message' && options.includeAssistantText !== false) {
      trace.push('--- Assistant turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n' + textOf(event.data.message.content))
    } else if (event.type === 'tool/call') {
      trace.push('--- Tool Call turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Command] ' + event.data.name + ' ' + event.data.arguments)
    } else if (event.type === 'tool/result') {
      trace.push('--- Tool Result turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Output] ' + textOf(event.data.message.content))
    } else if (event.type === 'tool/ptc-dispatch' || event.type === 'tool/code-dispatch') {
      const data = event.data as { name: string; arguments?: unknown; isError?: boolean; content?: readonly ContentBlock[] }
      const status = data.isError ? ' [Error]' : ''
      const args = data.arguments !== undefined ? ' ' + (typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments)) : ''
      const content = Array.isArray(data.content) ? textOf(data.content) : ''
      if (Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'image') images.push(await loadImage(block.attachment))
        }
      }
      const label = event.type === 'tool/ptc-dispatch' ? 'PTC Dispatch ' : 'Code Dispatch '
      trace.push('--- ' + label + data.name + status + ' seq ' + event.seq + ' ---\n[Command] ' + data.name + args + '\n[Output] ' + content)
    } else if (event.type === 'team/message/queued') {
      const data = event.data as { message?: { senderName?: string; targetId?: string; content?: readonly ContentBlock[] } }
      const sender = data?.message?.senderName ?? 'Teammate'
      const content = Array.isArray(data?.message?.content) ? textOf(data.message!.content) : ''
      trace.push('--- Team Message Queued from ' + sender + ' seq ' + event.seq + ' ---\n' + content)
    }
  }
  const raw = redactText(trace.join('\n\n'), patterns)
  const maxChars = options.maxChars ?? 200000
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('llm-verifier: extractSession maxChars must be a positive integer')
  const omittedCharacters = Math.max(0, raw.length - maxChars)
  // The truncation notice is part of the returned value, so it has to fit inside the
  // same budget: callers treat maxChars as a hard cap (see sanitizeVerifierText). The
  // newest trace text is what the judge needs, so the head is what gets dropped.
  const notice = '[Earlier trace truncated: ' + omittedCharacters + ' characters omitted]\n'
  const bounded = omittedCharacters === 0
    ? raw
    : notice.length >= maxChars ? raw.slice(-maxChars) : notice + raw.slice(-(maxChars - notice.length))
  return { problem: redactText(problem, patterns), trace: bounded, images, sessionId: String(agent.id), fromSeq: events[0]?.seq ?? from, toSeq: events.at(-1)?.seq ?? from, omittedCharacters }
}
