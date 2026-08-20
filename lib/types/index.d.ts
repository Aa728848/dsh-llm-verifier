import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export declare const name = "llm-verifier";
export declare const inject: string[];
export { Config };
export * from './core.ts';
export * from './engine.ts';
export * from './cache.ts';
export * from './statistics.ts';
export * from './topic-storage.ts';
export * from './auto.ts';
export * from './router.ts';
export { callVerifier, RequestLimiter, type VerifierClientConfig, type VerifierImage, type UsageStats, type VerifierCompletion } from './caller.ts';
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map