import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/**
 * Structured detail a refusal may carry. Restated rather than imported: only one supported host
 * line declares the name, and importing it would fail to build on the others (D12).
 */
export interface ToolDenialInfo {
  /** Stable identity of the refusing gate. */
  name: string
  /** Machine-readable reason code, stable across message wording changes. */
  code: string
  /** Raw findings; shown to users, never sent to the model. */
  reason?: string
}

/**
 * Refuse a tool call with structured detail attached. The field is emitted on every host on
 * purpose: 0.1.6 persists it as durable error detail and keeps the model-facing sentence short,
 * while earlier hosts read only `reason` and ignore the unknown key. This cast is the single place
 * the two declarations are reconciled (D12).
 */
export function denyWithInfo(reason: string, info: ToolDenialInfo): PreToolDecision {
  return { kind: 'deny', reason, info } as PreToolDecision
}

/**
 * Abandon a call that is already cancelled. The unrecognised `kind` is safe rather than sloppy:
 * earlier hosts leave `reason` undefined and fall through to their own `callerCancelled(exec)`,
 * which yields the same result. Only take this path once the signal is genuinely aborted,
 * otherwise it refuses a live call (D12).
 */
export function cancelledCall(): PreToolDecision {
  return { kind: 'cancel' } as unknown as PreToolDecision
}
