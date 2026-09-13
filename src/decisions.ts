import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sanitizeVerifierText } from './session.ts'

/**
 * One model call captured inside an invocation.
 *
 * Everything the plugin decides is decided inside a prompt: "why did the progress
 * judge answer K again" is a question about the exact text that was sent and the raw
 * answer that came back. The statistics store answers "how much did it cost"; this one
 * answers "why did it say that".
 */
export interface DecisionCall {
  /** Which part of the invocation made the call (criterion, repeat, phase). */
  label: string
  /** Scoring channel that answered (top-logprobs | explicit-tag). */
  channel: string
  prompt: string
  output: string
  /** The score this call produced, when it produced one. */
  score?: number
}

/** Sink the engine reports every REAL model call to (cache hits make no call). */
export type DecisionTrace = (call: DecisionCall) => void

export interface DecisionRecord {
  id: string
  toolName: string
  phase: string
  startedAt: number
  provider: string
  model: string
  calls: DecisionCall[]
}

interface DecisionsDocument {
  version: 1
  records: DecisionRecord[]
}

/** Upper bound on captured calls per invocation; a session acceptance makes six. */
const MAX_CALLS = 12
const MAX_PROMPT_CHARS = 8000
const MAX_OUTPUT_CHARS = 4000
/** Upper bound on one record's captured text, so a wide select cannot fill the file. */
const MAX_RECORD_CHARS = 30000
/** Smallest window worth storing; unreachable while MAX_CALLS stays at 12. */
const MIN_PROMPT_CHARS = 512
const MIN_OUTPUT_CHARS = 256

export function resolveDecisionsFile(cacheFile: string): string {
  return join(dirname(cacheFile), 'decisions-v1.json')
}

/**
 * Redact and bound captured calls.
 *
 * Runs the same sanitizer the prompts do, so a snapshot can never persist a secret the
 * judge itself never saw, and drops calls past the per-record budget instead of writing
 * an unbounded file.
 * @param calls - captured calls, oldest first.
 * @returns The bounded calls; empty when nothing was captured.
 */
export function boundCaptureText(text: string, maxChars: number): string {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('llm-verifier: decision capture cap must be a positive integer')
  const clean = sanitizeVerifierText(text, Math.max(1, text.length))
  if (clean.length <= maxChars || maxChars < 256) return sanitizeVerifierText(text, maxChars)
  const head = Math.floor(maxChars / 2)
  const tail = maxChars - head
  const omitted = Math.max(0, clean.length - head - tail)
  const marker = '\n[… ' + omitted + ' characters omitted …]\n'
  // The marker is charged to the tail's share, so the sum can never exceed the cap.
  const keepTail = Math.max(0, tail - marker.length)
  return clean.slice(0, head) + marker + (keepTail === 0 ? '' : clean.slice(-keepTail))
}

/**
 * Redact and bound captured calls.
 *
 * Runs the same sanitizer the prompts do, so a snapshot can never persist a secret the
 * judge itself never saw. The record is bounded twice: at {@link MAX_CALLS} calls, and at
 * {@link MAX_RECORD_CHARS} characters shared EQUALLY between the calls it keeps — a six-call
 * session acceptance must not shrink to its first three calls, and which three survived must not
 * depend on completion order. Text uses {@link boundCaptureText}, which keeps both ends: a
 * session-acceptance prompt runs past 100k characters, and head-only truncation kept the
 * instructions while dropping the trajectory tail the judge actually graded.
 * @param calls - captured calls; callers sort them by label so the bounded set is deterministic.
 * @returns The bounded calls; empty when nothing was captured.
 */
