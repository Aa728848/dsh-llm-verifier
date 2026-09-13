/**
 * P06: default-off request-level selection over the host's \`llm/stream\` waterfall.
 *
 * The one place in the plugin that can shape the NEXT assistant reply instead of reviewing
 * something already produced. It is deliberately narrow:
 *
 * - off unless \`autoProcessSelection\` is on AND the mode is smart;
 * - N=2 (the original reply and exactly one generated alternative), one cycle per task;
 * - it fires only when the two most recent completed verification runs BOTH failed
 *   ({@link inspectRecoverySignal}), and only for the next real main-loop request;
 * - the winning stream is replayed chunk by chunk, so tool-call identity, \`finish\` metadata and
 *   provider replay state reach the host untouched;
 * - a selection is never an acceptance: the cycle arms the ordinary final gate.
 *
 * Nothing is exposed to the host before the decision, so a declined cycle costs the added
 * generation (and possibly one comparison) but never half a reply.
 */
import { isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { addUsage, emptyUsage, type UsageStats } from './caller.ts'
import { stableHash } from './cache.ts'
import { PROPOSAL_CRITERIA, type Criterion } from './core.ts'
import { mergeRunStats, partialStats, type CompareResult, type RunStats } from './engine.ts'
import { itemBudget, type AutoVerifierRouter, type Reservation, type RouterPolicy, type RoutedAgent } from './router.ts'
import type { RouteObservation } from './statistics.ts'

/**
 * Buffered characters allowed per candidate stream.
 *
 * The plan fixes the first version at 1 MiB. It is a hard boundary in BOTH directions: the
 * original stream overrunning it abandons selection and continues streaming untouched, and the
 * alternative overrunning it is discarded in favour of the complete original reply.
 */
export const PROCESS_CANDIDATE_CAP_CHARS = 1_048_576

/** How long a registered intent may wait for its request before it is considered stale. */
export const PROCESS_INTENT_TTL_MS = 120_000

/**
 * Comparison rounds for the process cycle.
 *
 * Even on purpose: \`VerifierEngine.compare\` only swaps the A/B slots on odd repeats, and the
 * whole point of this cycle is deciding which of two replies the host should execute.
 */
export const PROCESS_REPEATS = 2

/** Records kept in the durable per-topic cycle log. */
export const PROCESS_MAX_RECORDS = 200

/** One registered intent: a request that MAY still be selected, identified by session and task. */
export interface ProcessIntent {
  sessionId: string
  /**
   * The live host agent the intent was registered for.
   *
   * In-memory only (never persisted): it is the plugin's handle for the topic, the router state
   * and the statistics row. Typed \`unknown\` so this module does not depend on the host's Agent
   * shape; the caller narrows it.
   */
  agent: unknown
  taskStartSeq: number
  /** Recovery signature this intent was registered for; the cycle consumes exactly it. */
  signal: string
  registeredAt: number
  /** Newest session event seq seen at registration; the final gate is armed from here. */
  lastSeq: number
}

/** A fully buffered candidate reply. */
export interface BufferedCandidate {
  chunks: StreamChunk[]
  /** Prose of the reply (reasoning deltas excluded: they are not the deliverable). */
  text: string
  /** Tool calls in block order, rendered as \`name(arguments)\`. */
  actions: string[]
  chars: number
  /** The stream reached a finish the host can consume (\`stop\` or \`tool-calls\`). */
  complete: boolean
  usage: UsageStats
}

/** Settings snapshot the selector acts on; read fresh on every decision point. */
export interface ProcessSelectionSettings {
  /** Master switch AND \`enabled\`. */
  active: boolean
  /** Only smart mode enters this path in the first version. */
  smart: boolean
  timeoutMs: number
  maxItemChars: number
  maxInputChars: number
}

/** Everything the selector reports back for the statistics sidecar. */
export interface ProcessCycleReport {
  agent: unknown
  cycleId: string
  /** False when the cycle never reached a reservation (intent only, budget refusal, ...). */
  purchased: boolean
  /** Wall clock the cycle began at, for the statistics row's duration. */
  startedAt: number
  outcome: string
  replayed: 'original' | 'candidate' | 'none'
  generatedCalls: number
  judgeCalls: number
  sameCandidate: boolean
  usage: RunStats
  observation: RouteObservation
  compare?: CompareResult
  error?: string
}

export interface ProcessCompareRequest {
  /** Agent owning the topic the comparison runs under. */
  agent: unknown
  problem: string
  /** Bounded reference context (constraints, recent failure evidence, tool definitions). */
  context?: string
  candidateA: string
  candidateB: string
  criteria: readonly Criterion[]
  repeats: number
  signal: AbortSignal
}

/**
 * One correction of an already-recorded cycle, because its DELIVERY changed after the row was written.
 *
 * `replayed` is defined by what the host actually received, so a cycle whose winner was withheld
 * must not stay recorded as a replacement.
 */
export interface ProcessDeliveryCorrection {
  agent: unknown
  cycleId: string
  outcome: string
  replayed: 'original' | 'candidate'
}

/** What the judge is told about the task: the statement plus the evidence behind the failure. */
export interface ProcessTaskEvidence {
  problem: string
  /** Bounded, redacted trace of the task so far, including the failed verification runs. */
  evidence?: string
}

export interface ProcessSelectorDeps {
  settings(): ProcessSelectionSettings
  /**
   * Redact and bound one piece of untrusted text.
   *
   * The SAME sanitizer every other judge input goes through, and applied before the view is
   * measured: a candidate reply is untrusted input like any other and may contain a credential the
   * configured patterns mask.
   */
  sanitize(text: string, maxChars: number): string
  /** The routing policy in force, including the final-acceptance floor and the process allowance. */
  policy(): Promise<RouterPolicy>
  router(): AutoVerifierRouter
  /** Durable cycle log of one topic. */
  store(agent: unknown): ProcessCycleStore
  /** Newest session state, used for staleness and for the comparison's task evidence. */
  taskStatement(agent: unknown, fromSeq: number, signal: AbortSignal): Promise<ProcessTaskEvidence>
  /** Whether the intent's task is still the session's current task. */
  current(intent: ProcessIntent): boolean
  /** Independent dispatch for the alternative reply (a fresh request object). */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  compare(request: ProcessCompareRequest): Promise<CompareResult>
  record(report: ProcessCycleReport): Promise<void>
  /**
   * Rewrite the STATISTICS row of one already-recorded cycle because its delivery changed.
   *
   * The row is written before the winner is handed over (a row must never be lost to a crash), so
   * this is the only way "which stream did the host actually get" stays true when the switch flips in
   * that last window. The durable sidecar is corrected by the selector itself, which owns it.
   */
  correctDelivery(correction: ProcessDeliveryCorrection): Promise<void>
  judges(): number
  logger: { warn(message: string): void }
  now(): number
  diagnosticCycleId(): string
}

/**
 * Durable cycle log beside the score cache of one topic.
 *
 * Shares the topic directory on purpose: deleting the conversation removes the record of its
 * purchases with it, exactly like the score cache and the statistics log.
 * @param cacheFile - resolved \`scores-v1.json\` of the topic.
 * @returns Path of the process-selection log.
 */
export function resolveProcessFile(cacheFile: string): string {
  return join(dirname(cacheFile), 'process-selection-v1.json')
}

/** Characters one chunk contributes to the buffer cap. */
export function measureChunk(chunk: StreamChunk): number {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.length
  if (chunk.type === 'tool-call-delta') return chunk.argumentsDelta.length
  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') return chunk.block.arguments.length
  return 0
}

/**
 * Prose and actions of one buffered reply.
 *
 * Transport-level fields (call ids, usage, indices, replay state) are deliberately dropped: two
 * replies that differ only in a fresh \`callId\` are the same plan, and treating them as different
 * candidates would buy a comparison that cannot distinguish anything.
 */
export function renderCandidate(chunks: readonly StreamChunk[]): { text: string; actions: string[] } {
  const text: string[] = []
  const actions: string[] = []
  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') text.push(chunk.text)
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') actions.push(chunk.block.name + '(' + chunk.block.arguments + ')')
  }
  return { text: text.join('').trim(), actions }
}

