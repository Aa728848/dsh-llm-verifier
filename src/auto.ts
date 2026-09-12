import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Shared with the router so both agree on what opens a task; imported (type-only in the
// other direction) rather than duplicated, because a drift here silently disables gating.
import { latestDirectUserSeq } from './router.ts'

export type AutoVerifyMode = 'manual' | 'smart' | 'strict'

export interface AutoVerifyPolicy {
  mode: AutoVerifyMode
  minToolCalls: number
  /**
   * Attempt caps. {@link analyzeAutoTask} deliberately ignores them: it only
   * answers "is this task eligible", while the caps are enforced by
   * {@link AutoVerificationBudget} and by the router's reservation state.
   */
  maxPerTask: number
  maxPerSession: number
  /** Acceptance threshold a manual `verifier_current_session` result must reach to count. */
  threshold: number
}

export interface AutoTaskEvidence {
  taskStartSeq: number
  toolCalls: number
  completedToolResults: number
  consequentialToolCalls: number
  /** A completed `verifier_current_session` call exists (whatever its verdict). */
  hasManualSessionVerification: boolean
  /** That verification passed the threshold and no consequential work happened since. */
  manualVerificationAccepted: boolean
  eligible: boolean
  reason: string
}

const PASSIVE_TOOLS = new Set([
  'read', 'read_image', 'glob', 'grep', 'web_search', 'ssh_list', 'job_list',
  'job_output', 'list_agents', 'get_goal', 'skill', 'mcp__codegraph__codegraph_explore',
])
const VERIFIER_TOOLS = new Set([
  'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_current_session',
])
const CONSEQUENTIAL_TOOLS = new Set([
  'edit', 'write', 'pwsh', 'bash', 'run_code', 'codex_image_generate',
  'ssh_exec', 'ssh_upload', 'ssh_download', 'ssh_tunnel', 'ssh_cluster',
  'job_kill', 'workbench_session_delete', 'create_goal', 'update_goal',
])

/**
 * Whether an agent session is a delegated child rather than the operator's own
 * topic. Child sessions are seeded with a real user message, so they look like
 * a fresh task to {@link analyzeAutoTask}; gate them only when asked.
 * @param agent - Agent (or any object exposing its session).
 * @returns True for subagent and forked-child sessions.
 */
export function isSubagentSession(agent: { session?: unknown } | undefined): boolean {
  const header = (agent?.session as { header?: { origin?: string; parentSession?: unknown } } | undefined)?.header
  return header?.origin === 'subagent' || header?.parentSession !== undefined
}

const VERIFIER_SESSION_TOOL = 'verifier_current_session'

/** Concatenate the text of a rendered content-block list (tool result or dispatch payload). */
function blockText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const block of value as readonly { type?: string; text?: unknown; content?: unknown }[]) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'tool-result') parts.push(blockText(block.content))
  }
  return parts.join('\n')
}

/**
 * Verdict carried by a completed `verifier_current_session` result.
 *
 * The tool renders its result as JSON, so the verdict is recovered from the emitted
 * text. An unreadable payload returns undefined and the manual review simply does
 * not count: a review that cannot be parsed must never be treated as a pass.
 * @param value - Result content blocks (or a raw string).
 * @returns The parsed verdict fields, or undefined.
 */
function parseSessionVerdict(value: unknown): { winner?: unknown; score?: unknown; criteria?: AcceptanceCriterion[] } | undefined {
  const text = blockText(value)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const row = parsed as { winner?: unknown; score?: unknown; criteria?: unknown }
    const criteria: AcceptanceCriterion[] = []
    for (const entry of Array.isArray(row.criteria) ? row.criteria : []) {
      const item = typeof entry === 'object' && entry !== null ? entry as { id?: unknown; name?: unknown; scoreA?: unknown } : {}
      if (typeof item.id !== 'string' || typeof item.scoreA !== 'number' || !Number.isFinite(item.scoreA)) continue
      criteria.push({ id: item.id, ...(typeof item.name === 'string' ? { name: item.name } : {}), score: item.scoreA })
    }
    return { winner: row.winner, score: row.score, criteria }
  } catch { return undefined }
}

