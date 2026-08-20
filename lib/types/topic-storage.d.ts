import type { SessionHeader } from '@deepseek-ai/dsh-session';
export interface SessionArtifactLocator {
    locate(meta: SessionHeader): {
        readonly path: string;
    } | undefined;
}
/**
 * Resolve verifier sidecars beneath the persistence backend's per-session
 * directory. The JSONL backend deliberately owns this directory for
 * session-local artifacts, so permanent session deletion removes these files
 * together with the conversation log.
 */
export declare function resolveTopicDataDir(locator: SessionArtifactLocator, header: SessionHeader, cacheDir: string): string;
//# sourceMappingURL=topic-storage.d.ts.map