/** Stage-and-content identity of one candidate, ignoring every transport-level field. */
export function candidateIdentity(candidate: { text: string; actions: readonly string[] }): string {
  return stableHash({ text: candidate.text, actions: [...candidate.actions] })
}

/** Whether a buffered stream ended in a finish the host can act on. */
export function finishKind(chunks: readonly StreamChunk[]): string | undefined {
  let kind: string | undefined
  for (const chunk of chunks) if (chunk.type === 'finish') kind = chunk.reason.kind
  return kind
}

/** Usage reported by the LAST \`usage\` chunk of one dispatched stream. */
export function usageFromChunks(chunks: readonly StreamChunk[]): UsageStats {
  let tokens: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } | undefined
  for (const chunk of chunks) if (chunk.type === 'usage') tokens = chunk.usage as never
  if (tokens === undefined) {
    // One dispatch really happened; only its token counts are unknown.
    const unknown = emptyUsage()
    unknown.calls = 1
    unknown.attempts = 1
    unknown.usageIncomplete = true
    return unknown
  }
  return {
    calls: 1,
    attempts: 1,
    retries: 0,
    inputTokens: tokens.inputTokens ?? 0,
    cachedInputTokens: (tokens.cacheReadTokens ?? 0) + (tokens.cacheWriteTokens ?? 0),
    outputTokens: tokens.outputTokens ?? 0,
    reasoningTokens: tokens.reasoningTokens ?? 0,
  }
}

/**
 * Build the alternative reply's request from the frozen original.
 *
 * Copying only the effective call configuration keeps the same model and sampling while giving
 * the alternative its own lifecycle; the process-local "this is an agent-loop request" marker is
 * deliberately NOT copied, and neither is \`sessionId\`, so the alternative can never be mistaken
 * for (or recurse into) a main-loop request.
 */
