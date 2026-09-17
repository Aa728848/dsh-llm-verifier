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
export declare const DEFAULT_REDACT_PATTERNS: readonly ["Bearer\\s+[A-Za-z0-9._~+\\/=-]+", "(?:api[_-]?key|token|password|secret)\\s*[=:]\\s*[\"']?[^\\s,\"';}]+"];
export declare function redactText(text: string, patterns?: readonly string[]): string;
export declare function sanitizeVerifierText(text: string, maxChars: number, patterns?: readonly string[]): string;
export declare function extractSession(agent: Agent, loadImage: (ref: Extract<ContentBlock, {
    type: 'image';
}>['attachment']) => Promise<VerifierImage>, options?: SessionExtractOptions): Promise<SessionExtraction>;
//# sourceMappingURL=session.d.ts.map