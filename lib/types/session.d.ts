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
export declare function extractSession(agent: Agent, loadImage: (ref: Extract<ContentBlock, {
    type: 'image';
}>['attachment']) => Promise<VerifierImage>, options?: SessionExtractOptions): Promise<SessionExtraction>;
//# sourceMappingURL=session.d.ts.map