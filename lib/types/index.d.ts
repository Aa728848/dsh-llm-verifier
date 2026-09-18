import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
import { type RoutedAgent } from './router.ts';
export declare const name = "llm-verifier";
export declare const inject: string[];
export { Config };
export * from './core.ts';
export * from './engine.ts';
export * from './cache.ts';
export * from './statistics.ts';
export * from './topic-storage.ts';
export * from './decisions.ts';
export * from './auto.ts';
export * from './router.ts';
export * from './pricing.ts';
export * from './plan-gate.ts';
export * from './team-gate.ts';
export * from './workspace.ts';
export { callVerifier, RequestLimiter, type VerifierClientConfig, type VerifierImage, type UsageStats, type VerifierCompletion } from './caller.ts';
/**
 * Probe live host runtime services for subagents or background jobs owned by the agent that remain active.
 *
 * Probed at runtime without hardcoded version assumptions, gracefully degrading if services are missing.
 * @param ctx - plugin Context.
 * @param agent - calling Agent.
 * @param signal - cancellation signal.
 * @returns True when live subagents or background jobs are actively running.
 */
export declare function hasLiveActiveSubagents(ctx: Context, agent: RoutedAgent, signal?: AbortSignal): Promise<boolean>;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map