import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { VerifierImage } from './caller.ts';
/**
 * Read one session's event log.
 *
 * DSH 0.1.5 replaced the `events` array with `snapshotEvents()`; older hosts expose the array
 * directly. Both shapes are accepted so the plugin keeps working across the versions it declares
 * support for.
 *
 * DSH 0.1.6 deprecated `snapshotEvents()`: existing logic may stay unmigrated, but new calls are
 * prohibited, and so are wrappers that expose the same synchronous history — this function is such
 * a wrapper and is kept deliberately. The replacement the host offers, `SessionController.page()`,
 * is filtered to `user/message` and `assistant/message`, so `tool/call`, `tool/result` and the PTC
 * dispatches this plugin scores on do not come back through it; the host's own `auto-review`
 * carries the same waiver for the same reason. The migration is to maintain the evidence these
 * readers need through a registered Session projection instead of looking back through the log;
 * `AGENTS.md` records the decision and what would force it.
 * @param session - Agent session, or any object exposing one of the two shapes.
 * @returns The session's events in log order, or an empty array.
 */
export declare function sessionEvents(session: unknown): readonly SessionEvent[];
export interface SessionExtractOptions {
    fromSeq?: number;
    toSeq?: number;
    includeAssistantText?: boolean;
    redactPatterns?: readonly string[];
    maxChars?: number;
}
export interface SessionExtraction {
    problem: string;
    trace: string;
    images: VerifierImage[];
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    omittedCharacters: number;
}
/**
 * Inner blocks of a pre-0.1.7 nested `tool-result` block.
 *
 * DSH 0.1.6 and earlier modelled a tool result as a `tool-result` content block wrapping the
 * result's own blocks inside the answering message. DSH 0.1.7 deleted that block type: the tool
 * result is now a tool-role message whose `content` IS those blocks. Both shapes are still read,
 * because the plugin declares support for hosts on either side of the change.
 * @param block - one content block, possibly the legacy wrapper.
 * @returns The wrapped blocks, or undefined when this is not a legacy wrapper.
 */
export declare function toolResultBlocks(block: ContentBlock): readonly ContentBlock[] | undefined;
/**
 * Whether one tool result reports a failed invocation.
 *
 * DSH 0.1.7 moved the flag from the nested `tool-result` block onto the tool-role message itself
 * (`isError`); earlier hosts carry it on the block. Both are read so a failure is never scored as
 * a success on either host.
 * @param message - the `tool/result` event's message.
 * @returns True when either host's shape marks the invocation as failed.
 */
export declare function toolResultFailed(message: {
    isError?: boolean;
    content: readonly ContentBlock[];
}): boolean;
export declare const DEFAULT_REDACT_PATTERNS: readonly ["Bearer\\s+[A-Za-z0-9._~+\\/=-]+", "(?:api[_-]?key|token|password|secret)\\s*[=:]\\s*[\"']?[^\\s,\"';}]+"];
export declare function redactText(text: string, patterns?: readonly string[]): string;
export declare function sanitizeVerifierText(text: string, maxChars: number, patterns?: readonly string[]): string;
export declare function extractSession(agent: Agent, loadImage: (ref: Extract<ContentBlock, {
    type: 'image';
}>['attachment']) => Promise<VerifierImage>, options?: SessionExtractOptions): Promise<SessionExtraction>;
//# sourceMappingURL=session.d.ts.map