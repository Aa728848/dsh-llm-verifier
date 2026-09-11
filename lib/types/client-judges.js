// Must stay equal to MAX_EXTRA_JUDGES in src/config.ts: importing it here would pull
// schemastery into the web-client bundle, so the cap is duplicated deliberately.
export const MAX_EXTRA_JUDGES = 4;
export function normalizeExtraJudges(value) {
    if (!Array.isArray(value))
        return [];
    const results = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
        const raw = item;
        if (typeof raw.provider !== 'string' || typeof raw.model !== 'string')
            continue;
        const provider = raw.provider.trim();
        const model = raw.model.trim();
        if (!provider || !model)
            continue;
        const draft = { provider, model };
        if (typeof raw.reasoningEffort === 'string') {
            const effort = raw.reasoningEffort.trim();
            if (effort)
                draft.reasoningEffort = effort;
        }
        if (typeof raw.label === 'string') {
            const label = raw.label.trim();
            if (label)
                draft.label = label;
        }
        results.push(draft);
        if (results.length >= MAX_EXTRA_JUDGES)
            break;
    }
    return results;
}
export function judgeIdentity(provider, model) {
    return `${provider.trim()}/${model.trim()}`;
}
export function judgeConflict(primary, judges) {
    const primaryId = (primary.provider.trim() && primary.model.trim())
        ? judgeIdentity(primary.provider, primary.model)
        : undefined;
    const seen = new Map();
    for (let i = 0; i < judges.length; i++) {
        const judge = judges[i];
        const p = judge.provider.trim();
        const m = judge.model.trim();
        if (!p || !m)
            continue;
        const id = judgeIdentity(p, m);
        if (primaryId !== undefined && id === primaryId) {
            return { index: i, duplicateOf: 'primary' };
        }
        const prev = seen.get(id);
        if (prev !== undefined) {
            return { index: i, duplicateOf: prev };
        }
        seen.set(id, i);
    }
    return undefined;
}
export function addExtraJudge(judges, draft) {
    if (judges.length >= MAX_EXTRA_JUDGES) {
        return [...judges];
    }
    const provider = draft.provider.trim();
    const model = draft.model.trim();
    const item = { provider, model };
    if (typeof draft.reasoningEffort === 'string') {
        const effort = draft.reasoningEffort.trim();
        if (effort)
            item.reasoningEffort = effort;
    }
    if (typeof draft.label === 'string') {
        const label = draft.label.trim();
        if (label)
            item.label = label;
    }
    return [...judges, item];
}
export function removeExtraJudge(judges, index) {
    if (index < 0 || index >= judges.length) {
        return [...judges];
    }
    return judges.filter((_, i) => i !== index);
}
export function serializeExtraJudges(judges) {
    const list = judges.slice(0, MAX_EXTRA_JUDGES);
    const result = [];
    for (const judge of list) {
        const provider = judge.provider.trim();
        const model = judge.model.trim();
        if (!provider || !model)
            continue;
        const entry = { provider, model };
        if (typeof judge.reasoningEffort === 'string') {
            const effort = judge.reasoningEffort.trim();
            if (effort)
                entry.reasoningEffort = effort;
        }
        if (typeof judge.label === 'string') {
            const label = judge.label.trim();
            if (label)
                entry.label = label;
        }
        result.push(entry);
    }
    return result;
}
//# sourceMappingURL=client-judges.js.map