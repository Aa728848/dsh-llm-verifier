import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useMemo, useState } from 'react';
const NS = 'llm-verifier';
const shell = { display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 4px 32px', color: 'var(--dsw-text-primary)' };
const card = { display: 'flex', flexDirection: 'column', gap: 0, padding: '16px 16px 0', border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))', borderRadius: 12, background: 'var(--dsw-alias-bg-module, rgba(20, 31, 57, 0.42))', overflow: 'hidden' };
const sectionTitle = { display: 'flex', gap: 10, alignItems: 'center', padding: '0 0 12px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' };
const row = { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(220px, 1.4fr)', gap: 18, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' };
const selectStyle = { width: '100%', minHeight: 38, padding: '0 12px', borderRadius: 10, color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)', border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' };
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; }
function values(view) { const v = record(view.value); return { provider: String(v.provider ?? ''), model: String(v.model ?? ''), ...(typeof v.reasoningEffort === 'string' ? { reasoningEffort: v.reasoningEffort } : {}), maxTokens: Number(v.maxTokens ?? 32768), maxConcurrency: Number(v.maxConcurrency ?? 8), maxRetries: Number(v.maxRetries ?? 3), timeoutMs: Number(v.timeoutMs ?? 300000), cacheMaxEntries: Number(v.cacheMaxEntries ?? 10000), estimatedInputUsdPerMillion: Number(v.estimatedInputUsdPerMillion ?? 0), estimatedOutputUsdPerMillion: Number(v.estimatedOutputUsdPerMillion ?? 0) }; }
function message(error) { return error instanceof Error ? error.message : String(error); }
function Label({ title, help }) { return _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600 }, children: title }), _jsx("div", { style: { fontSize: 12, color: 'var(--dsw-text-secondary)', marginTop: 3 }, children: help })] }); }
function VerifierSettings({ api }) {
    const [loaded, setLoaded] = useState(null);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const load = async () => { setError(null); try {
        const [m, s] = await Promise.all([api.llm.models({}), api.settings.describe({})]);
        if (!m.result.ok)
            throw new Error(m.result.error.message);
        if (!s.result.ok)
            throw new Error(s.result.error.message);
        const view = s.result.value.namespaces.find((x) => x.ns === NS);
        if (!view)
            throw new Error('Verifier settings namespace is not registered. Restart the DSH host.');
        const next = { groups: m.result.value.groups, settings: view, writable: s.result.value.writable, failures: m.result.value.failures.map((f) => f.name + ': ' + f.message) };
        setLoaded(next);
        setDraft(values(view));
    }
    catch (e) {
        setError(message(e));
    } };
    useEffect(() => { void load(); }, []);
    const models = useMemo(() => loaded?.groups.find(g => g.id === draft?.provider)?.models ?? [], [loaded, draft?.provider]);
    const selected = models.find(m => m.id === draft?.model);
    const efforts = selected?.reasoning?.efforts ?? [];
    const patch = (key, value) => setDraft(v => v ? { ...v, [key]: value } : v);
    const save = async () => { if (!loaded || !draft)
        return; setBusy(true); setSaved(false); setError(null); try {
        const section = { ...record(loaded.settings.user), ...draft };
        if (!draft.reasoningEffort)
            delete section.reasoningEffort;
        const res = await api.settings.update({ ns: NS, patch: section, expectedRevision: loaded.settings.revision });
        if (!res.result.ok)
            throw new Error(res.result.error.message);
        setLoaded(v => v ? { ...v, settings: res.result.value } : v);
        setDraft(values(res.result.value));
        setSaved(true);
    }
    catch (e) {
        setError(message(e));
    }
    finally {
        setBusy(false);
    } };
    if (!loaded || !draft)
        return _jsxs("div", { style: shell, children: [_jsx("h2", { children: "LLM Verifier" }), _jsx("p", { children: error ?? '正在读取 DSH 模型和设置…' }), error && _jsx(Button, { onClick: () => void load(), children: "\u91CD\u8BD5" })] });
    const numeric = (key, min = 0) => _jsx(Input, { type: "number", min: min, value: String(draft[key]), onChange: e => patch(key, Number(e.target.value)) });
    return _jsxs("div", { style: shell, children: [_jsxs("div", { children: [_jsx("h2", { style: { margin: '0 0 6px' }, children: "LLM Verifier" }), _jsx("p", { style: { margin: 0, color: 'var(--dsw-text-secondary)' }, children: "\u9009\u62E9\u4EFB\u610F\u5DF2\u5728 DSH\u300C\u6A21\u578B\u300D\u9875\u914D\u7F6E\u5E76\u542F\u7528\u7684\u6A21\u578B\u4F5C\u4E3A\u72EC\u7ACB\u88C1\u5224\u3002\u8BBE\u7F6E\u5B9E\u65F6\u751F\u6548\u3002" })] }), _jsxs("div", { style: card, children: [_jsxs("div", { style: sectionTitle, children: [_jsx(StateDot, { state: "done" }), _jsx("strong", { children: "\u88C1\u5224\u6A21\u578B" })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u4F9B\u5E94\u5546", help: "\u53EA\u663E\u793A\u5F53\u524D DSH \u4E2D\u53EF\u8DEF\u7531\u7684\u4F9B\u5E94\u5546" }), _jsx("select", { style: selectStyle, value: draft.provider, onChange: e => { const provider = e.target.value; const first = loaded.groups.find(g => g.id === provider)?.models[0]; setDraft({ ...draft, provider, ...(first ? { model: first.id, reasoningEffort: first.reasoning?.defaultEffort } : {}) }); }, children: loaded.groups.map(g => _jsxs("option", { value: g.id, children: [g.name, " \u00B7 ", g.id] }, g.id)) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u6A21\u578B", help: "\u6A21\u578B\u76EE\u5F55\u6765\u81EA DSH adapter\uFF0C\u9009\u62E9\u7ED3\u679C\u4F1A\u6301\u4E45\u5316" }), _jsx("select", { style: selectStyle, value: draft.model, onChange: e => { const model = e.target.value; const found = models.find(m => m.id === model); setDraft({ ...draft, model, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) }); }, children: models.map(m => _jsxs("option", { value: m.id, children: [m.name, " \u00B7 ", m.id] }, m.id)) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u63A8\u7406\u5F3A\u5EA6", help: "\u7531\u6240\u9009\u6A21\u578B adapter \u58F0\u660E\uFF1B\u7559\u7A7A\u4F7F\u7528\u6A21\u578B\u9ED8\u8BA4\u503C" }), _jsxs("select", { style: selectStyle, value: draft.reasoningEffort ?? '', onChange: e => patch('reasoningEffort', e.target.value || undefined), children: [_jsx("option", { value: "", children: "\u6A21\u578B\u9ED8\u8BA4" }), efforts.map(e => _jsx("option", { value: e.id, children: e.name }, e.id))] })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u6700\u5927\u8F93\u51FA Token", help: "\u6BCF\u4E2A\u88C1\u5224\u8BF7\u6C42\u7684\u8F93\u51FA\u4E0A\u9650" }), numeric('maxTokens', 1)] })] }), _jsxs("div", { style: card, children: [_jsx("div", { style: sectionTitle, children: _jsx("strong", { children: "\u6267\u884C\u63A7\u5236" }) }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u6700\u5927\u5E76\u53D1", help: "\u6240\u6709 verifier \u5DE5\u5177\u5171\u4EAB\u7684\u8BF7\u6C42\u5E76\u53D1\u4E0A\u9650" }), numeric('maxConcurrency', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u6700\u591A\u91CD\u8BD5", help: "\u77ED\u6682\u7F51\u7EDC\u3001\u9650\u6D41\u548C\u670D\u52A1\u7AEF\u9519\u8BEF\u7684\u91CD\u8BD5\u6B21\u6570" }), numeric('maxRetries', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09", help: "\u5355\u4E2A\u6A21\u578B\u8BF7\u6C42\u7684\u8D85\u65F6\u65F6\u95F4" }), numeric('timeoutMs', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u7F13\u5B58\u6761\u76EE\u4E0A\u9650", help: "\u6301\u4E45\u8BC4\u5206\u7F13\u5B58\u4FDD\u7559\u7684\u6700\u5927\u6761\u76EE\u6570" }), numeric('cacheMaxEntries', 1)] })] }), _jsxs("div", { style: card, children: [_jsx("div", { style: sectionTitle, children: _jsx("strong", { children: "\u8D39\u7528\u4F30\u7B97\uFF08\u6BCF\u767E\u4E07 Token\uFF0CUSD\uFF09" }) }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u8F93\u5165\u4EF7\u683C", help: "\u4EC5\u7528\u4E8E\u7ED3\u679C\u4E2D\u7684 estimatedCostUsd" }), numeric('estimatedInputUsdPerMillion', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: "\u8F93\u51FA\u4EF7\u683C", help: "\u4EC5\u7528\u4E8E\u7ED3\u679C\u4E2D\u7684 estimatedCostUsd" }), numeric('estimatedOutputUsdPerMillion', 0)] })] }), loaded.failures.length > 0 && _jsxs("div", { style: { ...card, borderColor: 'var(--dsw-alias-state-warn-primary, #d9a441)', paddingBottom: 16 }, children: [_jsx("strong", { children: "\u90E8\u5206\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" }), loaded.failures.map(x => _jsx("div", { children: x }, x))] }), error && _jsx("div", { style: { color: 'var(--dsw-danger)' }, children: error }), saved && _jsx("div", { style: { color: 'var(--dsw-success)' }, children: "\u5DF2\u4FDD\u5B58\uFF0C\u540E\u7EED verifier \u8C03\u7528\u5C06\u4F7F\u7528\u65B0\u8BBE\u7F6E\u3002" }), _jsxs("div", { style: { display: 'flex', gap: 10 }, children: [_jsx(Button, { disabled: busy || !loaded.writable, onClick: () => void save(), children: busy ? '保存中…' : '保存设置' }), _jsx(Button, { variant: "outline", disabled: busy, onClick: () => void load(), children: "\u91CD\u65B0\u8F7D\u5165" })] })] });
}
export const inject = ['slots', 'connection'];
export function apply(ctx) { const connection = ctx.get('connection'); ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'llm-verifier', order: 35, label: 'LLM Verifier', inject: () => ({ api: connection.api }) }, VerifierSettings)); }
//# sourceMappingURL=client.js.map