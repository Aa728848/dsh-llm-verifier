/**
 * Acceptance test for one auxiliary answer.
 *
 * Everything the answer could be wrong about is checked here and nowhere else, so the streaming
 * path only ever has to decide "replace" or "keep the original": a rejected answer is a kept block,
 * never a partially applied rewrite.
 */
import type { IoTStrategy } from './mode.ts'
import { IOT_PROMPT_MARKER } from './prompt.ts'

/** One accepted decision node. */
export interface CompactionNode {
  readonly label: string
  readonly text: string
}

/** Why an auxiliary answer was refused. */
export type CompactionRejection =
  | 'empty'
  | 'malformed'
  | 'unknown-label'
  | 'too-many-nodes'
  | 'not-shorter'
  | 'degenerate'

/** Verdict on one auxiliary answer. */
export type CompactionAssessment =
  | { readonly accepted: true; readonly text: string; readonly nodes: CompactionNode[] }
  | { readonly accepted: false; readonly reason: CompactionRejection }

/** Exactly `- [label] text`: the one shape the prompt asks for. */
const NODE_LINE = /^-\s*\[([A-Za-z][A-Za-z-]*)\]\s+(\S.*)$/

/**
 * Decide whether one auxiliary answer may replace the reasoning block it was written for.
 * @param raw - the auxiliary answer, exactly as produced.
 * @param strategy - budget the answer must satisfy.
 * @param original - reasoning text being replaced.
 * @returns The accepted normalised text, or the rejection reason.
 */
export function assessCompaction(raw: string, strategy: IoTStrategy, original: string): CompactionAssessment {
  const trimmed = raw.trim()
  if (trimmed === '') return { accepted: false, reason: 'empty' }
  // The model echoed the instructions instead of writing nodes.
  if (trimmed.includes(IOT_PROMPT_MARKER)) return { accepted: false, reason: 'degenerate' }
  const nodes: CompactionNode[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const body = line.trim()
    if (body === '') continue
    const match = NODE_LINE.exec(body)
    if (match === null) return { accepted: false, reason: 'malformed' }
    const label = match[1].toLowerCase()
    if (!strategy.labels.includes(label)) return { accepted: false, reason: 'unknown-label' }
    nodes.push({ label, text: match[2].trim() })
  }
  if (nodes.length === 0) return { accepted: false, reason: 'empty' }
  if (nodes.length > strategy.maxNodes) return { accepted: false, reason: 'too-many-nodes' }
  const text = nodes.map(node => '- [' + node.label + '] ' + node.text).join('\n')
  if (text.length >= original.length) return { accepted: false, reason: 'not-shorter' }
  // Degenerate answers keep the shape but drop the content: no word, no digit, or one stub repeated.
  if (!/[\p{L}\p{N}]/u.test(nodes.map(node => node.text).join('\n'))) return { accepted: false, reason: 'degenerate' }
  if (nodes.length > 1 && new Set(nodes.map(node => node.text)).size === 1) {
    return { accepted: false, reason: 'degenerate' }
  }
  return { accepted: true, text, nodes }
}