export function buildAlternativeRequest(options: GenerateOptions, signal: AbortSignal): GenerateOptions {
  return {
    provider: options.provider,
    model: options.model,
    messages: options.messages,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
    ...(options.system === undefined ? {} : { system: options.system }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
    signal,
  }
}

/**
 * Render one bounded candidate view for the judge.
 *
 * The whole evidence budget is split across the two candidates, so the combined request can never
 * exceed it and \`boundDecision\`-style dropping cannot silently disable the comparison.
 * @param candidate - prose and actions of one reply.
 * @param budget - characters this candidate may occupy.
 * @returns The rendered block body.
 */
/** Section labels of the process comparison's `CONTEXT` block, in reading order. */
const EVIDENCE_LABEL = 'RECENT EXECUTION EVIDENCE'
const CONSTRAINTS_LABEL = 'REQUEST CONSTRAINTS'
const TOOLS_LABEL = 'AVAILABLE TOOLS'

/**
 * Bound ONE optional context section inside its own share of the comparison budget.
 *
 * The execution trace is chronological, so its HEAD is the OLDEST material: a single truncation of
 * the joined context threw the recent failure runs away and kept a stale opening — the exact
 * opposite of what the judge needs. The trace therefore keeps its most RECENT characters; the tool
 * digest keeps its beginning, which is where the tools the next action may call live.
 * @param label - the section's label.
 * @param body - the section's redaction-pending body.
 * @param share - characters this section may occupy, omission notice included.
 * @param sanitize - redact + bound one piece of untrusted text.
 * @returns The bounded body, never longer than `share`.
 */
function boundContextSection(label: string, body: string, share: number, sanitize: (text: string, maxChars: number) => string): string {
  if (share < 1) return ''
  if (label !== EVIDENCE_LABEL || body.length <= share) return sanitize(body, share)
  const notice = '[Earlier ' + (body.length - share) + ' characters omitted; showing the most recent evidence]\n'
  if (notice.length >= share) return body.slice(-share)
  const recent = sanitize(body.slice(-(share - notice.length)), share - notice.length)
  const composed = notice + recent
  return composed.length <= share ? composed : composed.slice(0, Math.max(1, share - 1)) + '…'
}

/** Fixed labels of one rendered candidate view; they count against the measured budget. */
const CANDIDATE_ACTIONS_HEADER = 'Tool calls:\n'
const CANDIDATE_TEXT_HEADER = '\n\nReply text:\n'

/**
 * Render one bounded candidate view for the judge, or refuse when its actions cannot fit.
 *
 * The tool calls are ATOMIC: a truncated call is not a shorter action, it is a different one, and
 * scoring it would grade the original reply against something the host will never execute — only
 * the winning reply's buffered chunks are replayed verbatim. So when the action block does not fit
 * the candidate's budget the whole view is refused and the caller falls back to the original reply,
 * recording the length reason. Only the PROSE (which is not executed) is truncated, with a visible
 * marker.
 * @param candidate - prose and actions of one reply.
 * @param budget - characters this candidate may occupy.
 * @returns The rendered block body, or undefined when its actions cannot be shown in full.
 */
export function renderCandidateView(candidate: { text: string; actions: readonly string[] }, budget: number): string | undefined {
  const actionsBlock = candidate.actions.length === 0 ? '(no tool calls)' : candidate.actions.map(action => '[tool-call] ' + action).join('\n')
  const overhead = CANDIDATE_ACTIONS_HEADER.length + CANDIDATE_TEXT_HEADER.length
  if (actionsBlock.length + overhead > budget) return undefined
  const proseBudget = budget - overhead - actionsBlock.length
  const prose = candidate.text.length > proseBudget ? candidate.text.slice(0, Math.max(0, proseBudget - 1)) + '…' : candidate.text
  return CANDIDATE_ACTIONS_HEADER + actionsBlock + CANDIDATE_TEXT_HEADER + (prose || '(empty)')
}

/**
 * Everything the judge needs about the task besides the two replies.
 *
 * The judge has to answer "does this next step address the REAL failure?", which needs the task,
 * the constraints the request was made under and the execution evidence behind the failure — not
 * just the user's question. Every piece is bounded and redacted by {@link buildProcessView}.
 */
export interface ProcessEvidencePack {
  /** Task statement of the current task. */
  task: string
  /** Recent execution evidence (the trajectory, including the failed verification runs). */
  evidence?: string
  /** The original request's system constraints, when it declared any. */
  constraints?: string
  /** Digest of the tools the original request could call, when it declared any. */
  tools?: string
}

export interface ProcessViewInput extends ProcessEvidencePack {
  original: { text: string; actions: readonly string[] }
  alternative: { text: string; actions: readonly string[] }
  maxItemChars: number
  maxInputChars: number
  /** Redact and bound one piece of untrusted text before it reaches a judge. */
  sanitize(text: string, maxChars: number): string
}

/** A bounded, redacted comparison view, or the reason it could not be built. */
export type ProcessView =
  | { ok: true; problem: string; context?: string; candidateA: string; candidateB: string }
  | { ok: false; reason: string }

/**
 * Build the bounded, redacted comparison view of one process cycle.
 *
 * Three boundaries are enforced here, and exceeding any of them declines the cycle instead of
 * sending incomplete evidence:
 *
 * 1. every piece is redacted with the plugin's sanitizer BEFORE it is measured, so a secret that
 *    sanitizeVerifierText masks can never reach the judge prompt through a candidate reply;
 * 2. the task and its context must fit the combined input budget (a candidate scored against a
 *    truncated constraint set measures the truncation, not the candidate);
 * 3. the remaining budget is split across the two candidates with itemBudget, and a candidate whose
 *    actions cannot be shown in full is refused (see renderCandidateView).
 *
 * The TOTAL is measured on the rendered text, never estimated, so the view can never exceed
 * maxInputChars.
 * @param input - the evidence pack plus both replies and the live bounds.
 * @returns The view, or the specific length reason it was refused.
 */
export function buildProcessView(input: ProcessViewInput): ProcessView {
  // Bounds are validated HERE, not left to the sanitizer: this runs inside the host's streams
  // waterfall, where a throw would cost the host the reply it was already receiving.
  if (!Number.isSafeInteger(input.maxItemChars) || input.maxItemChars < 1 || !Number.isSafeInteger(input.maxInputChars) || input.maxInputChars < 1) {
    return { ok: false, reason: 'the process comparison bounds must be positive integers; replaying the original reply' }
  }
  const task = input.sanitize(input.task, input.maxItemChars).trim()
  if (task === '') return { ok: false, reason: 'the task statement is empty after redaction' }
  const contextCap = input.maxInputChars - task.length
  if (contextCap < 0) {
    return { ok: false, reason: 'the task alone is ' + task.length + ' characters against a ' + input.maxInputChars + '-character total; replaying the original reply' }
  }
  const sections: Array<{ label: string; body: string }> = []
  const evidence = input.evidence === undefined ? '' : input.evidence.trim()
  const constraints = input.constraints === undefined ? '' : input.constraints.trim()
  const tools = input.tools === undefined ? '' : input.tools.trim()
  if (evidence !== '') sections.push({ label: EVIDENCE_LABEL, body: evidence })
  if (constraints !== '') sections.push({ label: CONSTRAINTS_LABEL, body: constraints })
  if (tools !== '') sections.push({ label: TOOLS_LABEL, body: tools })
  // Every section gets its OWN share of the context budget, plus the exact label/separator overhead:
  // truncating the joined body (the old behaviour) let a long chronological trace eat the whole
  // budget from the FRONT and delete the recent failure runs, the constraints and the tool
  // definitions — the judge then scored the task with none of the material this cycle exists for.
  const overhead = sections.reduce((sum, section) => sum + section.label.length + 2, 0) + 2 * Math.max(0, sections.length - 1)
  const share = sections.length === 0 ? 0 : itemBudget(sections.length, input.maxItemChars, Math.max(0, contextCap - overhead))
  // One character of headroom over the per-item cap: a piece the sanitizer had to truncate is
  // therefore still longer than the cap, so a truncated constraint can never pass for a complete one.
  const atomicCap = Math.max(1, Math.floor(input.maxItemChars)) + 1
  const rendered: string[] = []
  for (const section of sections) {
    if (section.label === CONSTRAINTS_LABEL) {
      // The constraints the request was made under are NOT optional context: a candidate judged
      // against a clipped constraint set is judged against the clipping. Redact first, then compare
      // the REDACTED length — redaction can lengthen a body — and refuse the cycle when it is over.
      const redacted = input.sanitize(section.body, atomicCap)
      if (redacted.length > share) {
        return { ok: false, reason: 'the request constraints need ' + redacted.length + ' characters but the process comparison can give them ' + share + '; replaying the original reply' }
      }
      rendered.push(section.label + ':\n' + redacted)
      continue
    }
    rendered.push(section.label + ':\n' + boundContextSection(section.label, section.body, share, input.sanitize))
  }
  const context = rendered.length === 0 ? undefined : rendered.join('\n\n').trim()
  const fixed = task.length + (context === undefined ? 0 : context.length)
  if (fixed > input.maxInputChars) {
    return { ok: false, reason: 'the task and its context need ' + fixed + ' characters but the process comparison budget is ' + input.maxInputChars + '; replaying the original reply' }
  }
  const perCandidate = itemBudget(2, input.maxItemChars, input.maxInputChars - fixed)
  // One character of headroom over the per-item cap: a piece the sanitizer had to truncate is
  // therefore still longer than the per-item cap, so it can never pass for a complete action.
  const atomicCapForCandidate = atomicCap
  const render = (candidate: { text: string; actions: readonly string[] }): string | undefined => renderCandidateView({
    text: input.sanitize(candidate.text, atomicCapForCandidate),
    actions: candidate.actions.map(action => input.sanitize(action, atomicCapForCandidate)),
  }, perCandidate)
  const candidateA = render(input.original)
  if (candidateA === undefined) return { ok: false, reason: 'candidate A has more tool-call text than the ' + perCandidate + '-character candidate budget; replaying the original reply' }
  const candidateB = render(input.alternative)
  if (candidateB === undefined) return { ok: false, reason: 'candidate B has more tool-call text than the ' + perCandidate + '-character candidate budget; replaying the original reply' }
  const total = fixed + candidateA.length + candidateB.length
  if (total > input.maxInputChars) {
    return { ok: false, reason: 'the rendered comparison view is ' + total + ' characters against a ' + input.maxInputChars + '-character budget; replaying the original reply' }
  }
  return { ok: true, problem: task, ...(context === undefined || context === '' ? {} : { context }), candidateA, candidateB }
}

/**
 * One bounded digest of the tools the original request could call.
 *
 * The judge sees `[tool-call] name(arguments)` for every action; without the definitions it cannot
 * tell whether `pwsh({"command":"..."})` is the task's verification command or an unrelated probe.
 * Only names, parameter names and one-line descriptions are shown — full schemas would swamp the
 * evidence budget for no decision value.
 * @param tools - the original request's tool definitions, when it declared any.
 * @returns The digest, or undefined when there is nothing to show.
 */
export function renderToolDigest(tools: readonly unknown[] | undefined): string | undefined {
  if (tools === undefined || tools.length === 0) return undefined
  const lines = tools.map(tool => {
    const row = (tool ?? {}) as { name?: unknown; description?: unknown; parameters?: unknown }
    const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : '(unnamed tool)'
    const properties = (row.parameters as { properties?: unknown } | undefined)?.properties
    const params = properties !== null && typeof properties === 'object' ? Object.keys(properties as Record<string, unknown>) : []
    const description = typeof row.description === 'string' ? row.description.replace(/\s+/gu, ' ').trim() : ''
    return '- ' + name + (params.length === 0 ? '' : '(' + params.join(', ') + ')') + (description === '' ? '' : ': ' + description)
  })
  return lines.join('\n')
}

/** One durable purchase record; the sidecar exists so a plugin reload cannot buy the cycle twice. */
export interface ProcessCycleRecord {
  cycleId: string
  sessionId: string
  taskStartSeq: number
  signal: string
  startedAt: number
  outcome?: string
  replayed?: string
}

interface ProcessStoreDocument { version: 1; records: ProcessCycleRecord[] }

function validRecord(value: unknown): value is ProcessCycleRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.cycleId === 'string' && typeof row.sessionId === 'string'
    && typeof row.taskStartSeq === 'number' && Number.isSafeInteger(row.taskStartSeq)
    && typeof row.signal === 'string' && typeof row.startedAt === 'number' && Number.isFinite(row.startedAt)
}

