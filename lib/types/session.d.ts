import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { VerifierImage } from './caller.ts';
/**
 * Read one session's event log.
 *
 * DSH 0.1.5 replaced the `events` array with `snapshotEvents()`; older hosts
 * expose the array directly. Both shapes are accepted so the plugin keeps
 * working across the versions it declares support for.
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