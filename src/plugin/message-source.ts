/**
 * This plugin's producer identity for injected messages; hosts before 0.1.7 used a shared wrapper
 * that newer hosts also reject as a persistence source. See D12.
 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Messages this plugin injects: steering notices, gate feedback and judge failures. */
    'llm-verifier': { kind: 'llm-verifier' } & ContextFormed
  }
}
