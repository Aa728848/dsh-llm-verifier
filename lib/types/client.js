import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, IconDataOutline16, IconRefreshOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useMemo, useRef, useState } from 'react';
import { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, resolveCacheDirOnSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, } from "./client-i18n.js";
import { MAX_EXTRA_JUDGES, normalizeExtraJudges, judgeIdentity, judgeConflict, addExtraJudge, removeExtraJudge, serializeExtraJudges, } from "./client-judges.js";
export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, resolveCacheDirOnSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, };
const NS = 'llm-verifier';
const shell = { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 0 32px', color: 'var(--dsw-alias-label-primary)' };
const settingsHeading = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' };
const settingsIntro = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' };
const group = { width: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--dsw-alias-border-l2)' };
const groupTitle = { margin: 0, padding: '18px 0 8px', fontSize: 14, fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' };
const row = { minHeight: 64, display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(230px, 288px)', gap: 24, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' };
const selectStyle = { boxSizing: 'border-box', width: '100%', height: 36, padding: '0 34px 0 12px', borderRadius: 8, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-input)', border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 14, lineHeight: '22px', outline: 'none' };
const toggleStyle = (enabled) => ({ position: 'relative', justifySelf: 'end', width: 40, height: 22, padding: 0, border: 0, borderRadius: 999, cursor: 'pointer', transition: 'background .15s ease', background: enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-input)' });
const toggleThumbStyle = (enabled) => ({ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-static-neutral-00, #fff)', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left .15s ease' });
const dashboardCard = { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.13))', background: 'color-mix(in srgb, var(--dsw-alias-bg-module, #171925) 88%, transparent)', borderRadius: 16, boxShadow: '0 12px 36px rgba(0,0,0,.12)' };
const muted = { color: 'var(--dsw-text-secondary)', fontSize: 12 };
const toolColors = { verifier_route_classify: '#d97706', verifier_compare: '#4f8cff', verifier_select: '#8b6df6', verifier_track: '#2fc5c9', verifier_current_session: '#f5a524' };
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; }
function values(view) { const v = record(view.value); const mode = v.autoVerifyMode === 'manual' || v.autoVerifyMode === 'strict' ? v.autoVerifyMode : 'smart'; return { enabled: v.enabled !== false, autoVerifyMode: mode, autoVerifyThreshold: Number(v.autoVerifyThreshold ?? .65), autoVerifyRepeats: Number(v.autoVerifyRepeats ?? 1), autoVerifyFinalRepeats: Number(v.autoVerifyFinalRepeats ?? 2), autoVerifyMinToolCalls: Number(v.autoVerifyMinToolCalls ?? 3), autoVerifyMaxChars: Number(v.autoVerifyMaxChars ?? 80000), autoVerifyMaxPerTask: Number(v.autoVerifyMaxPerTask ?? 2), autoVerifyMaxPerSession: Number(v.autoVerifyMaxPerSession ?? 8), autoRouteSemantic: v.autoRouteSemantic !== false, autoRouteMinConfidence: Number(v.autoRouteMinConfidence ?? .9), autoRouteMaxCandidates: Number(v.autoRouteMaxCandidates ?? 8), autoRouteMaxPerTask: Number(v.autoRouteMaxPerTask ?? 2), autoRouteMaxPerSession: Number(v.autoRouteMaxPerSession ?? 8), autoTrackCompletionThreshold: Number(v.autoTrackCompletionThreshold ?? .8), autoRouteMaxItemChars: Number(v.autoRouteMaxItemChars ?? 20000), autoRouteMaxInputChars: Number(v.autoRouteMaxInputChars ?? 60000), autoMaxModelCallsPerTask: Number(v.autoMaxModelCallsPerTask ?? 96), autoMaxModelCallsPerSession: Number(v.autoMaxModelCallsPerSession ?? 240), autoVerifyTeamTasks: v.autoVerifyTeamTasks !== false, autoVerifyPlanMode: v.autoVerifyPlanMode !== false, provider: String(v.provider ?? ''), model: String(v.model ?? ''), ...(typeof v.reasoningEffort === 'string' ? { reasoningEffort: v.reasoningEffort } : {}), maxTokens: Number(v.maxTokens ?? 32768), temperature: Number(v.temperature ?? 0.2), ...(typeof v.label === 'string' && v.label.trim() ? { label: v.label.trim() } : {}), maxConcurrency: Number(v.maxConcurrency ?? 8), maxRetries: Number(v.maxRetries ?? 3), retryBaseDelayMs: Number(v.retryBaseDelayMs ?? 500), timeoutMs: Number(v.timeoutMs ?? 300000), cacheDir: typeof v.cacheDir === 'string' && v.cacheDir.trim() ? v.cacheDir.trim() : 'verifier', cacheMaxEntries: Number(v.cacheMaxEntries ?? 10000), estimatedInputUsdPerMillion: Number(v.estimatedInputUsdPerMillion ?? 0), estimatedOutputUsdPerMillion: Number(v.estimatedOutputUsdPerMillion ?? 0), autoVerifySubagents: v.autoVerifySubagents === true, extraJudges: normalizeExtraJudges(v.extraJudges) }; }
function message(error) { return error instanceof Error ? error.message : String(error); }
/** The endpoint answered but rejected the request: a transport fallback would only repeat it. */
class EndpointError extends Error {
}
function Label({ title, help }) { return _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }, children: title }), _jsx("div", { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }, children: help })] }); }
function GroupTitle({ children }) { return _jsx("h3", { style: groupTitle, children: children }); }
function startOfRange(days) { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days + 1); return date.getTime(); }
function endOfToday() { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 1); return date.getTime(); }
export function VerifierSettings({ remote }) {
    const lang = useLanguage();
    const t = dictionaries[lang];
    const [loaded, setLoaded] = useState(null);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [editing, setEditing] = useState({});
    const load = async () => { setError(null); try {
        const [m, s] = await Promise.all([remote.session.modelCatalog(), remote.settings.describe()]);
        if (!m.ok)
            throw new Error(m.error.message);
        if (!s.ok)
            throw new Error(s.error.message);
        const view = s.value.namespaces.find((x) => x.ns === NS);
        if (!view)
            throw new Error(t['settings.nsUnregistered']);
        const next = { groups: m.value.groups, settings: view, writable: s.value.writable, failures: m.value.failures.map((f) => (f.id ?? f.provider ?? f.name ?? 'unknown') + ': ' + f.message) };
        setLoaded(next);
        setDraft(values(view));
        setEditing({});
    }
    catch (e) {
        setError(message(e));
    } };
    useEffect(() => { void load(); }, []);
    const models = useMemo(() => loaded?.groups.find(g => g.id === draft?.provider)?.models ?? [], [loaded, draft?.provider]);
    const selected = models.find(m => m.id === draft?.model);
    const efforts = selected?.reasoning?.efforts ?? [];
    const patch = (key, value) => { setSaved(false); setDraft(v => v ? { ...v, [key]: value } : v); };
    const conflict = useMemo(() => (draft ? judgeConflict({ provider: draft.provider, model: draft.model }, draft.extraJudges) : undefined), [draft?.provider, draft?.model, draft?.extraJudges]);
    const addJudge = () => {
        if (!loaded || !draft || draft.extraJudges.length >= MAX_EXTRA_JUDGES)
            return;
        const firstGroup = loaded.groups[0];
        const firstProvider = firstGroup?.id ?? '';
        const firstModelObj = firstGroup?.models[0];
        const firstModel = firstModelObj?.id ?? '';
        const defaultEffort = firstModelObj?.reasoning?.defaultEffort;
        const newJudge = {
            provider: firstProvider,
            model: firstModel,
            ...(defaultEffort ? { reasoningEffort: defaultEffort } : {}),
        };
        patch('extraJudges', addExtraJudge(draft.extraJudges, newJudge));
    };
    const removeJudge = (idx) => {
        if (!draft)
            return;
        patch('extraJudges', removeExtraJudge(draft.extraJudges, idx));
    };
    const updateJudge = (idx, updates) => {
        if (!draft)
            return;
        const next = draft.extraJudges.map((j, i) => (i === idx ? { ...j, ...updates } : j));
        patch('extraJudges', next);
    };
    const budgetWarning = useMemo(() => {
        if (!draft)
            return null;
        return evaluateBudgetWarning(draft.autoVerifyMode, draft.extraJudges.length, draft.autoMaxModelCallsPerTask, draft.autoMaxModelCallsPerSession);
    }, [draft?.autoVerifyMode, draft?.extraJudges.length, draft?.autoMaxModelCallsPerTask, draft?.autoMaxModelCallsPerSession]);
    const save = async () => { if (!loaded || !draft || conflict)
        return; setBusy(true); setSaved(false); setError(null); try {
        const section = { ...record(loaded.settings.user), ...draft, extraJudges: serializeExtraJudges(draft.extraJudges) };
        if (!draft.reasoningEffort)
            delete section.reasoningEffort;
        if (!draft.label || !draft.label.trim())
            delete section.label;
        else
            section.label = draft.label.trim();
        const resolvedCacheDir = resolveCacheDirOnSave(draft.cacheDir, values(loaded.settings).cacheDir);
        if (!resolvedCacheDir)
            delete section.cacheDir;
        else
            section.cacheDir = resolvedCacheDir;
        const res = await remote.settings.update(NS, section, loaded.settings.revision);
        if (!res.ok)
            throw new Error(res.error.message);
        setLoaded(v => v ? { ...v, settings: res.value } : v);
        setDraft(values(res.value));
        setEditing({});
        setSaved(true);
    }
    catch (e) {
        setError(message(e));
    }
    finally {
        setBusy(false);
    } };
    if (!loaded || !draft)
        return _jsxs("div", { style: shell, children: [_jsx("h2", { style: settingsHeading, children: t['settings.title'] }), _jsx("p", { style: settingsIntro, children: error ?? t['settings.loading'] }), error && _jsx("div", { children: _jsx(Button, { variant: "outline", onClick: () => void load(), children: t['settings.retry'] }) })] });
    // Fractional settings are typed character by character, so the raw text is
    // kept while the field has focus: a controlled type="number" input rewrites
    // "0." back to "0" and swallows the decimal point. The parsed value is
    // committed on every keystroke that parses, and blur restores canonical text.
    const numeric = (key, min = 0) => _jsx(Input, { style: { width: '100%', height: 36, borderRadius: 8 }, type: "text", inputMode: "decimal", disabled: busy, "aria-label": t[('field.' + key + '.title')] ?? String(key), value: editing[key] ?? String(draft[key] ?? ''), onChange: e => { const raw = e.target.value; setEditing(current => current[key] === raw ? current : { ...current, [key]: raw }); const parsed = Number(raw); if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min)
            patch(key, parsed); }, onBlur: () => setEditing(current => { if (!(key in current))
            return current; const next = { ...current }; delete next[key]; return next; }) });
    const textField = (key, placeholder) => _jsx(Input, { style: { width: '100%', height: 36, borderRadius: 8 }, type: "text", disabled: busy, placeholder: placeholder, "aria-label": t[('field.' + key + '.title')] ?? String(key), value: String(draft[key] ?? ''), onChange: e => patch(key, e.target.value) });
    return _jsxs("div", { style: shell, children: [_jsx("h2", { style: settingsHeading, children: t['settings.title'] }), _jsx("p", { style: settingsIntro, children: t['settings.intro'] }), _jsxs("section", { style: group, children: [_jsx(GroupTitle, { children: t['section.tools'] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.enabled.title'], help: draft.enabled ? t['field.enabled.helpOn'] : t['field.enabled.helpOff'] }), _jsx("button", { type: "button", role: "switch", "aria-checked": draft.enabled, "aria-label": t['field.enabled.title'], onClick: () => patch('enabled', !draft.enabled), style: toggleStyle(draft.enabled), children: _jsx("span", { style: toggleThumbStyle(draft.enabled) }) })] }), !draft.enabled && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: t['field.enabled.warnDisabled'] })] }), _jsxs("section", { style: group, children: [_jsx(GroupTitle, { children: t['section.autoVerify'] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyMode.title'], help: t['field.autoVerifyMode.help'] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": t['field.autoVerifyMode.title'], value: draft.autoVerifyMode, onChange: e => patch('autoVerifyMode', e.target.value), children: [_jsx("option", { value: "manual", children: t['field.autoVerifyMode.manual'] }), _jsx("option", { value: "smart", children: t['field.autoVerifyMode.smart'] }), _jsx("option", { value: "strict", children: t['field.autoVerifyMode.strict'] })] })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteSemantic.title'], help: t['field.autoRouteSemantic.help'] }), _jsx("button", { type: "button", role: "switch", "aria-checked": draft.autoRouteSemantic, "aria-label": t['field.autoRouteSemantic.title'], onClick: () => patch('autoRouteSemantic', !draft.autoRouteSemantic), style: toggleStyle(draft.autoRouteSemantic), children: _jsx("span", { style: toggleThumbStyle(draft.autoRouteSemantic) }) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyTeamTasks.title'], help: t['field.autoVerifyTeamTasks.help'] }), _jsx("button", { type: "button", role: "switch", "aria-checked": draft.autoVerifyTeamTasks, "aria-label": t['field.autoVerifyTeamTasks.title'], onClick: () => patch('autoVerifyTeamTasks', !(draft.autoVerifyTeamTasks)), style: toggleStyle(draft.autoVerifyTeamTasks), children: _jsx("span", { style: toggleThumbStyle(draft.autoVerifyTeamTasks) }) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifySubagents.title'], help: t['field.autoVerifySubagents.help'] }), _jsx("button", { type: "button", role: "switch", "aria-checked": draft.autoVerifySubagents, "aria-label": t['field.autoVerifySubagents.title'], onClick: () => patch('autoVerifySubagents', !draft.autoVerifySubagents), style: toggleStyle(draft.autoVerifySubagents), children: _jsx("span", { style: toggleThumbStyle(draft.autoVerifySubagents) }) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyPlanMode.title'], help: t['field.autoVerifyPlanMode.help'] }), _jsx("button", { type: "button", role: "switch", "aria-checked": draft.autoVerifyPlanMode, "aria-label": t['field.autoVerifyPlanMode.title'], onClick: () => patch('autoVerifyPlanMode', !(draft.autoVerifyPlanMode)), style: toggleStyle(draft.autoVerifyPlanMode), children: _jsx("span", { style: toggleThumbStyle(draft.autoVerifyPlanMode) }) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMinConfidence.title'], help: t['field.autoRouteMinConfidence.help'] }), numeric('autoRouteMinConfidence', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMaxCandidates.title'], help: t['field.autoRouteMaxCandidates.help'] }), numeric('autoRouteMaxCandidates', 3)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMaxPerTask.title'], help: t['field.autoRouteMaxPerTask.help'] }), numeric('autoRouteMaxPerTask', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMaxPerSession.title'], help: t['field.autoRouteMaxPerSession.help'] }), numeric('autoRouteMaxPerSession', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoTrackCompletionThreshold.title'], help: t['field.autoTrackCompletionThreshold.help'] }), numeric('autoTrackCompletionThreshold', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMaxItemChars.title'], help: t['field.autoRouteMaxItemChars.help'] }), numeric('autoRouteMaxItemChars', 100)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoRouteMaxInputChars.title'], help: t['field.autoRouteMaxInputChars.help'] }), numeric('autoRouteMaxInputChars', 1000)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoMaxModelCallsPerTask.title'], help: t['field.autoMaxModelCallsPerTask.help'] }), numeric('autoMaxModelCallsPerTask', 1)] }), budgetWarning?.warnTask && _jsx("p", { style: { margin: '-4px 0 10px', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: tFormat(t['field.autoMaxModelCallsPerTask.warnBudget'], { current: draft.autoMaxModelCallsPerTask, required: budgetWarning.worstCaseTask, judges: budgetWarning.judgeCount }) }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoMaxModelCallsPerSession.title'], help: t['field.autoMaxModelCallsPerSession.help'] }), numeric('autoMaxModelCallsPerSession', 1)] }), budgetWarning?.warnSession && _jsx("p", { style: { margin: '-4px 0 10px', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: tFormat(t['field.autoMaxModelCallsPerSession.warnBudget'], { current: draft.autoMaxModelCallsPerSession, required: budgetWarning.worstCaseSession, judges: budgetWarning.judgeCount }) }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyThreshold.title'], help: t['field.autoVerifyThreshold.help'] }), numeric('autoVerifyThreshold', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyRepeats.title'], help: t['field.autoVerifyRepeats.help'] }), numeric('autoVerifyRepeats', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyFinalRepeats.title'], help: t['field.autoVerifyFinalRepeats.help'] }), numeric('autoVerifyFinalRepeats', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyMinToolCalls.title'], help: t['field.autoVerifyMinToolCalls.help'] }), numeric('autoVerifyMinToolCalls', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyMaxChars.title'], help: t['field.autoVerifyMaxChars.help'] }), numeric('autoVerifyMaxChars', 1000)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyMaxPerTask.title'], help: t['field.autoVerifyMaxPerTask.help'] }), numeric('autoVerifyMaxPerTask', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.autoVerifyMaxPerSession.title'], help: t['field.autoVerifyMaxPerSession.help'] }), numeric('autoVerifyMaxPerSession', 1)] }), draft.autoVerifyMode !== 'manual' && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: t['field.autoVerify.warnNotice'] })] }), _jsxs("section", { style: group, children: [_jsx(GroupTitle, { children: t['section.model'] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.provider.title'], help: t['field.provider.help'] }), _jsx("select", { style: selectStyle, disabled: busy, "aria-label": t['field.provider.title'], value: draft.provider, onChange: e => { const provider = e.target.value; const first = loaded.groups.find(g => g.id === provider)?.models[0]; setDraft({ ...draft, provider, ...(first ? { model: first.id, reasoningEffort: first.reasoning?.defaultEffort } : {}) }); }, children: loaded.groups.map(g => _jsxs("option", { value: g.id, children: [g.name, " \u00B7 ", g.id] }, g.id)) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.model.title'], help: t['field.model.help'] }), _jsx("select", { style: selectStyle, disabled: busy, "aria-label": t['field.model.title'], value: draft.model, onChange: e => { const model = e.target.value; const found = models.find(m => m.id === model); setDraft({ ...draft, model, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) }); }, children: models.map(m => _jsxs("option", { value: m.id, children: [m.name, " \u00B7 ", m.id] }, m.id)) })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.reasoningEffort.title'], help: t['field.reasoningEffort.help'] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": t['field.reasoningEffort.title'], value: draft.reasoningEffort ?? '', onChange: e => patch('reasoningEffort', e.target.value || undefined), children: [_jsx("option", { value: "", children: t['field.reasoningEffort.default'] }), efforts.map(e => _jsx("option", { value: e.id, children: e.name }, e.id))] })] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.maxTokens.title'], help: t['field.maxTokens.help'] }), numeric('maxTokens', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.temperature.title'], help: t['field.temperature.help'] }), numeric('temperature', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.label.title'], help: t['field.label.help'] }), _jsx(Input, { style: { width: '100%', height: 36, borderRadius: 8 }, type: "text", disabled: busy, placeholder: draft.model || t['field.label.placeholder'], "aria-label": t['field.label.title'], value: draft.label ?? '', onChange: e => patch('label', e.target.value || undefined) })] }), _jsxs("div", { style: { ...row, gridTemplateColumns: 'minmax(180px, 1fr) auto', minHeight: 48 }, children: [_jsx(Label, { title: t['field.extraJudges.title'], help: t['field.extraJudges.help'] }), _jsx(Button, { variant: "outline", disabled: busy || draft.extraJudges.length >= MAX_EXTRA_JUDGES, onClick: addJudge, children: t['field.extraJudges.add'] })] }), draft.extraJudges.length > 0 && _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', paddingBottom: 2 }, children: [_jsx("div", { children: t['field.provider.title'] }), _jsx("div", { children: t['field.model.title'] }), _jsx("div", { children: t['field.reasoningEffort.title'] }), _jsx("div", { children: t['field.extraJudges.labelTitle'] }), _jsx("div", {})] }), draft.extraJudges.map((judge, idx) => {
                                const judgeGroup = loaded.groups.find(g => g.id === judge.provider);
                                const judgeModels = judgeGroup?.models ?? [];
                                const judgeModel = judgeModels.find(m => m.id === judge.model);
                                const judgeEfforts = judgeModel?.reasoning?.efforts ?? [];
                                return _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto', gap: 8, alignItems: 'center' }, children: [_jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.providerAria'], { index: idx + 1 }), value: judge.provider, onChange: e => {
                                                const newProvider = e.target.value;
                                                const targetGroup = loaded.groups.find(g => g.id === newProvider);
                                                const firstM = targetGroup?.models[0];
                                                updateJudge(idx, {
                                                    provider: newProvider,
                                                    model: firstM?.id ?? '',
                                                    ...(firstM?.reasoning?.defaultEffort ? { reasoningEffort: firstM.reasoning.defaultEffort } : { reasoningEffort: undefined }),
                                                });
                                            }, children: [!loaded.groups.some(g => g.id === judge.provider) && judge.provider && _jsx("option", { value: judge.provider, children: judge.provider }), loaded.groups.map(g => _jsxs("option", { value: g.id, children: [g.name, " \u00B7 ", g.id] }, g.id))] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.modelAria'], { index: idx + 1 }), value: judge.model, onChange: e => {
                                                const newModel = e.target.value;
                                                const found = judgeModels.find(m => m.id === newModel);
                                                updateJudge(idx, {
                                                    model: newModel,
                                                    ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }),
                                                });
                                            }, children: [!judgeModels.some(m => m.id === judge.model) && judge.model && _jsx("option", { value: judge.model, children: judge.model }), judgeModels.map(m => _jsxs("option", { value: m.id, children: [m.name, " \u00B7 ", m.id] }, m.id))] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.effortAria'], { index: idx + 1 }), value: judge.reasoningEffort ?? '', onChange: e => updateJudge(idx, { reasoningEffort: e.target.value || undefined }), children: [_jsx("option", { value: "", children: t['field.reasoningEffort.default'] }), judgeEfforts.map(ef => _jsx("option", { value: ef.id, children: ef.name }, ef.id))] }), _jsx(Input, { style: { width: '100%', height: 36, borderRadius: 8 }, type: "text", disabled: busy, placeholder: t['field.extraJudges.labelPlaceholder'], "aria-label": tFormat(t['field.extraJudges.labelAria'], { index: idx + 1 }), value: judge.label ?? '', onChange: e => updateJudge(idx, { label: e.target.value }) }), _jsx(Button, { variant: "outline", disabled: busy, "aria-label": tFormat(t['field.extraJudges.removeAria'], { index: idx + 1 }), onClick: () => removeJudge(idx), children: t['field.extraJudges.remove'] })] }, idx);
                            })] }), conflict && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: conflict.duplicateOf === 'primary' ? tFormat(t['field.extraJudges.conflictPrimary'], { index: conflict.index + 1, id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? '', draft.extraJudges[conflict.index]?.model ?? '') }) : tFormat(t['field.extraJudges.conflictDuplicate'], { index: conflict.index + 1, other: conflict.duplicateOf + 1, id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? '', draft.extraJudges[conflict.index]?.model ?? '') }) })] }), _jsxs("section", { style: group, children: [_jsx(GroupTitle, { children: t['section.execution'] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.maxConcurrency.title'], help: t['field.maxConcurrency.help'] }), numeric('maxConcurrency', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.maxRetries.title'], help: t['field.maxRetries.help'] }), numeric('maxRetries', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.retryBaseDelayMs.title'], help: t['field.retryBaseDelayMs.help'] }), numeric('retryBaseDelayMs', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.timeoutMs.title'], help: t['field.timeoutMs.help'] }), numeric('timeoutMs', 1)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.cacheDir.title'], help: t['field.cacheDir.help'] }), textField('cacheDir', 'verifier')] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.cacheMaxEntries.title'], help: t['field.cacheMaxEntries.help'] }), numeric('cacheMaxEntries', 1)] })] }), _jsxs("section", { style: group, children: [_jsx(GroupTitle, { children: t['section.cost'] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.estimatedInputUsdPerMillion.title'], help: t['field.estimatedInputUsdPerMillion.help'] }), numeric('estimatedInputUsdPerMillion', 0)] }), _jsxs("div", { style: row, children: [_jsx(Label, { title: t['field.estimatedOutputUsdPerMillion.title'], help: t['field.estimatedOutputUsdPerMillion.help'] }), numeric('estimatedOutputUsdPerMillion', 0)] })] }), loaded.failures.length > 0 && _jsxs("div", { style: { padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-state-warn-bg)', color: 'var(--dsw-alias-state-warn-label)', fontSize: 12, lineHeight: '18px' }, children: [_jsx("div", { style: { fontWeight: 500, marginBottom: 3 }, children: t['settings.catalogFailures'] }), loaded.failures.map(x => _jsx("div", { children: x }, x))] }), error && _jsx("p", { style: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' }, children: error }), saved && _jsx("p", { style: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary)' }, children: t['settings.saved'] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }, children: [_jsx(Button, { variant: "outline", disabled: busy, onClick: () => void load(), children: t['settings.reload'] }), _jsx(Button, { variant: "primary", disabled: busy || !loaded.writable || Boolean(conflict), onClick: () => void save(), children: busy ? t['settings.saving'] : t['settings.save'] })] })] });
}
function Metric({ label, value, note, accent }) {
    return _jsxs("div", { style: { ...dashboardCard, padding: '16px 18px', minWidth: 0 }, children: [_jsx("div", { style: muted, children: label }), _jsx("div", { style: { fontSize: 25, fontWeight: 750, lineHeight: 1.2, margin: '7px 0 5px', color: accent }, children: value }), _jsx("div", { style: { ...muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: note })] });
}
function TrendChart({ daily, days, lang }) {
    const t = dictionaries[lang];
    const rows = useMemo(() => { const map = new Map(daily.map(row => [row.date, row])); const values = []; const start = new Date(startOfRange(days)); for (let i = 0; i < days; i += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
        values.push(map.get(key) ?? { date: key, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} });
    } return values; }, [daily, days]);
    const width = 760, height = 230, pad = { l: 44, r: 24, t: 20, b: 38 };
    const innerW = width - pad.l - pad.r, innerH = height - pad.t - pad.b;
    const max = Math.max(1, ...rows.flatMap(row => [row.invocations, row.calls]));
    const x = (index) => pad.l + (rows.length <= 1 ? innerW / 2 : index * innerW / (rows.length - 1));
    const y = (value) => pad.t + innerH - value / max * innerH;
    const points = rows.map((row, index) => `${x(index)},${y(row.calls)}`).join(' ');
    const step = rows.length > 16 ? Math.ceil(rows.length / 7) : Math.max(1, Math.ceil(rows.length / 7));
    const barWidth = Math.max(3, Math.min(18, innerW / Math.max(rows.length, 1) * .55));
    return _jsxs("div", { style: { width: '100%', overflowX: 'auto' }, children: [_jsxs("svg", { viewBox: `0 0 ${width} ${height}`, style: { display: 'block', width: '100%', minWidth: 620, height: 'auto' }, "aria-label": t['chart.ariaLabel'], children: [[0, .25, .5, .75, 1].map(ratio => _jsxs("g", { children: [_jsx("line", { x1: pad.l, x2: width - pad.r, y1: pad.t + innerH * ratio, y2: pad.t + innerH * ratio, stroke: "rgba(148,163,184,.16)" }), _jsx("text", { x: pad.l - 8, y: pad.t + innerH * ratio + 4, textAnchor: "end", fontSize: "10", fill: "var(--dsw-text-secondary)", children: Math.round(max * (1 - ratio)) })] }, ratio)), rows.map((row, index) => _jsx("rect", { x: x(index) - barWidth / 2, y: y(row.invocations), width: barWidth, height: pad.t + innerH - y(row.invocations), rx: "2", fill: "#4f8cff", opacity: ".82" }, row.date)), _jsx("polyline", { points: points, fill: "none", stroke: "#5ed7e8", strokeWidth: "2.4", strokeLinejoin: "round", strokeLinecap: "round" }), rows.map((row, index) => index % step === 0 || index === rows.length - 1 ? _jsxs("text", { x: x(index), y: height - 14, textAnchor: "middle", fontSize: "10", fill: "var(--dsw-text-secondary)", children: [Number(row.date.slice(5, 7)), "/", Number(row.date.slice(8, 10))] }, row.date) : null)] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'center', gap: 18, ...muted }, children: [_jsxs("span", { children: [_jsx("i", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#4f8cff', marginRight: 6 } }), t['chart.legendToolCalls']] }), _jsxs("span", { children: [_jsx("i", { style: { display: 'inline-block', width: 14, height: 2, background: '#5ed7e8', marginRight: 6, verticalAlign: 'middle' } }), t['chart.legendModelCalls']] })] })] });
}
export function StatisticsPage({ sessionId, rpc, isGlobal }) {
    const lang = useLanguage();
    const t = dictionaries[lang];
    const labels = toolLabels[lang];
    const [days, setDays] = useState(30);
    const [sessionOnly, setSessionOnly] = useState(!isGlobal && Boolean(sessionId));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refresh, setRefresh] = useState(0);
    // Data belongs to the range/session that produced it: keeping the previous
    // range's numbers under an error banner reads as if they were current.
    const queryKey = days + '|' + sessionOnly + '|' + String(sessionId ?? '');
    const lastQueryKey = useRef(undefined);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        if (lastQueryKey.current !== undefined && lastQueryKey.current !== queryKey)
            setData(null);
        lastQueryKey.current = queryKey;
        const effectiveSessionId = sessionOnly && sessionId ? String(sessionId) : undefined;
        const queryPayload = {
            fromMs: startOfRange(days),
            toMs: endOfToday(),
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            recentLimit: 50,
            ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
        };
        const fetchOverview = async () => {
            if (rpc && typeof rpc.call === 'function') {
                try {
                    const result = await rpc.call('/api', 'llm-verifier/statistics', queryPayload, controller.signal);
                    if (result && result.ok) {
                        return result.value;
                    }
                    if (result && result.ok === false) {
                        throw new EndpointError(result.error?.message ?? t['stats.requestFailed']);
                    }
                }
                catch (rpcError) {
                    if (controller.signal.aborted)
                        throw rpcError;
                    // A business rejection is the host's real answer; retrying it over the
                    // raw fetch endpoint would only duplicate the request and hide it.
                    if (rpcError instanceof EndpointError)
                        throw rpcError;
                    console.warn('[llm-verifier] rpc.call failed, trying fetch fallback:', rpcError);
                }
            }
            try {
                const response = await fetch('/api/llm-verifier/statistics', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(queryPayload),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText || t['stats.requestFailed']}`);
                }
                const data = await response.json();
                if (data && data.ok === true) {
                    return data.value;
                }
                if (data && data.type === 'server-response' && data.result?.ok === true) {
                    return data.result.value;
                }
                throw new EndpointError(data?.error?.message ?? data?.result?.error?.message ?? t['stats.requestFailed']);
            }
            catch (fetchError) {
                if (controller.signal.aborted)
                    throw fetchError;
                if (fetchError instanceof EndpointError)
                    throw fetchError;
                // Hosts without the exact Fetch route registry only answer on the plugin's own channel.
                if (rpc && typeof rpc.call === 'function') {
                    const legacy = await rpc.call('/llm-verifier', 'statistics', queryPayload, controller.signal);
                    if (legacy && legacy.ok)
                        return legacy.value;
                }
                throw fetchError;
            }
        };
        void fetchOverview()
            .then(overview => {
            if (!controller.signal.aborted)
                setData(overview);
        })
            .catch((cause) => {
            if (!controller.signal.aborted)
                setError(message(cause));
        })
            .finally(() => {
            if (!controller.signal.aborted)
                setLoading(false);
        });
        return () => controller.abort();
    }, [days, sessionOnly, sessionId, refresh, rpc, t, queryKey]);
    const totals = data?.totals;
    return _jsx("main", { style: { height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '22px clamp(16px, 3vw, 38px) 48px', color: 'var(--dsw-text-primary)', background: 'radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)' }, children: _jsxs("div", { style: { maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }, children: [_jsxs("header", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("span", { style: { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(79,140,255,.14)', color: '#6da0ff' }, children: _jsx(IconDataOutline16, { size: 18 }) }), _jsx("h2", { style: { margin: 0, fontSize: 23 }, children: isGlobal ? t['global.panelTitle'] : t['stats.pageTitle'] })] }), _jsx("p", { style: { margin: '7px 0 0 44px', ...muted }, children: isGlobal ? t['global.panelIntro'] : tFormat(t['stats.updatedAt'], { time: data ? dateTime(data.generatedAt, lang) : '--' }) })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("div", { style: { display: 'flex', padding: 3, borderRadius: 10, background: 'var(--dsw-surface-sunken)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))' }, children: [7, 30, 90].map(value => _jsx("button", { "aria-pressed": days === value, onClick: () => setDays(value), style: { border: 0, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: days === value ? '#fff' : 'var(--dsw-text-secondary)', background: days === value ? '#3f68d8' : 'transparent' }, children: tFormat(t['stats.daysUnit'], { days: value }) }, value)) }), Boolean(sessionId) && _jsx("button", { "aria-pressed": sessionOnly, onClick: () => setSessionOnly(value => !value), style: { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-text-primary)', background: sessionOnly ? 'rgba(79,140,255,.18)' : 'var(--dsw-surface-sunken)' }, children: sessionOnly ? t['stats.currentSession'] : t['stats.allSessions'] }), _jsx("button", { title: t['stats.refresh'], onClick: () => setRefresh(value => value + 1), style: { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)', cursor: 'pointer' }, children: _jsx(IconRefreshOutline16, { size: 16 }) })] })] }), error && _jsxs("div", { style: { ...dashboardCard, padding: 18, borderColor: 'var(--dsw-danger, #e85858)', color: 'var(--dsw-danger, #e85858)' }, children: [error, _jsx("div", { style: { ...muted, marginTop: 6 }, children: t['stats.hostRestartHint'] })] }), loading && !data ? _jsx("div", { style: { ...dashboardCard, padding: 32, textAlign: 'center', ...muted }, children: t['stats.loading'] }) : _jsxs(_Fragment, { children: [_jsxs("section", { style: { ...dashboardCard, padding: '22px 24px', display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(240px,1fr)', gap: 24, alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: tFormat(t['stats.costSummary'], { days }) }), _jsx("div", { style: { fontSize: 38, fontWeight: 780, letterSpacing: '-.03em', margin: '5px 0' }, children: money(totals?.estimatedCostUsd ?? 0) }), _jsx("div", { style: muted, children: tFormat(t['stats.callsSummary'], { invocations: compact(totals?.invocations ?? 0, lang), calls: compact(totals?.calls ?? 0, lang) }) })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 16px', fontSize: 13 }, children: [_jsx("span", { style: muted, children: t['stats.successCalls'] }), _jsxs("strong", { children: [compact(totals?.successes ?? 0, lang), " ", _jsxs("small", { style: { color: '#77d49b' }, children: ["\u25B2 ", ((totals?.successRate ?? 0) * 100).toFixed(1), "%"] })] }), _jsx("span", { style: muted, children: t['stats.failedCalls'] }), _jsx("strong", { children: compact(totals?.failures ?? 0, lang) }), _jsx("span", { style: muted, children: t['stats.avgDuration'] }), _jsx("strong", { children: duration(totals?.averageDurationMs ?? 0) })] })] }), _jsxs("section", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }, children: [_jsx(Metric, { label: t['metric.cacheHitRate'], value: ((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + '%', note: tFormat(t['metric.cacheHitNote'], { hits: compact(totals?.cacheHits ?? 0, lang), total: compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0), lang) }), accent: "#b7dd64" }), _jsx(Metric, { label: t['metric.tokens'], value: compact(totals?.tokens ?? 0, lang), note: tFormat(t['metric.tokensNote'], { input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang), output: compact(totals?.outputTokens ?? 0, lang) }) }), _jsx(Metric, { label: t['metric.avgModelCalls'], value: (totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : '0', note: tFormat(t['metric.avgModelCallsNote'], { attempts: compact(totals?.attempts ?? 0, lang), retries: compact(totals?.retries ?? 0, lang) }) }), _jsx(Metric, { label: t['metric.scoringMode'], value: compact(totals?.topLogprobScores ?? 0, lang), note: tFormat(t['metric.scoringModeNote'], { explicit: compact(totals?.explicitTagScores ?? 0, lang) }) })] }), _jsxs("section", { style: { ...dashboardCard, padding: '18px 20px 16px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }, children: [_jsx("strong", { children: t['chart.title'] }), _jsx("span", { style: muted, children: sessionOnly ? t['stats.currentSession'] : t['stats.allSessions'] })] }), _jsx(TrendChart, { daily: data?.daily ?? [], days: days, lang: lang })] }), _jsxs("section", { style: { ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }, children: [_jsx("strong", { children: t['table.title'] }), _jsx("span", { style: muted, children: tFormat(t['table.toolCount'], { count: (data?.tools ?? []).length }) })] }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }, children: [_jsx("thead", { children: _jsx("tr", { style: { textAlign: 'left', color: 'var(--dsw-text-secondary)', background: 'var(--dsw-surface-sunken)' }, children: [t['table.colTool'], t['table.colInvocations'], t['table.colSuccessRate'], t['table.colAvgDuration'], t['table.colModelCalls'], t['table.colTokens'], t['table.colCacheHits'], t['table.colEstimatedCost']].map(value => _jsx("th", { style: { padding: '10px 12px', fontWeight: 500 }, children: value }, value)) }) }), _jsxs("tbody", { children: [(data?.tools ?? []).map(tool => _jsxs("tr", { style: { borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }, children: [_jsxs("td", { style: { padding: '13px 12px' }, children: [_jsx("span", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toolColors[tool.toolName] ?? '#8691a8', marginRight: 8 } }), _jsx("strong", { children: labels[tool.toolName] ?? tool.toolName }), _jsx("div", { style: { ...muted, margin: '3px 0 0 16px' }, children: tool.toolName })] }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.invocations, lang) }), _jsxs("td", { style: { padding: '13px 12px', color: tool.successRate >= .9 ? '#77d49b' : tool.successRate >= .7 ? '#e3bd63' : '#ed7777' }, children: [(tool.successRate * 100).toFixed(1), "%"] }), _jsx("td", { style: { padding: '13px 12px' }, children: duration(tool.averageDurationMs) }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.calls, lang) }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.tokens, lang) }), _jsxs("td", { style: { padding: '13px 12px' }, children: [tool.cacheHits, "/", tool.cacheHits + tool.cacheMisses] }), _jsx("td", { style: { padding: '13px 12px' }, children: money(tool.estimatedCostUsd) })] }, tool.toolName)), (data?.tools.length ?? 0) === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 8, style: { padding: 28, textAlign: 'center', ...muted }, children: t['table.empty'] }) })] })] }) })] }), _jsxs("section", { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(290px,.45fr)', gap: 16, alignItems: 'start' }, children: [_jsxs("div", { style: { ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }, children: [_jsx("strong", { children: t['recent.title'] }), _jsx("span", { style: muted, children: t['recent.maxCount'] })] }), _jsxs("div", { style: { maxHeight: 360, overflow: 'auto' }, children: [(data?.recent ?? []).map(item => {
                                                    const verdictInfo = item.verdict ? formatVerdictDetails(item.verdict, t) : undefined;
                                                    const failed = !item.success || (verdictInfo ? verdictInfo.isFailed : false);
                                                    return _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) auto', gap: 12, padding: '11px 8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { width: 7, height: 7, borderRadius: '50%', background: failed ? '#e76565' : '#59c985' } }), _jsx("strong", { style: { fontSize: 13 }, children: labels[item.toolName] ?? item.toolName }), _jsxs("span", { style: muted, children: [item.provider, "/", item.model] })] }), !item.success && _jsx("div", { title: item.errorMessage, style: { margin: '5px 0 0 15px', fontSize: 11, color: '#e76565', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: item.errorMessage ?? item.errorName }), item.verdict && verdictInfo && _jsxs("div", { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 0 0 15px', fontSize: 11 }, children: [verdictInfo.outcomeText && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, fontWeight: 500, fontSize: 11, background: verdictInfo.isFailed ? 'rgba(231,101,101,.16)' : item.verdict.outcome === 'tie' ? 'rgba(227,189,99,.16)' : 'rgba(89,201,133,.16)', color: verdictInfo.isFailed ? '#e76565' : item.verdict.outcome === 'tie' ? '#e3bd63' : '#77d49b', border: `1px solid ${verdictInfo.isFailed ? 'rgba(231,101,101,.3)' : item.verdict.outcome === 'tie' ? 'rgba(227,189,99,.3)' : 'rgba(89,201,133,.3)'}` }, children: verdictInfo.outcomeText }), verdictInfo.phaseText && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-surface-sunken)', color: 'var(--dsw-text-secondary)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }, children: verdictInfo.phaseText }), verdictInfo.scoreText && _jsx("span", { style: { color: (typeof item.verdict.threshold === 'number' && typeof item.verdict.score === 'number' && item.verdict.score < item.verdict.threshold) ? '#e76565' : 'var(--dsw-text-primary)' }, children: verdictInfo.scoreText }), verdictInfo.winnerText && _jsx("span", { style: { color: 'var(--dsw-text-secondary)' }, children: verdictInfo.winnerText })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: 12 }, children: duration(item.durationMs) }), _jsx("div", { style: { ...muted, marginTop: 3 }, children: dateTime(item.startedAt, lang) })] })] }, item.id);
                                                }), (data?.recent.length ?? 0) === 0 && _jsx("div", { style: { padding: 24, textAlign: 'center', ...muted }, children: t['recent.empty'] })] })] }), _jsxs("div", { style: { ...dashboardCard, padding: '18px' }, children: [_jsx("strong", { children: t['models.title'] }), _jsxs("div", { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }, children: [(data?.models ?? []).map(model => _jsxs("div", { style: { padding: '11px 12px', borderRadius: 10, background: 'var(--dsw-surface-sunken)' }, children: [_jsx("div", { style: { fontWeight: 650, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }, children: model.model }), _jsx("div", { style: { ...muted, marginTop: 3 }, children: model.provider }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 12 }, children: [_jsx("span", { children: tFormat(t['models.calls'], { calls: compact(model.calls, lang) }) }), _jsx("span", { children: tFormat(t['models.tokens'], { tokens: compact(model.tokens, lang) }) }), _jsx("strong", { children: money(model.estimatedCostUsd) })] })] }, model.provider + '\0' + model.model)), (data?.models.length ?? 0) === 0 && _jsx("div", { style: muted, children: t['models.empty'] })] })] })] })] })] }) });
}
export function VerifierSidebarIcon({ size, active }) {
    return _jsx("span", { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, color: active ? 'var(--dsw-alias-brand-primary, #4f8cff)' : 'currentColor' }, children: _jsx(IconDataOutline16, { size: Math.min(18, size) }) });
}
export function GlobalVerifierDashboard({ rpc }) {
    return _jsx(StatisticsPage, { rpc: rpc, isGlobal: true });
}
export function RightSidebarVerifierPanel({ rpc, sessionId }) {
    return (_jsx("div", { style: { height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }, children: _jsx(StatisticsPage, { rpc: rpc, sessionId: sessionId }) }));
}
export function RightSidebarVerifierTitle() {
    const lang = useLanguage();
    const t = dictionaries[lang];
    return _jsx("span", { style: { fontSize: 13, fontWeight: 500 }, children: t['slot.statistics'] });
}
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'remote.settings'];
export function apply(ctx) {
    const connection = ctx.get('connection');
    const remote = ctx.remote;
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'llm-verifier',
        order: 35,
        label: 'LLM Verifier',
        inject: () => ({ remote }),
    }, VerifierSettings));
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'llm-verifier-statistics',
        order: 30,
        label: () => (detectLanguage() === 'zh' ? zh['slot.statistics'] : en['slot.statistics']),
        inject: () => ({ rpc: connection.rpc }),
    }, StatisticsPage));
    const VERIFIER_TAB_KIND = 'llm-verifier';
    const VERIFIER_TAB_ID = 'dsh-llm-verifier';
    const registerRightSidebar = (tabs) => {
        if (!tabs || typeof tabs.register !== 'function')
            return undefined;
        try {
            const disposer = tabs.register({
                id: VERIFIER_TAB_ID,
                kind: VERIFIER_TAB_KIND,
                priority: 'extension',
                title: () => (detectLanguage() === 'zh' ? zh['slot.statistics'] : en['slot.statistics']),
                guide: [{
                        order: 45,
                        title: () => (detectLanguage() === 'zh' ? zh['guide.verifier.title'] : en['guide.verifier.title']),
                        description: () => (detectLanguage() === 'zh' ? zh['guide.verifier.desc'] : en['guide.verifier.desc']),
                        icon: VerifierSidebarIcon,
                    }],
            });
            return typeof disposer === 'function' ? disposer : undefined;
        }
        catch (error) {
            console.warn('[llm-verifier] sidebar tab registration failed:', error);
            return undefined;
        }
    };
    // ctx.inject() already runs its callback as soon as the service exists, so an
    // extra ctx.get() pre-check registered the same tab type twice; the registry
    // throws on a duplicate id and that throw used to be swallowed. The returned
    // disposer is owned by the injecting scope, so a reload cannot leave a stale
    // tab definition behind.
    if (typeof ctx.inject === 'function') {
        try {
            ctx.inject(['sidebarRightTabs'], (subCtx) => {
                const subTabs = typeof subCtx?.get === 'function' ? subCtx.get('sidebarRightTabs') : subCtx?.sidebarRightTabs;
                const disposer = registerRightSidebar(subTabs);
                if (disposer)
                    subCtx.effect(() => disposer);
            });
        }
        catch (error) {
            console.warn('[llm-verifier] sidebar tab injection failed:', error);
        }
    }
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: VERIFIER_TAB_ID,
        inject: () => ({ rpc: connection.rpc }),
    }, RightSidebarVerifierPanel));
    ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: VERIFIER_TAB_ID,
    }, RightSidebarVerifierTitle));
}
//# sourceMappingURL=client.js.map