function isConsequential(name: string): boolean {
  if (CONSEQUENTIAL_TOOLS.has(name)) return true
  if (PASSIVE_TOOLS.has(name) || VERIFIER_TOOLS.has(name)) return false
  return /(?:edit|write|patch|apply|deploy|upload|delete|remove|kill|exec|shell|command|migration|database|tunnel|cluster)/iu.test(name)
}

interface CodeDispatchData {
  subCallId?: string
  name: string
  arguments?: unknown
  isError?: boolean
  content?: readonly { isError?: boolean }[]
}

/** Event names that carry one settled PTC/code dispatch, across the hosts the plugin supports. */
const CODE_DISPATCH_TYPES = new Set(['tool/code-dispatch', 'tool/ptc-dispatch'])

function isSuccessfulCodeDispatch(data: CodeDispatchData): boolean {
  if (data.isError === true) return false
  if (Array.isArray(data.content) && data.content.some(b => b.isError === true)) return false
  return true
}

export function analyzeAutoTask(events: readonly SessionEvent[], policy: AutoVerifyPolicy): AutoTaskEvidence {
  const taskStartSeq = latestDirectUserSeq(events)
  if (taskStartSeq === undefined) return { taskStartSeq: 0, toolCalls: 0, completedToolResults: 0, consequentialToolCalls: 0, hasManualSessionVerification: false, manualVerificationAccepted: false, eligible: false, reason: 'no-direct-user-task' }

  const relevant = events.filter(event => event.seq >= taskStartSeq)
  const calls = relevant.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call')
  const results = new Map<string, SessionEvent<'tool/result'>>()
  for (const event of relevant) {
    if (event.type !== 'tool/result' || event.data.error !== undefined) continue
    if (!event.data.message.content.every(block => block.isError !== true)) continue
    results.set(String(event.data.message.source.callId), event)
  }
  const pairedCalls = calls.filter(event => results.has(String(event.data.callId)))

  // Both names exist in the wild: 0.1.5 emits tool/ptc-dispatch, older hosts tool/code-dispatch.
  const dispatches = relevant
    .filter(event => CODE_DISPATCH_TYPES.has(event.type as string))
    .map(event => ({ seq: event.seq, data: (event as unknown as { data: CodeDispatchData }).data }))
  const successfulDispatches = dispatches.filter(entry => isSuccessfulCodeDispatch(entry.data))

  const toolCalls = calls.filter(event => !VERIFIER_TOOLS.has(event.data.name)).length + dispatches.filter(entry => !VERIFIER_TOOLS.has(entry.data.name)).length
  const completedToolResults = pairedCalls.length + successfulDispatches.length
  const consequentialToolCalls = pairedCalls.filter(event => isConsequential(event.data.name)).length + successfulDispatches.filter(entry => isConsequential(entry.data.name)).length

  // A manual session verification only stands in for the automatic gate when it actually
  // passed the configured threshold AND nothing consequential happened afterwards.
  // Merely calling the tool — a failing verdict, an unreadable result, or a pass that was
  // followed by more edits — must never disarm the gate.
  const stale = (seq: number) => pairedCalls.some(event => event.seq > seq && isConsequential(event.data.name))
    || successfulDispatches.some(entry => entry.seq > seq && isConsequential(entry.data.name))
  const manualVerdicts: Array<{ seq: number; winner: unknown; score: unknown; criteria?: AcceptanceCriterion[] }> = []
  for (const event of pairedCalls) {
    if (event.data.name !== VERIFIER_SESSION_TOOL) continue
    const result = results.get(String(event.data.callId))
    if (result === undefined) continue
    const verdict = parseSessionVerdict(result.data.message.content)
    manualVerdicts.push({ seq: result.seq, winner: verdict?.winner, score: verdict?.score, criteria: verdict?.criteria })
  }
  for (const entry of successfulDispatches) {
    if (entry.data.name !== VERIFIER_SESSION_TOOL) continue
    const verdict = parseSessionVerdict(entry.data.content)
    manualVerdicts.push({ seq: entry.seq, winner: verdict?.winner, score: verdict?.score, criteria: verdict?.criteria })
  }
  const hasManualSessionVerification = manualVerdicts.length > 0
  // Same acceptance rule as the automatic gate, including the per-criterion floor:
  // otherwise an explicitly called verification with one failed requirement could
  // disarm the gate that the automatic path would have kept closed.
  const manualVerificationAccepted = manualVerdicts.some(verdict =>
    verdict.winner === 'A'
    && typeof verdict.score === 'number'
    && sessionAccepted({ score: verdict.score, winner: 'A', criteria: verdict.criteria }, policy.threshold)
    && !stale(verdict.seq))

  if (policy.mode === 'manual') return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'manual-mode' }
  if (manualVerificationAccepted) return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'already-verified' }
  if (consequentialToolCalls === 0) return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'no-consequential-work' }
  if (completedToolResults === 0) return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'no-completed-evidence' }
  if (policy.mode === 'smart' && toolCalls < policy.minToolCalls) return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: false, reason: 'insufficient-tool-evidence' }
  return { taskStartSeq, toolCalls, completedToolResults, consequentialToolCalls, hasManualSessionVerification, manualVerificationAccepted, eligible: true, reason: policy.mode + '-eligible' }
}

