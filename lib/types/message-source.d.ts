/**
 * This plugin's producer identity for the user-role messages it injects into a session.
 *
 * DSH 0.1.6 and earlier attributed every injected message to the single shared wrapper
 * `{ kind: 'plugin', plugin: '<name>' }`. DSH 0.1.7 deleted that wrapper from
 * `MessageSourceMap` — each producer declares its own `kind` by declaration merging — so the
 * wrapper is also rejected as a *persistence* source when the host admits a native V4 row. The
 * host rewrites rows written by the old wrapper to `plugin:<name>` when it reads a released V3
 * log; a plugin that has migrated writes its own declared kind instead of adopting that
 * migration-only name.
 *
 * `ContextFormed` is mixed in so the injected steering notices keep their `notice` form and
 * one-line summary, exactly as the retired wrapper allowed.
 *
 * @module dsh-llm-verifier/message-source
 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** Messages this plugin injects: steering notices, gate feedback and judge failures. */
        'llm-verifier': {
            kind: 'llm-verifier';
        } & ContextFormed;
    }
}
//# sourceMappingURL=message-source.d.ts.map