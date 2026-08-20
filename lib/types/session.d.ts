import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { VerifierImage } from './caller.ts';
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