/** One criterion's outcome from a session acceptance (candidate A is the session). */
export interface AcceptanceCriterion {
  id: string
  name?: string
  score: number
}

/**
 * Criteria that do not clear the acceptance threshold.
 *
 * The acceptance score is the MEAN over criteria, so a session with one requirement at
 * zero and the others perfect averaged ~0.67 and cleared the 0.65 default: a single
 * failed requirement was arithmetically invisible. The gate therefore also requires
 * every criterion to clear the threshold on its own.
 * @param criteria - per-criterion A-side scores, when the judge reported them.
 * @param threshold - acceptance threshold.
 * @returns The failing criteria, in report order.
 */
export function failedAcceptanceCriteria(criteria: readonly AcceptanceCriterion[] | undefined, threshold: number): AcceptanceCriterion[] {
  return (criteria ?? []).filter(criterion => !(criterion.score >= threshold))
}

/**
 * Whether a session acceptance clears the gate.
 *
 * The empty-work baseline is a fixed sentence that always scores 0, so the comparison
 * itself is decorative; what actually decides is the session's own score, the winner
 * against that baseline, and (since the mean could hide a failed requirement) every
 * criterion clearing the threshold.
 * @param evidence - session acceptance result (score, winner and per-criterion scores).
 * @param threshold - acceptance threshold.
 * @returns True only when the session may conclude.
 */
export function sessionAccepted(evidence: { score: number; winner: 'A' | 'B' | 'tie'; criteria?: readonly AcceptanceCriterion[] }, threshold: number): boolean {
  if (evidence.winner !== 'A' || !(evidence.score >= threshold)) return false
  return failedAcceptanceCriteria(evidence.criteria, threshold).length === 0
}

export function automaticFeedback(score: number, baselineScore: number, winner: 'A' | 'B' | 'tie', threshold: number, failedCriteria: readonly AcceptanceCriterion[] = []): string {
  const percent = (value: number) => (value * 100).toFixed(1) + '%'
  return [
    '[Automatic verifier gate]',
    `The independent verifier did not clear this task for completion: evidence score ${percent(score)}, baseline ${percent(baselineScore)}, verdict ${winner}, required ${percent(threshold)}.`,
    ...(failedCriteria.length > 0
      ? ['Criteria below the threshold: ' + failedCriteria.map(criterion => (criterion.name ?? criterion.id) + ' ' + percent(criterion.score)).join('; ') + '.']
      : []),
    'Re-open the task requirements, inspect the actual tool outputs for unresolved errors or missing proof, make any necessary corrections, and run a directly relevant verification command before concluding. Do not merely restate that the task is complete.',
  ].join('\n')
}
