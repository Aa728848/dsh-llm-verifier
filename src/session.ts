import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { VerifierImage } from './caller.ts'

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
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'reasoning') parts.push('[Reasoning] ' + block.text)
    else if (block.type === 'tool-call') parts.push('[Tool Call] ' + block.name + ' ' + block.arguments)
    else if (block.type === 'tool-result') parts.push('[Tool Result] ' + textOf(block.content))
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
  return redacted.length <= maxChars ? redacted : redacted.slice(0, maxChars) + '\n[Truncated ' + (redacted.length - maxChars) + ' characters]'
}

export async function extractSession(agent: Agent, loadImage: (ref: Extract<ContentBlock, { type: 'image' }>['attachment']) => Promise<VerifierImage>, options: SessionExtractOptions = {}): Promise<SessionExtraction> {
  const all = agent.session.events as readonly SessionEvent[]
  const from = options.fromSeq ?? 0
  const to = options.toSeq ?? Number.MAX_SAFE_INTEGER
  const events = all.filter(event => event.seq >= from && event.seq <= to)
  const patterns = [...DEFAULT_REDACT_PATTERNS, ...(options.redactPatterns ?? [])]
  let problem = ''
  const trace: string[] = []
  const images: VerifierImage[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      const text = textOf(event.data.content)
      if (!problem && text.trim()) problem = text.trim()
      for (const block of event.data.content) if (block.type === 'image') images.push(await loadImage(block.attachment))
      trace.push('--- User seq ' + event.seq + ' ---\n' + text)
    } else if (event.type === 'assistant/message' && options.includeAssistantText !== false) {
      trace.push('--- Assistant turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n' + textOf(event.data.message.content))
    } else if (event.type === 'tool/call') {
      trace.push('--- Tool Call turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Command] ' + event.data.name + ' ' + event.data.arguments)
    } else if (event.type === 'tool/result') {
      trace.push('--- Tool Result turn ' + event.data.turn + ' step ' + event.data.step + ' ---\n[Output] ' + textOf(event.data.message.content))
    }
  }
  const raw = redactText(trace.join('\n\n'), patterns)
  const maxChars = options.maxChars ?? 200000
  const omittedCharacters = Math.max(0, raw.length - maxChars)
  const bounded = omittedCharacters ? '[Earlier trace truncated: ' + omittedCharacters + ' characters omitted]\n' + raw.slice(-maxChars) : raw
  return { problem: redactText(problem, patterns), trace: bounded, images, sessionId: String(agent.id), fromSeq: events[0]?.seq ?? from, toSeq: events.at(-1)?.seq ?? from, omittedCharacters }
}
