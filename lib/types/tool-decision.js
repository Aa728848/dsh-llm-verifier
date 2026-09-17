/**
 * Refuse a tool call with the structured detail attached.
 *
 * The extra field is emitted on every supported host on purpose:
 * - 0.1.6 persists it as durable error detail, keeping the model-facing sentence short and the
 *   findings visible in the tool card;
 * - earlier hosts read only `decision.reason` when they build the error result, so the unknown key
 *   is inert there.
 * The assertion is the single place the two host declarations are reconciled; every caller stays
 * typed against the host's own `PreToolDecision`.
 * @param reason - the model-facing sentence explaining the refusal.
 * @param info - structured detail a reader can act on without parsing that sentence.
 * @returns the decision the host accepts on either host line.
 */
export function denyWithInfo(reason, info) {
    return { kind: 'deny', reason, info };
}
/**
 * Abandon a call that is already cancelled instead of deciding it.
 *
 * DSH 0.1.6 added `cancel` to select the host's canonical "aborted before dispatch" result rather
 * than expressing a policy refusal. Earlier hosts declare no such kind, and something stronger than
 * a cast is what makes that safe: an unrecognised kind leaves `decision.reason` undefined there, so
 * `prepareExecution` skips its denial branch and reaches its own `callerCancelled(exec)` check,
 * which returns the same cancellation result. A caller must therefore only take this path once the
 * signal is genuinely aborted — otherwise it would refuse a live call by accident.
 * @returns the decision the host accepts on either host line.
 */
export function cancelledCall() {
    return { kind: 'cancel' };
}
//# sourceMappingURL=tool-decision.js.map