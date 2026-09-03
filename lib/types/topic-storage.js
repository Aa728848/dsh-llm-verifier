import { dirname, isAbsolute, relative, resolve } from 'node:path';
function escapes(root, target) {
    const child = relative(root, target);
    return child === '..' || child.startsWith('..\\') || child.startsWith('../') || isAbsolute(child);
}
/**
 * Resolve verifier sidecars beneath the persistence backend's per-session
 * directory. The JSONL backend deliberately owns this directory for
 * session-local artifacts, so permanent session deletion removes these files
 * together with the conversation log.
 */
export function resolveTopicDataDir(locator, header, cacheDir) {
    if (isAbsolute(cacheDir))
        throw new Error('llm-verifier: cacheDir must be relative so verifier data stays inside its topic directory');
    let topicDir;
    if (typeof locator?.locate === 'function') {
        const location = locator.locate(header);
        if (location && typeof location.path === 'string') {
            topicDir = dirname(location.path);
        }
    }
    if (!topicDir && typeof locator?.root === 'string' && header?.id) {
        topicDir = resolve(locator.root, String(header.id));
    }
    if (topicDir === undefined) {
        throw new Error('llm-verifier: the active session persistence backend does not expose a per-session artifact directory');
    }
    const target = resolve(topicDir, cacheDir);
    if (escapes(topicDir, target))
        throw new Error('llm-verifier: cacheDir must stay inside the topic directory');
    return target;
}
//# sourceMappingURL=topic-storage.js.map