export function boundDecisionCalls(calls: readonly DecisionCall[]): DecisionCall[] {
  const selected = calls.slice(0, MAX_CALLS)
  if (selected.length === 0) return []
  // Equal share per call, not first-come-first-served. A session acceptance makes six calls on
  // ~8k-char prompts; a fixed 8k + 4k per call let only the FIRST THREE through, and which three
  // survived depended on completion order, i.e. on the network — so the most expensive path in
  // the plugin stored a different (and partial) set of criteria every time. Every call now keeps
  // a smaller window: boundCaptureText keeps both ends, so the instruction head and the graded
  // trajectory tail still survive.
  const overhead = selected.reduce((sum, call) => sum + Math.min(call.label.length, 200) + Math.min(call.channel.length, 40), 0)
  const perCall = Math.max(MIN_PROMPT_CHARS + MIN_OUTPUT_CHARS, Math.floor((MAX_RECORD_CHARS - overhead) / selected.length))
  const bounded: DecisionCall[] = []
  let used = 0
  for (const call of selected) {
    const promptChars = Math.min(MAX_PROMPT_CHARS, Math.max(MIN_PROMPT_CHARS, Math.floor(perCall * 0.8)))
    const outputChars = Math.min(MAX_OUTPUT_CHARS, Math.max(MIN_OUTPUT_CHARS, perCall - promptChars))
    const value: DecisionCall = {
      label: call.label.slice(0, 200),
      channel: call.channel.slice(0, 40),
      prompt: boundCaptureText(call.prompt, promptChars),
      output: boundCaptureText(call.output, outputChars),
      ...(typeof call.score === 'number' && Number.isFinite(call.score) ? { score: call.score } : {}),
    }
    const cost = value.label.length + value.channel.length + value.prompt.length + value.output.length
    // Safety net only: the equal share already fits at MAX_CALLS = 12.
    if (bounded.length > 0 && used + cost > MAX_RECORD_CHARS) break
    bounded.push(value)
    used += cost
  }
  return bounded
}

export interface DecisionInput {
  toolName: string
  phase: string
  startedAt: number
  provider: string
  model: string
  calls: readonly DecisionCall[]
}

/**
 * Per-topic ring buffer of decision snapshots.
 *
 * Mirrors {@link import('./statistics.ts').StatisticsStore}: one JSON file beside the
 * statistics of the same topic, atomic replace on write, a fixed number of records, so
 * the observable cost of "keep the evidence that explains a verdict" is bounded.
 */
export class DecisionStore {
  private loaded = false
  private hydrating: Promise<void> | undefined
  private records: DecisionRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly maxEntries = 40) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('llm-verifier: decision maxEntries must be a positive integer')
  }

  async record(input: DecisionInput): Promise<DecisionRecord | undefined> {
    const calls = boundDecisionCalls(input.calls)
    if (calls.length === 0) return undefined
    const record: DecisionRecord = {
      id: randomUUID(),
      toolName: input.toolName,
      phase: input.phase,
      startedAt: input.startedAt,
      provider: input.provider,
      model: input.model,
      calls,
    }
    const operation = async () => {
      await this.load()
      this.records.push(record)
      if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries)
      await this.persist()
    }
    this.writing = this.writing.then(operation, operation)
    await this.writing
    return record
  }

  /** One snapshot by invocation id, or undefined when it was pruned or never captured. */
  async find(id: string): Promise<DecisionRecord | undefined> {
    await this.writing.catch(() => {})
    await this.load()
    return this.records.find(record => record.id === id)
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.hydrating ??= (async () => {
      try {
        const document = JSON.parse(await readFile(this.file, 'utf8')) as Partial<DecisionsDocument>
        if (document.version === 1 && Array.isArray(document.records)) {
          this.records = document.records.filter(isDecisionRecord).slice(-this.maxEntries)
        }
        this.loaded = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          this.loaded = true
          return
        }
        throw error
      } finally {
        this.hydrating = undefined
      }
    })()
    await this.hydrating
  }

  private async persist(): Promise<void> {
    const snapshot: DecisionsDocument = { version: 1, records: this.records }
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = this.file + '.tmp-' + process.pid + '-' + randomUUID()
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
    try { await rename(temporary, this.file) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }
}

/**
 * Loose validation, so a record written by a newer/older plugin still loads.
 * @param value - parsed JSON entry.
 * @returns True when the entry carries the fields the dashboard needs.
 */
function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<DecisionRecord>
  return typeof row.id === 'string'
    && typeof row.toolName === 'string'
    && typeof row.startedAt === 'number'
    && Array.isArray(row.calls)
    && row.calls.every(call => typeof call === 'object' && call !== null && typeof (call as DecisionCall).prompt === 'string' && typeof (call as DecisionCall).output === 'string')
}