/**
 * Durable per-topic log of purchased process cycles.
 *
 * A purchase must survive a plugin reload: the in-memory router counter cannot, and without the
 * sidecar a reload would let the same stuck task buy a second cycle. A failed read is treated as
 * "do not buy" rather than "probably fine" — see {@link lookup}.
 */
export class ProcessCycleStore {
  private loaded = false
  private records: ProcessCycleRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly max = PROCESS_MAX_RECORDS) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const document = JSON.parse(await readFile(this.file, 'utf8')) as ProcessStoreDocument
      this.records = document?.version === 1 && Array.isArray(document.records) ? document.records.filter(validRecord).slice(-this.max) : []
      this.loaded = true
    } catch (error) {
      // A missing log is the normal first-run state, not a failure: the topic simply never bought
      // a cycle. Anything else (a directory, bad permissions, invalid JSON) propagates so the
      // caller can refuse to buy.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.records = []
      this.loaded = true
    }
  }

  /**
   * Whether this task already bought a process cycle.
   *
   * \`ok: false\` means the log could not be read, and the caller must NOT buy: an unreadable log
   * is indistinguishable from "already purchased", and the safe side of that ambiguity is to
   * keep the original path.
   * @param sessionId - session owning the cycle.
   * @param taskStartSeq - task boundary sequence of the cycle.
   * @returns Read status plus whether a record already exists.
   */
  async lookup(sessionId: string, taskStartSeq: number): Promise<{ ok: boolean; purchased: boolean; reason?: string }> {
    try {
      await this.load()
      return { ok: true, purchased: this.records.some(record => record.sessionId === sessionId && record.taskStartSeq === taskStartSeq) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, purchased: false }
      return { ok: false, purchased: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Write the start record BEFORE any added model call.
   * @param record - the purchase to remember.
   * @returns False when the record could not be persisted; the caller must not buy.
   */
  async begin(record: ProcessCycleRecord): Promise<boolean> {
    try {
      await this.load()
      this.records.push(record)
      if (this.records.length > this.max) this.records = this.records.slice(-this.max)
      await this.persist()
      return true
    } catch {
      return false
    }
  }

  /** Attach the outcome of a purchased cycle to its record (best effort). */
  async finish(cycleId: string, outcome: string, replayed: string): Promise<void> {
    try {
      await this.load()
      const record = this.records.find(entry => entry.cycleId === cycleId)
      if (record === undefined) return
      record.outcome = outcome
      record.replayed = replayed
      await this.persist()
    } catch { /* the log is diagnostic; a failed update never changes a decision */ }
  }

  private async persist(): Promise<void> {
    const snapshot: ProcessStoreDocument = { version: 1, records: this.records }
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = this.file + '.tmp-' + process.pid
      await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
      try { await rename(temporary, this.file) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
    })
    await this.writing
  }
}
/**
 * The selector itself: intent bookkeeping plus the \`llm/stream\` body.
 *
 * Kept as one class rather than free functions because the intent map and the request-local
 * re-entrancy guard are per-plugin-instance state; every decision point reads settings and budget
 * fresh, so a settings change or a spent budget is honoured without restarting anything.
 */
export class ProcessSelector {
  private readonly intents = new Map<string, ProcessIntent>()
  /** Requests this plugin dispatched itself (the alternative reply): never a selection subject. */
  private readonly internal = new WeakSet<object>()
  /**
   * Phase controllers of the cycles currently in flight, one per session.
   *
   * Holding them is what makes "turn the switch off / cancel / dispose" take effect on a cycle
   * that already started: aborting the phase stops the alternative dispatch, the comparison and
   * the replay, and the buffered original reply is handed back instead.
   */
  private readonly cycles = new Map<string, AbortController>()

  constructor(private readonly deps: ProcessSelectorDeps) {}

  /** Register (or replace) the pending intent of one session. */
  register(intent: ProcessIntent): void { this.intents.set(intent.sessionId, intent) }

  /** Drop a session's pending intent and cancel its in-flight cycle (new task, disposal). */
  clear(sessionId: string): void {
    this.intents.delete(sessionId)
    this.abort(sessionId, 'the session was cleared')
  }

  /** Drop every pending intent and cancel every in-flight cycle (settings change, shutdown). */
  clearAll(): void {
    this.intents.clear()
    for (const sessionId of [...this.cycles.keys()]) this.abort(sessionId, 'the settings changed')
  }

  /** Cancel one session's in-flight cycle; it replays the buffered original reply instead. */
  private abort(sessionId: string, reason: string): void {
    const controller = this.cycles.get(sessionId)
    if (controller === undefined) return
    this.cycles.delete(sessionId)
    controller.abort(new Error('llm-verifier: process-selection cancelled (' + reason + ')'))
  }

  /** Whether the LIVE settings still permit the request-level path. */
  private live(): boolean {
    const settings = this.deps.settings()
    return settings.active && settings.smart
  }

  /** Whether a session already has an intent waiting for its next request. */
  pending(sessionId: string): boolean { return this.intents.has(sessionId) }

  /**
   * Match and consume the intent for one real main request.
   *
   * The request must be a host-stamped agent-loop request with the registered session id; our own
   * auxiliary dispatches and every other plugin's calls therefore pass straight through. The
   * intent is consumed on a match — even when the cycle is then declined — so it can never leak
   * into a later request, and a mismatched session leaves it untouched.
   * @param options - the request entering the waterfall.
   * @returns The consumed intent, or undefined to delegate untouched.
   */
  take(options: GenerateOptions): ProcessIntent | undefined {
    if (typeof options !== 'object' || options === null) return undefined
    if (this.internal.has(options as object)) return undefined
    if (!isAgentLoopRequest(options)) return undefined
    const sessionId = options.sessionId === undefined ? undefined : String(options.sessionId)
    if (sessionId === undefined) return undefined
    const intent = this.intents.get(sessionId)
    if (intent === undefined) return undefined
    this.intents.delete(sessionId)
    const settings = this.deps.settings()
    if (!settings.active || !settings.smart) return undefined
    if (this.deps.now() - intent.registeredAt > PROCESS_INTENT_TTL_MS) {
      this.deps.logger.warn('llm-verifier process selection: the registered intent expired before its request arrived; passing the request through')
      return undefined
    }
    if (!this.deps.current(intent)) {
      this.deps.logger.warn('llm-verifier process selection: the intent no longer belongs to the current task; passing the request through')
      return undefined
    }
    return intent
  }

  /**
   * The waterfall body.
   *
   * \`next()\` is called exactly once. The original reply is buffered first; only after it is
   * complete and inside the cap is the alternative generated, and only a judge-selected winner is
   * replayed. Every decline replays the buffered original verbatim.
   *
   * The live state — the settings switch, the turn signal and the current task — is re-read before
   * every purchase, before the comparison and before the winner is committed, and a settings change
   * or a disposal aborts the cycle through {@link ProcessSelector.clearAll}.
   * @param options - the matched main request.
   * @param next - the downstream dispatch (called once).
   * @param intent - the consumed intent.
   * @returns The chunks the host will consume.
   */
  async *handle(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>, intent: ProcessIntent): AsyncGenerator<StreamChunk> {
    const startedAt = this.deps.now()
    const settings = this.deps.settings()
    const original: StreamChunk[] = []
    let heldChars = 0
    let overflow = false
    for await (const chunk of next()) {
      if (overflow) { yield chunk; continue }
      original.push(chunk)
      heldChars += measureChunk(chunk)
      if (heldChars > PROCESS_CANDIDATE_CAP_CHARS) {
        // Over the cap: stop selecting, flush what was held (in order) and pass the rest through.
        // The iterator is never abandoned, so the host still receives one complete reply.
        overflow = true
        for (const held of original) yield held
        original.length = 0
      }
    }
    if (overflow) {
      await this.skip(startedAt, intent, 'original-over-cap', 'the original reply exceeded the process-selection buffer cap')
      return
    }
    const rendered = renderCandidate(original)
    const finish = finishKind(original)
    const upstreamUsage = usageFromChunks(original)
    if (finish !== 'stop' && finish !== 'tool-calls') {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'original-incomplete', 'the original reply did not finish normally (' + String(finish) + ')')
      return
    }
    if (!rendered.text && rendered.actions.length === 0 && upstreamUsage.calls === 0) {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'original-empty', 'the original reply carried neither prose nor a tool call')
      return
    }

    // The reply was buffered while the host streamed it, so the switch may have been turned off —
    // or the turn cancelled — in the meantime. Re-read the LIVE settings and signal here, before
    // anything is reserved, written to the cycle log or sent to a model.
    if (!this.live()) {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'switch-off', 'the process-selection switch or the smart mode was turned off while the original reply was streaming')
      return
    }
    if (options.signal?.aborted) {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'canceled', 'the request was already aborted before the process cycle started')
      return
    }
    if (!this.deps.current(intent)) {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'task-changed', 'the intent no longer belongs to the current task')
      return
    }

    const policy = await this.deps.policy()
    const router = this.deps.router()
    const criteria = PROPOSAL_CRITERIA
    const expected = 1 + criteria.length * PROCESS_REPEATS * Math.max(1, this.deps.judges())
    const fingerprint = stableHash({ phase: 'process', sessionId: intent.sessionId, taskStartSeq: intent.taskStartSeq, signal: intent.signal })
    const reservation = router.reserve(intent.agent as RoutedAgent, 'process', fingerprint, expected, policy)
    if (reservation === undefined) {
      for (const chunk of original) yield chunk
      await this.skip(startedAt, intent, 'no-process-budget', 'the task/session budget or the one-per-task process allowance refused the cycle')
      return
    }
    const observation: RouteObservation = { cycleId: reservation.id, trigger: 'llm-stream', stage: 'process', destination: 'process', attempt: reservation.attempt, reservedCalls: reservation.expectedCalls, replayed: 'original', generatedCalls: 0, judgeCalls: 0, sameCandidate: false }
    const store = this.deps.store(intent.agent)
    const started = await store.begin({ cycleId: reservation.id, sessionId: intent.sessionId, taskStartSeq: intent.taskStartSeq, signal: intent.signal, startedAt: this.deps.now() })
    if (!started) {
      // The purchase record could not be written: buying anyway would make the cycle unaccountable.
      router.fail(intent.agent as RoutedAgent, reservation, false)
      for (const chunk of original) yield chunk
      await this.report({ intent, reservation, observation, startedAt, outcome: 'store-unavailable', replayed: 'original', generatedCalls: 0, judgeCalls: 0, sameCandidate: false, usage: blankProcessStats(), error: 'the process cycle log could not be written' })
      return
    }

    // One deadline for generation AND comparison. It never shortens the original request's own
    // timeout (that already elapsed), and a retry inside either phase cannot extend it.
    const phase = new AbortController()
    // Registered so a settings change or a disposal cancels this cycle mid-flight, and linked to
    // the turn's own signal — including when that signal was ALREADY aborted before the listener
    // could attach, because an already-dispatched event never fires again.
    this.cycles.set(intent.sessionId, phase)
    const timer = setTimeout(() => phase.abort(new Error('llm-verifier: process-selection phase timed out')), settings.timeoutMs)
    const linkAbort = () => phase.abort(options.signal?.reason)
    if (options.signal?.aborted) linkAbort()
    options.signal?.addEventListener('abort', linkAbort, { once: true })
    try {
      // The policy read and the cycle-log write are BOTH async: the switch may have been turned off,
      // the turn cancelled or the task replaced while they were in flight. Check again here — before
      // the first added model call — because the check that admitted the reservation is already stale.
      const staleBeforeGeneration = this.staleReason(intent, phase)
      if (staleBeforeGeneration !== undefined) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: staleBeforeGeneration, replayed: 'original', generatedCalls: 0, judgeCalls: 0, sameCandidate: false, usage: blankProcessStats(), ...(staleBeforeGeneration === 'canceled' ? { error: 'the process-selection phase was cancelled' } : {}) })
        return
      }
      let alternative: BufferedCandidate
      const request = buildAlternativeRequest(options, phase.signal)
      this.internal.add(request as object)
      // The alternative's chunks are collected HERE so the usage a stream already reported before
      // throwing survives: reporting the failed generation as zero tokens hid real spend.
      const generatedChunks: StreamChunk[] = []
      try {
        alternative = await drainAlternative(this.deps.stream(request), PROCESS_CANDIDATE_CAP_CHARS, generatedChunks)
      } catch (error) {
        const generationUsage = statsWith(usageFromChunks(generatedChunks))
        // The dispatch really happened and never finished: what it already reported is known, what
        // it would have reported next is not.
        generationUsage.usageIncomplete = true
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'generation-failed', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: generationUsage, error: error instanceof Error ? error.message : String(error) })
        return
      }
      observation.generatedCalls = 1
      const generatedUsage = alternative.usage
      if (!alternative.complete || (!alternative.text && alternative.actions.length === 0)) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: alternative.complete ? 'alternative-empty' : 'alternative-incomplete', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage) })
        return
      }
      if (candidateIdentity(alternative) === candidateIdentity(rendered)) {
        // Same plan expressed with a fresh call id: no judge call can separate them.
        router.commit(intent.agent as RoutedAgent, reservation, intent.lastSeq)
        observation.sameCandidate = true
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'identical-candidate', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true, usage: statsWith(generatedUsage) })
        return
      }
      // A switch-off, a cancellation or a new task while the alternative was generating must not
      // buy a comparison (or a judge call) for a cycle nobody will accept.
      const staleAfterGeneration = this.staleReason(intent, phase)
      if (staleAfterGeneration !== undefined) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: staleAfterGeneration, replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage), ...(staleAfterGeneration === 'canceled' ? { error: 'the process-selection phase was cancelled' } : {}) })
        return
      }
      let evidence: ProcessTaskEvidence
      try {
        evidence = await this.deps.taskStatement(intent.agent, intent.taskStartSeq, phase.signal)
      } catch (error) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'task-unreadable', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage), error: error instanceof Error ? error.message : String(error) })
        return
      }
      // The judge scores the SAME bounded, redacted view this decision is made on. The budget is
      // split with itemBudget and the total is measured on the rendered text; a candidate whose
      // actions cannot be shown in full declines the cycle rather than being scored truncated.
      const tools = renderToolDigest(options.tools)
      const view = buildProcessView({
        task: evidence.problem,
        ...(evidence.evidence === undefined ? {} : { evidence: evidence.evidence }),
        ...(typeof options.system === 'string' ? { constraints: options.system } : {}),
        ...(tools === undefined ? {} : { tools }),
        original: rendered,
        alternative,
        maxItemChars: settings.maxItemChars,
        maxInputChars: settings.maxInputChars,
        sanitize: (text, maxChars) => this.deps.sanitize(text, maxChars),
      })
      if (!view.ok) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'view-over-budget', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: false, usage: statsWith(generatedUsage), error: view.reason })
        return
      }
      if (view.candidateA === view.candidateB) {
        router.commit(intent.agent as RoutedAgent, reservation, intent.lastSeq)
        observation.sameCandidate = true
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'identical-candidate', replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true, usage: statsWith(generatedUsage) })
        return
      }
      let compared: CompareResult
      try {
        compared = await this.deps.compare({
          agent: intent.agent,
          problem: view.problem,
          ...(view.context === undefined ? {} : { context: view.context }),
          candidateA: view.candidateA,
          candidateB: view.candidateB,
          criteria,
          repeats: PROCESS_REPEATS,
          signal: phase.signal,
        })
      } catch (error) {
        // The judge run really happened before it failed: fold in every call the engine attached to
        // the error, so a partial comparison is never recorded as a free one.
        const failureUsage = statsWith(generatedUsage)
        const partial = partialStats(error)
        if (partial === undefined) failureUsage.usageIncomplete = true
        else mergeRunStats(failureUsage, partial)
        const judgeCalls = partial === undefined ? 0 : partial.calls
        observation.judgeCalls = judgeCalls
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: 'comparison-failed', replayed: 'original', generatedCalls: 1, judgeCalls, sameCandidate: false, usage: failureUsage, error: error instanceof Error ? error.message : String(error) })
        return
      }
      observation.judgeCalls = compared.calls
      const usage = statsWith(generatedUsage)
      mergeRunStats(usage, compared.stats)
      // Last check before the decision is committed and recorded: the winner is only replayed while
      // the cycle is still current, and a switch turned off (or a cancellation, or a new task)
      // during the comparison must leave the host with the ORIGINAL reply.
      const stale = this.staleReason(intent, phase)
      if (stale !== undefined) {
        router.fail(intent.agent as RoutedAgent, reservation, false)
        for (const chunk of original) yield chunk
        await this.report({ intent, reservation, observation, startedAt, outcome: stale, replayed: 'original', generatedCalls: 1, judgeCalls: compared.calls, sameCandidate: false, usage, compare: compared, ...(stale === 'canceled' ? { error: 'the process-selection phase was cancelled' } : {}) })
        return
      }
      // A selection is never an acceptance: armed here, discharged only by the final gate.
      router.commit(intent.agent as RoutedAgent, reservation, intent.lastSeq)
      const replaced = compared.winner === 'B'
      observation.replayed = replaced ? 'candidate' : 'original'
      await this.report({ intent, reservation, observation, startedAt, outcome: replaced ? 'candidate-selected' : compared.winner === 'tie' ? 'tie' : 'original-selected', replayed: replaced ? 'candidate' : 'original', generatedCalls: 1, judgeCalls: compared.calls, sameCandidate: false, usage, compare: compared })
      // The report awaited the cycle log and the statistics row, so re-read the live state once more
      // IMMEDIATELY before the first chunk leaves this generator: nothing has been yielded yet, and a
      // switch turned off (or a cancellation) during the accounting must still leave the host with the
      // original reply. The row above describes the decision; this is what the host actually receives.
      if (replaced) {
        const staleBeforeReplay = this.staleReason(intent, phase)
        if (staleBeforeReplay !== undefined) {
          // The row above records the DECISION; it must not keep claiming the delivery. Correct both
          // records before the host sees anything, so "which stream was replayed" (and therefore the
          // replacement rate) describes the original reply that is actually handed over.
          const outcome = 'candidate-not-delivered (' + staleBeforeReplay + ')'
          observation.replayed = 'original'
          // The durable sidecar belongs to this selector; the statistics row is corrected through the
          // dep. Both must state the delivery, and `finish` overwrites the cycle's own record.
          await this.deps.store(intent.agent).finish(reservation.id, outcome, 'original')
          try {
            await this.deps.correctDelivery({ agent: intent.agent, cycleId: reservation.id, outcome, replayed: 'original' })
          } catch (error) {
            // A failed correction is reported, never silently accepted: the row is now wrong about
            // the delivery and the operator has to be able to see why.
            this.deps.logger.warn('llm-verifier process selection: could not correct the cycle records after the delivery changed (' + (error instanceof Error ? error.message : String(error)) + ')')
          }
          this.deps.logger.warn('llm-verifier process selection: the selected alternative was not delivered because the cycle became ' + staleBeforeReplay + ' before its first chunk; replaying the original reply')
          for (const chunk of original) yield chunk
          return
        }
        // Once the first chunk is out the winner is replayed as ONE piece: a reply is never switched
        // halfway through because the settings changed during the reveal.
        for (const chunk of alternative.chunks) yield chunk
        return
      }
      for (const chunk of original) yield chunk
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', linkAbort)
      if (this.cycles.get(intent.sessionId) === phase) this.cycles.delete(intent.sessionId)
    }
  }

  /**
   * Why the cycle must fall back to the buffered original reply RIGHT NOW.
   *
   * Re-read at every decision point instead of sampled once: the switch can be turned off, the turn
   * cancelled or the task replaced while a generation or a comparison is in flight, and a late
   * alternative must never reach the new task.
   * @param intent - the consumed intent of this cycle.
   * @param phase - the cycle's phase controller.
   * @returns The outcome to record, or undefined while the cycle is still current.
   */
  private staleReason(intent: ProcessIntent, phase: AbortController): 'canceled' | 'switch-off' | 'task-changed' | undefined {
    if (phase.signal.aborted) return 'canceled'
    if (!this.live()) return 'switch-off'
    if (!this.deps.current(intent)) return 'task-changed'
    return undefined
  }

  /** Record a cycle that never reached (or consumed) a reservation. */
  private async skip(startedAt: number, intent: ProcessIntent, outcome: string, reason: string): Promise<void> {
    const cycleId = this.deps.diagnosticCycleId()
    await this.deps.record({
      agent: intent.agent,
      cycleId,
      purchased: false,
      startedAt,
      outcome,
      replayed: 'none',
      generatedCalls: 0,
      judgeCalls: 0,
      sameCandidate: false,
      usage: blankProcessStats(),
      observation: { cycleId, trigger: 'llm-stream', stage: 'skipped', destination: 'process', skipReason: outcome, replayed: 'none', generatedCalls: 0, judgeCalls: 0, sameCandidate: false },
    }).catch(() => {})
    this.deps.logger.warn('llm-verifier process selection skipped (' + outcome + '): ' + reason)
  }

  /** Record a purchased cycle and stamp its durable outcome. */
  private async report(input: { intent: ProcessIntent; reservation: Reservation; observation: RouteObservation; startedAt: number; outcome: string; replayed: 'original' | 'candidate'; generatedCalls: number; judgeCalls: number; sameCandidate: boolean; usage: RunStats; compare?: CompareResult; error?: string }): Promise<void> {
    await this.deps.store(input.intent.agent).finish(input.reservation.id, input.outcome, input.replayed)
    await this.deps.record({
      agent: input.intent.agent,
      cycleId: input.reservation.id,
      purchased: true,
      startedAt: input.startedAt,
      outcome: input.outcome,
      replayed: input.replayed,
      generatedCalls: input.generatedCalls,
      judgeCalls: input.judgeCalls,
      sameCandidate: input.sameCandidate,
      usage: input.usage,
      observation: input.observation,
      ...(input.compare === undefined ? {} : { compare: input.compare }),
      ...(input.error === undefined ? {} : { error: input.error }),
    }).catch(() => {})
  }
}

/**
 * Drain the alternative reply, stopping at the cap (the alternative is discarded wholesale).
 *
 * The chunk list is owned by the CALLER so the usage reported before a stream failure is still
 * available to the failure row; keeping it local discarded it and recorded a free generation.
 */
async function drainAlternative(source: AsyncIterable<StreamChunk>, cap: number, chunks: StreamChunk[]): Promise<BufferedCandidate> {
  let chars = 0
  let overflow = false
  for await (const chunk of source) {
    chunks.push(chunk)
    chars += measureChunk(chunk)
    if (chars > cap) { overflow = true; break }
  }
  const rendered = renderCandidate(chunks)
  const finish = finishKind(chunks)
  return {
    chunks,
    text: rendered.text,
    actions: rendered.actions,
    chars,
    complete: !overflow && (finish === 'stop' || finish === 'tool-calls'),
    usage: usageFromChunks(chunks),
  }
}

function blankProcessStats(): RunStats {
  return { ...emptyUsage(), cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
}

function statsWith(usage: UsageStats): RunStats {
  const stats = blankProcessStats()
  addUsage(stats, usage)
  if (usage.usageIncomplete) stats.usageIncomplete = true
  return stats
}

