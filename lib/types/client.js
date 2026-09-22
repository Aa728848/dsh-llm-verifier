import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives';
/**
 * Icons, resolved by name across the two vocabularies this plugin spans.
 *
 * DSH 0.1.7 renamed the whole host icon set from a size suffix to a stroke suffix
 * (`IconDataOutline16` → `IconDataOutlineRegular`). The icon module is external to this bundle, so
 * a named import of either spelling is `undefined` on a host on the other side of the rename — and
 * React throws on an undefined element type, which would take the entire settings page down
 * instead of dropping one glyph. Probing the namespace at runtime keeps one bundle working on
 * either line; a name that neither line defines renders nothing.
 */
const hostIcons = uiPrimitives;
const IconData = hostIcons.IconDataOutlineRegular ?? hostIcons.IconDataOutline16 ?? (() => null);
const IconRefresh = hostIcons.IconRefreshOutlineRegular ?? hostIcons.IconRefreshOutline16 ?? (() => null);
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, WORST_CASE_CRITERIA_PER_COMPARISON, computeJudgeCount, computeWorstCaseBudget, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, verifierActivityText, } from "./client-i18n.js";
import { CRITERIA_PRESETS, DEFAULT_GROUND_TRUTH_NOTE, buildPairwisePrompt } from "./core.js";
import { MAX_EXTRA_JUDGES, normalizeExtraJudges, judgeIdentity, judgeConflict, addExtraJudge, removeExtraJudge, serializeExtraJudges, } from "./client-judges.js";
import { buildProcessCycles } from "./client-process-cycles.js";
import { FIELDS, PROFILES, SECTIONS, acceptsNumber, activeProfile, applyProfile, isFieldChanged, issueMap, issueMessageKey, recommendedBudgets, resetField, sectionSummary, renderSections, textIssue, validateValues, valuesFromView, } from "./client-fields.js";
export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, computeJudgeCount, computeWorstCaseBudget, evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails, };
const NS = 'llm-verifier';
const shell = { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 0 32px', color: 'var(--dsw-alias-label-primary)' };
const settingsHeading = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' };
const settingsIntro = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' };
const group = { width: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--dsw-alias-border-l2)' };
const sectionTitle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '18px 0 8px', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'var(--dsw-alias-label-primary)' };
const sectionHeadingStyle = { fontSize: 14, fontWeight: 500, lineHeight: '22px' };
const sectionSummaryStyle = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' };
const badgeStyle = { flex: '0 0 auto', padding: '0 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l2)' };
const linkButton = { border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer', color: 'var(--dsw-alias-link)' };
const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 24px', minHeight: 56, padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' };
const labelCell = { flex: '1 1 220px', minWidth: 0 };
const controlCell = { flex: '0 0 268px', maxWidth: '100%', minWidth: 0, display: 'flex', justifyContent: 'flex-end' };
/** The switch is a fixed 40px glyph; this cell keeps it on the same right edge as every other control. */
const toggleCell = { width: '100%', display: 'flex', justifyContent: 'flex-end' };
const fieldTitle = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' };
const fieldHelp = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 };
const fullLine = { flex: '1 1 100%', margin: '0 0 2px', fontSize: 12, lineHeight: '18px' };
const unitStyle = { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' };
const sliderStyle = { width: '100%', margin: 0, accentColor: 'var(--dsw-alias-state-business-primary)' };
const toolbarStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' };
const summaryLineStyle = { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' };
const stickyBar = { position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0 12px', borderTop: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-module-platform)', boxShadow: '0 -10px 24px var(--dsw-alias-bg-mask-2)' };
const statusStyle = { fontSize: 12, lineHeight: '18px', display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' };
/**
 * ONE box model for every settings control — select, number, text and the judges grid all paint
 * the same 36px layer, so their columns measure equally and their right edges line up. A control
 * that cannot stretch (the host `Input`, for instance, owns an inline-flex wrapper that collapses
 * to its content and hard-codes a 32px height) is not usable here; the native elements below
 * spread this constant and only add their own padding.
 */
const controlStyle = { boxSizing: 'border-box', width: '100%', height: 36, borderRadius: 8, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-input-major)', border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 14, lineHeight: '22px', outline: 'none' };
/** A native select only adds the dropdown-arrow gutter. */
const selectStyle = { ...controlStyle, padding: '0 34px 0 12px' };
/** A native text/number input keeps the same box with symmetric horizontal padding. */
const inputStyle = { ...controlStyle, padding: '0 12px' };
const toggleStyle = (enabled) => ({ position: 'relative', flex: '0 0 auto', width: 40, height: 22, padding: 0, border: 0, borderRadius: 999, cursor: 'pointer', transition: 'background .15s ease', background: enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-specific-input-major)' });
const toggleThumbStyle = (enabled) => ({ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-static-neutral-00)', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left .15s ease' });
const dashboardCard = { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 16, boxShadow: '0 12px 36px var(--dsw-alias-bg-mask-2)' };
const muted = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 };
/** Chart palette rides the state aliases so bars and line stay legible in both themes. */
const chartBarColor = 'var(--dsw-alias-state-business-primary)';
const chartLineColor = 'var(--dsw-alias-state-warn-primary)';
function toneChip(tone) {
    const token = tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
        : tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
            : tone === 'pass' ? 'var(--dsw-alias-state-success-primary)'
                : 'var(--dsw-alias-state-business-primary)';
    return {
        background: `color-mix(in srgb, ${token} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${token} 32%, transparent)`,
        // Amber's 500 step is a fill; its 600 step is the readable text rung.
        color: tone === 'warn' ? 'var(--dsw-alias-state-warn-label)' : token,
    };
}
const toolColors = { verifier_route_classify: '#d97706', verifier_compare: '#4f8cff', verifier_select: '#8b6df6', verifier_track: '#2fc5c9', verifier_best_of_n: '#e2569b', verifier_current_session: '#f5a524' };
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; }
function values(view) { return valuesFromView(record(view.value)); }
function message(error) { return error instanceof Error ? error.message : String(error); }
/** The endpoint answered but rejected the request: a transport fallback would only repeat it. */
class EndpointError extends Error {
}
/** A cycle id is a long random reservation id; the head identifies it and the full one stays in the title. */
function shortCycleId(cycleId) { return cycleId.length <= 10 ? cycleId : cycleId.slice(0, 8); }
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
    const [openSections, setOpenSections] = useState(() => Object.fromEntries(SECTIONS.map(section => [section.id, section.open])));
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
    const dirty = useMemo(() => loaded !== null && draft !== null && !sameSettingValue(draft, values(loaded.settings)), [loaded, draft]);
    // Another writer — the settings shell's reset, a second window, an edit to
    // settings.yaml — can move this namespace under a page that never re-reads
    // it, and the stale draft would then be written straight back on the next
    // save. Re-read whenever the page regains focus, but only while the draft
    // holds no unsaved edit: a pending edit belongs to the user, and the
    // revision check on save still rejects a write that raced a moved namespace.
    const latest = useRef({ loaded, draft });
    latest.current = { loaded, draft };
    useEffect(() => {
        const sync = () => {
            if (document.visibilityState === 'hidden')
                return;
            const { loaded: at, draft: local } = latest.current;
            if (!at || !local)
                return;
            if (!sameSettingValue(local, values(at.settings)))
                return;
            void (async () => {
                try {
                    const s = await remote.settings.describe();
                    if (!s.ok)
                        return;
                    const view = s.value.namespaces.find((x) => x.ns === NS);
                    if (!view || view.revision === at.settings.revision)
                        return;
                    const next = { ...at, settings: view, writable: s.value.writable };
                    latest.current = { loaded: next, draft: values(view) };
                    setLoaded(next);
                    setDraft(values(view));
                    setEditing({});
                    setSaved(false);
                }
                catch { /* keep the last good view; the reload button still forces a read */ }
            })();
        };
        window.addEventListener('focus', sync);
        document.addEventListener('visibilitychange', sync);
        return () => { window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
    }, [remote]);
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
        // The engine reserves budget from the REAL criteria count. A built-in preset's count is known
        // here; a custom file's is not (it lives on the server), so the estimate falls back to the
        // three-criteria default and the file field's help says as much.
        const criteria = draft.criteriaPreset === 'custom' ? WORST_CASE_CRITERIA_PER_COMPARISON : CRITERIA_PRESETS[draft.criteriaPreset].length;
        return evaluateBudgetWarning(draft.autoVerifyMode, draft.extraJudges.length, draft.autoMaxModelCallsPerTask, draft.autoMaxModelCallsPerSession, criteria);
    }, [draft?.autoVerifyMode, draft?.criteriaPreset, draft?.extraJudges.length, draft?.autoMaxModelCallsPerTask, draft?.autoMaxModelCallsPerSession]);
    const translate = useMemo(() => (key) => t[key], [t]);
    const format = useMemo(() => (key, params) => tFormat(translate(key) ?? key, params), [translate]);
    const issues = useMemo(() => (draft ? validateValues(draft) : []), [draft]);
    const issuesByField = useMemo(() => issueMap(issues), [issues]);
    // The saved section holds only real overrides: a draft field equal to the
    // composition base is dropped so a later plugin default still reaches this
    // install (see sectionForSave).
    const save = async () => {
        if (!loaded || !draft || conflict)
            return;
        setBusy(true);
        setSaved(false);
        setError(null);
        try {
            // An explicit undefined means "clear the stored override": sectionForSave
            // starts from the previous user layer, so simply omitting a key would let
            // the stale override outlive the save that cleared it.
            const editable = {
                ...draft,
                extraJudges: serializeExtraJudges(draft.extraJudges),
                reasoningEffort: draft.reasoningEffort || undefined,
                label: draft.label?.trim() || undefined,
                cacheDir: resolveCacheDirOnSave(draft.cacheDir, values(loaded.settings).cacheDir),
            };
            const base = loaded.settings.base === undefined ? undefined : record(loaded.settings.base);
            // "Restore default" only works through a wholesale replace: the host's
            // update() merges a patch into the stored section, so a key we leave out
            // to re-inherit the base keeps its old override instead. Prefer replace
            // and pin every draft value when only update() is available.
            const replaceSettings = remote.settings.replace;
            const canReplace = typeof replaceSettings === 'function';
            const section = sectionForSave(record(loaded.settings.user), editable, base, { reInheritBase: canReplace });
            const res = canReplace
                ? await replaceSettings.call(remote.settings, NS, section, loaded.settings.revision)
                : await remote.settings.update(NS, section, loaded.settings.revision);
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
        }
    };
    if (!loaded || !draft)
        return _jsxs("div", { style: shell, children: [_jsx("h2", { style: settingsHeading, children: t['settings.title'] }), _jsx("p", { style: settingsIntro, children: error ?? t['settings.loading'] }), error && _jsx("div", { children: _jsx(Button, { variant: "outline", onClick: () => void load(), children: t['settings.retry'] }) })] });
    const criteriaCount = draft.criteriaPreset === 'custom' ? WORST_CASE_CRITERIA_PER_COMPARISON : CRITERIA_PRESETS[draft.criteriaPreset].length;
    const issueText = (issue) => tFormat(translate(issueMessageKey(issue)) ?? issueMessageKey(issue), issue.params);
    const helpFor = (field) => field.key === 'enabled'
        ? translate(draft.enabled ? field.helpKey : (field.helpKeyOff ?? field.helpKey)) ?? ''
        : translate(field.helpKey) ?? '';
    const inputAria = (field) => translate(field.titleKey) ?? String(field.key);
    const setSectionOpen = (id, open) => setOpenSections(current => ({ ...current, [id]: open }));
    const expandAll = () => setOpenSections(Object.fromEntries(SECTIONS.map(section => [section.id, true])));
    const collapseAll = () => setOpenSections(Object.fromEntries(SECTIONS.map(section => [section.id, false])));
    const jumpTo = (key) => {
        const field = FIELDS.find(candidate => candidate.key === key);
        if (!field)
            return;
        setSectionOpen(field.section, true);
        window.requestAnimationFrame(() => {
            const node = document.querySelector('[data-field="' + String(key) + '"]');
            if (!(node instanceof HTMLElement))
                return;
            node.scrollIntoView({ block: 'center', behavior: 'smooth' });
            const focusable = node.querySelector('input, select, button, textarea');
            if (focusable instanceof HTMLElement)
                focusable.focus({ preventScroll: true });
        });
    };
    const resetOne = (field) => {
        setSaved(false);
        setEditing(current => { if (!(field.key in current))
            return current; const next = { ...current }; delete next[field.key]; return next; });
        setDraft(current => (current ? resetField(current, field.key) : current));
    };
    const fillRecommended = () => {
        setSaved(false);
        setDraft(current => (current ? { ...current, ...recommendedBudgets(computeJudgeCount(current.extraJudges.length), criteriaCount) } : current));
    };
    const messageFor = (field) => {
        const issue = issuesByField.get(field.key);
        if (issue)
            return issue;
        if (field.kind === 'number' && editing[field.key] !== undefined)
            return textIssue(field, editing[field.key]);
        return null;
    };
    const renderNumber = (field) => {
        const key = field.key;
        const current = Number(draft[key]);
        return _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("input", { style: { ...inputStyle, flex: '1 1 auto', minWidth: 0 }, type: "text", inputMode: "decimal", disabled: busy, "aria-label": inputAria(field), "aria-invalid": messageFor(field) ? true : undefined, value: editing[key] ?? String(draft[key] ?? ''), onChange: event => {
                                const raw = event.target.value;
                                setEditing(state => (state[key] === raw ? state : { ...state, [key]: raw }));
                                if (acceptsNumber(field, raw))
                                    patch(key, Number(raw.trim()));
                            }, onBlur: () => setEditing(state => { if (!(key in state))
                                return state; const next = { ...state }; delete next[key]; return next; }) }), field.unitKey && _jsx("span", { style: unitStyle, children: t[field.unitKey] })] }), field.slider && _jsx("input", { type: "range", style: sliderStyle, min: field.min ?? 0, max: field.max ?? 1, step: field.max !== undefined && field.max <= 1 ? 0.001 : 1, disabled: busy, "aria-label": inputAria(field), value: Number.isFinite(current) ? current : field.min ?? 0, onChange: event => patch(key, Number(event.target.value)) })] });
    };
    const renderText = (field) => {
        const key = field.key;
        const placeholder = key === 'criteriaFile' ? 'criteria/my-task.md' : key === 'cacheDir' ? 'verifier' : undefined;
        return _jsx("input", { style: inputStyle, type: "text", disabled: busy, placeholder: placeholder, "aria-label": inputAria(field), value: String(draft[key] ?? ''), onChange: event => patch(key, event.target.value) });
    };
    const renderSelect = (field) => {
        if (field.select === 'mode')
            return _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.autoVerifyMode, onChange: event => patch('autoVerifyMode', event.target.value), children: [_jsx("option", { value: "manual", children: t['field.autoVerifyMode.manual'] }), _jsx("option", { value: "smart", children: t['field.autoVerifyMode.smart'] }), _jsx("option", { value: "strict", children: t['field.autoVerifyMode.strict'] })] });
        if (field.select === 'processSelection')
            return _jsx("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.autoProcessSelection, onChange: event => patch('autoProcessSelection', event.target.value), children: ['off', 'recovery', 'every-step'].map(id => _jsx("option", { value: id, children: t[('field.autoProcessSelection.' + id)] }, id)) });
        if (field.select === 'criteriaPreset')
            return _jsx("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.criteriaPreset, onChange: event => patch('criteriaPreset', event.target.value), children: ['coding', 'debug', 'research', 'ops', 'writing', 'custom'].map(id => _jsx("option", { value: id, children: t[('field.criteriaPreset.' + id)] }, id)) });
        if (field.select === 'provider')
            return _jsx("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.provider, onChange: event => {
                    const provider = event.target.value;
                    const first = loaded.groups.find(group => group.id === provider)?.models[0];
                    setSaved(false);
                    setDraft({ ...draft, provider, ...(first ? { model: first.id, reasoningEffort: first.reasoning?.defaultEffort } : {}) });
                }, children: loaded.groups.map(group => _jsxs("option", { value: group.id, children: [group.name, " \u00B7 ", group.id] }, group.id)) });
        if (field.select === 'model')
            return _jsx("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.model, onChange: event => {
                    const model = event.target.value;
                    const found = models.find(entry => entry.id === model);
                    setSaved(false);
                    setDraft({ ...draft, model, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) });
                }, children: models.map(entry => _jsxs("option", { value: entry.id, children: [entry.name, " \u00B7 ", entry.id] }, entry.id)) });
        if (field.select === 'effort')
            return _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": inputAria(field), value: draft.reasoningEffort ?? '', onChange: event => patch('reasoningEffort', event.target.value || undefined), children: [_jsx("option", { value: "", children: t['field.reasoningEffort.default'] }), efforts.map(option => _jsx("option", { value: option.id, children: option.name }, option.id))] });
        return null;
    };
    const renderControl = (field) => {
        if (field.kind === 'toggle') {
            const on = Boolean(draft[field.key]);
            return _jsx("div", { style: toggleCell, children: _jsx("button", { type: "button", role: "switch", "aria-checked": on, "aria-label": inputAria(field), disabled: busy, onClick: () => patch(field.key, !on), style: toggleStyle(on), children: _jsx("span", { style: toggleThumbStyle(on) }) }) });
        }
        if (field.kind === 'number')
            return renderNumber(field);
        if (field.kind === 'text')
            return renderText(field);
        if (field.kind === 'select')
            return renderSelect(field);
        return null;
    };
    const renderJudges = () => _jsxs(Fragment, { children: [_jsxs("div", { style: row, children: [_jsxs("div", { style: labelCell, children: [_jsx("div", { style: fieldTitle, children: translate('field.extraJudges.title') ?? 'extraJudges' }), _jsx("div", { style: fieldHelp, children: translate('field.extraJudges.help') ?? '' })] }), _jsx("div", { style: controlCell, children: _jsx(Button, { variant: "outline", disabled: busy || draft.extraJudges.length >= MAX_EXTRA_JUDGES, onClick: addJudge, children: t['field.extraJudges.add'] }) })] }), draft.extraJudges.length > 0 && _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', paddingBottom: 2 }, children: [_jsx("div", { children: t['field.provider.title'] }), _jsx("div", { children: t['field.model.title'] }), _jsx("div", { children: t['field.reasoningEffort.title'] }), _jsx("div", { children: t['field.extraJudges.labelTitle'] }), _jsx("div", {})] }), draft.extraJudges.map((judge, idx) => {
                        const judgeGroup = loaded.groups.find(group => group.id === judge.provider);
                        const judgeModels = judgeGroup?.models ?? [];
                        const judgeModel = judgeModels.find(entry => entry.id === judge.model);
                        const judgeEfforts = judgeModel?.reasoning?.efforts ?? [];
                        return _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto', gap: 8, alignItems: 'center' }, children: [_jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.providerAria'], { index: idx + 1 }), value: judge.provider, onChange: event => {
                                        const newProvider = event.target.value;
                                        const targetGroup = loaded.groups.find(group => group.id === newProvider);
                                        const firstM = targetGroup?.models[0];
                                        updateJudge(idx, { provider: newProvider, model: firstM?.id ?? '', ...(firstM?.reasoning?.defaultEffort ? { reasoningEffort: firstM.reasoning.defaultEffort } : { reasoningEffort: undefined }) });
                                    }, children: [!loaded.groups.some(group => group.id === judge.provider) && judge.provider && _jsx("option", { value: judge.provider, children: judge.provider }), loaded.groups.map(group => _jsxs("option", { value: group.id, children: [group.name, " \u00B7 ", group.id] }, group.id))] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.modelAria'], { index: idx + 1 }), value: judge.model, onChange: event => {
                                        const newModel = event.target.value;
                                        const found = judgeModels.find(entry => entry.id === newModel);
                                        updateJudge(idx, { model: newModel, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) });
                                    }, children: [!judgeModels.some(entry => entry.id === judge.model) && judge.model && _jsx("option", { value: judge.model, children: judge.model }), judgeModels.map(entry => _jsxs("option", { value: entry.id, children: [entry.name, " \u00B7 ", entry.id] }, entry.id))] }), _jsxs("select", { style: selectStyle, disabled: busy, "aria-label": tFormat(t['field.extraJudges.effortAria'], { index: idx + 1 }), value: judge.reasoningEffort ?? '', onChange: event => updateJudge(idx, { reasoningEffort: event.target.value || undefined }), children: [_jsx("option", { value: "", children: t['field.reasoningEffort.default'] }), judgeEfforts.map(option => _jsx("option", { value: option.id, children: option.name }, option.id))] }), _jsx("input", { style: inputStyle, type: "text", disabled: busy, placeholder: t['field.extraJudges.labelPlaceholder'], "aria-label": tFormat(t['field.extraJudges.labelAria'], { index: idx + 1 }), value: judge.label ?? '', onChange: event => updateJudge(idx, { label: event.target.value }) }), _jsx(Button, { variant: "outline", disabled: busy, "aria-label": tFormat(t['field.extraJudges.removeAria'], { index: idx + 1 }), onClick: () => removeJudge(idx), children: t['field.extraJudges.remove'] })] }, idx);
                    })] }), conflict && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: conflict.duplicateOf === 'primary' ? tFormat(t['field.extraJudges.conflictPrimary'], { index: conflict.index + 1, id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? '', draft.extraJudges[conflict.index]?.model ?? '') }) : tFormat(t['field.extraJudges.conflictDuplicate'], { index: conflict.index + 1, other: conflict.duplicateOf + 1, id: judgeIdentity(draft.extraJudges[conflict.index]?.provider ?? '', draft.extraJudges[conflict.index]?.model ?? '') }) })] }, "extraJudges");
    const renderRow = (field) => {
        const message = messageFor(field);
        const changed = isFieldChanged(field, draft);
        const warning = field.key === 'autoMaxModelCallsPerTask' && budgetWarning?.warnTask
            ? tFormat(translate('field.autoMaxModelCallsPerTask.warnBudget') ?? '', { current: draft.autoMaxModelCallsPerTask, required: budgetWarning.worstCaseTask, judges: budgetWarning.judgeCount })
            : field.key === 'autoMaxModelCallsPerSession' && budgetWarning?.warnSession
                ? tFormat(translate('field.autoMaxModelCallsPerSession.warnBudget') ?? '', { current: draft.autoMaxModelCallsPerSession, required: budgetWarning.worstCaseSession, judges: budgetWarning.judgeCount })
                : null;
        const preview = field.key === 'criteriaPreset' && draft.criteriaPreset !== 'custom' ? (() => {
            const preset = CRITERIA_PRESETS[draft.criteriaPreset];
            const first = preset[0];
            if (!first)
                return null;
            return _jsxs("details", { style: { margin: '2px 0 6px 4px', fontSize: 12 }, children: [_jsx("summary", { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' }, children: tFormat(t['field.criteriaPreset.previewSummary'], { count: preset.length }) }), _jsx("pre", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto', background: 'var(--dsw-alias-markdown-code-block)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 10, marginTop: 8 }, children: buildPairwisePrompt(t['field.criteriaPreset.sampleTask'], t['field.criteriaPreset.sampleA'], t['field.criteriaPreset.sampleB'], first, DEFAULT_GROUND_TRUTH_NOTE) })] });
        })() : null;
        return _jsxs(Fragment, { children: [_jsxs("div", { style: row, "data-field": String(field.key), children: [_jsxs("div", { style: labelCell, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, children: [_jsx("span", { style: fieldTitle, children: translate(field.titleKey) ?? String(field.key) }), changed && _jsx("span", { style: badgeStyle, children: t['settings.fieldChanged'] }), changed && _jsx("button", { type: "button", style: linkButton, disabled: busy, onClick: () => resetOne(field), children: t['settings.fieldReset'] })] }), _jsx("div", { style: fieldHelp, children: helpFor(field) })] }), _jsx("div", { style: controlCell, children: renderControl(field) }), field.key === 'autoProcessSelection' && draft.autoProcessSelection === 'every-step' && _jsx("p", { style: { ...fullLine, margin: '6px 0 2px', padding: '6px 9px', borderRadius: 8, ...toneChip('warn') }, children: t['field.autoProcessSelection.everyStepWarning'] }), message && _jsx("p", { style: { ...fullLine, color: 'var(--dsw-alias-state-error-primary)' }, children: issueText(message) }), warning && _jsx("p", { style: { ...fullLine, color: 'var(--dsw-alias-state-warn-label)' }, children: warning })] }), preview] }, String(field.key));
    };
    const currentProfile = activeProfile(draft, criteriaCount);
    const sections = renderSections(draft);
    return _jsxs("div", { style: shell, children: [_jsx("h2", { style: settingsHeading, children: t['settings.title'] }), _jsx("p", { style: settingsIntro, children: t['settings.intro'] }), _jsx("p", { style: summaryLineStyle, children: draft.autoVerifyMode === 'manual'
                    ? translate('settings.summary.manual') ?? ''
                    : tFormat(translate('settings.summary.line') ?? '', {
                        mode: translate('field.autoVerifyMode.' + draft.autoVerifyMode) ?? draft.autoVerifyMode,
                        preset: translate('field.criteriaPreset.' + draft.criteriaPreset) ?? draft.criteriaPreset,
                        threshold: draft.autoVerifyThreshold,
                        judges: tFormat(translate('settings.summary.judges') ?? '{count}', { count: computeJudgeCount(draft.extraJudges.length) }),
                        task: budgetWarning?.worstCaseTask ?? draft.autoMaxModelCallsPerTask,
                        session: budgetWarning?.worstCaseSession ?? draft.autoMaxModelCallsPerSession,
                    }) }), _jsxs("div", { style: toolbarStyle, children: [_jsx("span", { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }, children: t['settings.profile.title'] }), _jsxs("select", { style: { ...selectStyle, width: 220 }, disabled: busy, title: translate('settings.profile.hint'), "aria-label": t['settings.profile.title'], value: currentProfile, onChange: event => {
                            const picked = event.target.value;
                            if (picked === 'custom')
                                return;
                            setSaved(false);
                            setDraft(current => (current ? applyProfile(current, picked, criteriaCount) : current));
                        }, children: [currentProfile === 'custom' && _jsx("option", { value: "custom", disabled: true, children: t['settings.profile.custom'] }), PROFILES.map(profile => _jsx("option", { value: profile.id, children: translate(profile.titleKey) ?? profile.id }, profile.id))] }), _jsx("span", { style: { flex: '1 1 0' } }), _jsx(Button, { variant: "outline", disabled: busy, onClick: expandAll, children: t['settings.expandAll'] }), _jsx(Button, { variant: "outline", disabled: busy, onClick: collapseAll, children: t['settings.collapseAll'] })] }), sections.map(entry => {
                const title = translate(entry.section.titleKey) ?? entry.section.id;
                const open = openSections[entry.section.id] === true;
                const summary = sectionSummary(entry.section.id, draft, translate, format);
                return _jsxs("section", { style: group, children: [_jsxs("button", { type: "button", style: sectionTitle, "aria-expanded": open, "aria-label": tFormat(translate(open ? 'settings.sectionCollapse' : 'settings.sectionExpand') ?? '', { title }), onClick: () => setSectionOpen(entry.section.id, !open), children: [_jsx("span", { style: sectionHeadingStyle, children: title }), entry.section.tier === 'advanced' && _jsx("span", { style: badgeStyle, children: t['settings.advancedBadge'] }), summary && _jsx("span", { style: sectionSummaryStyle, children: summary }), _jsx("span", { style: { marginLeft: summary ? 0 : 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }, children: open ? '▾' : '▸' })] }), open && entry.fields.map(field => (field.kind === 'custom' ? renderJudges() : renderRow(field))), open && entry.section.id === 'tools' && !draft.enabled && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: t['field.enabled.warnDisabled'] }), open && entry.section.id === 'autoVerify' && draft.autoVerifyMode !== 'manual' && _jsx("p", { style: { margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }, children: t['field.autoVerify.warnNotice'] }), open && entry.section.id === 'budgets' && _jsx("div", { style: { padding: '10px 0' }, children: _jsx(Button, { variant: "outline", disabled: busy, onClick: fillRecommended, children: t['settings.recommend'] }) })] }, entry.section.id);
            }), loaded.failures.length > 0 && _jsxs("div", { style: { padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-state-warn-label)', fontSize: 12, lineHeight: '18px' }, children: [_jsx("div", { style: { fontWeight: 500, marginBottom: 3 }, children: t['settings.catalogFailures'] }), loaded.failures.map(failure => _jsx("div", { children: failure }, failure))] }), _jsx("div", { style: stickyBar, children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, children: [issues.length > 0
                            ? _jsxs("span", { style: { ...statusStyle, color: 'var(--dsw-alias-state-error-primary)' }, children: [tFormat(t['settings.invalid.summary'], { count: issues.length }), _jsx("button", { type: "button", style: linkButton, onClick: () => jumpTo(issues[0].key), children: t['settings.jumpToIssue'] })] })
                            : error
                                ? _jsx("span", { style: { ...statusStyle, color: 'var(--dsw-alias-state-error-primary)' }, children: error })
                                : saved && !dirty
                                    ? _jsx("span", { style: { ...statusStyle, color: 'var(--dsw-alias-state-success-primary)' }, children: t['settings.saved'] })
                                    : dirty
                                        ? _jsx("span", { style: { ...statusStyle, color: 'var(--dsw-alias-state-warn-label)' }, children: t['settings.unsaved'] })
                                        : null, _jsxs("span", { style: { marginLeft: 'auto', display: 'flex', gap: 8 }, children: [_jsx(Button, { variant: "outline", disabled: busy, onClick: () => void load(), children: t['settings.reload'] }), _jsx(Button, { variant: "primary", disabled: busy || !loaded.writable || Boolean(conflict) || issues.length > 0, onClick: () => void save(), children: busy ? t['settings.saving'] : t['settings.save'] })] })] }) })] });
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
    return _jsxs("div", { style: { width: '100%', overflowX: 'auto' }, children: [_jsxs("svg", { viewBox: `0 0 ${width} ${height}`, style: { display: 'block', width: '100%', minWidth: 620, height: 'auto' }, "aria-label": t['chart.ariaLabel'], children: [[0, .25, .5, .75, 1].map(ratio => _jsxs("g", { children: [_jsx("line", { x1: pad.l, x2: width - pad.r, y1: pad.t + innerH * ratio, y2: pad.t + innerH * ratio, stroke: "var(--dsw-alias-border-l2)" }), _jsx("text", { x: pad.l - 8, y: pad.t + innerH * ratio + 4, textAnchor: "end", fontSize: "10", fill: "var(--dsw-alias-label-secondary)", children: Math.round(max * (1 - ratio)) })] }, ratio)), rows.map((row, index) => _jsx("rect", { x: x(index) - barWidth / 2, y: y(row.invocations), width: barWidth, height: pad.t + innerH - y(row.invocations), rx: "2", fill: chartBarColor, opacity: ".82" }, row.date)), _jsx("polyline", { points: points, fill: "none", stroke: chartLineColor, strokeWidth: "2.4", strokeLinejoin: "round", strokeLinecap: "round" }), rows.map((row, index) => index % step === 0 || index === rows.length - 1 ? _jsxs("text", { x: x(index), y: height - 14, textAnchor: "middle", fontSize: "10", fill: "var(--dsw-alias-label-secondary)", children: [Number(row.date.slice(5, 7)), "/", Number(row.date.slice(8, 10))] }, row.date) : null)] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'center', gap: 18, ...muted }, children: [_jsxs("span", { children: [_jsx("i", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: chartBarColor, marginRight: 6 } }), t['chart.legendToolCalls']] }), _jsxs("span", { children: [_jsx("i", { style: { display: 'inline-block', width: 14, height: 2, background: chartLineColor, marginRight: 6, verticalAlign: 'middle' } }), t['chart.legendModelCalls']] })] })] });
}
export function StatisticsPage({ sessionId, rpc, isGlobal, blankComposerSeat }) {
    const lang = useLanguage();
    const t = dictionaries[lang];
    const labels = toolLabels[lang];
    const [days, setDays] = useState(30);
    const [sessionOnly, setSessionOnly] = useState(!isGlobal && Boolean(sessionId));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refresh, setRefresh] = useState(0);
    // Decision snapshots are fetched on demand: they carry whole prompts, and a dashboard
    // that loaded all of them would ship megabytes of text for rows nobody opened.
    const [snapshot, setSnapshot] = useState(null);
    const snapshotRequest = useRef(0);
    // Details are a controlled disclosure rather than a per-row <details>: both entry points then sit
    // on the SAME line and each panel opens directly beneath it, instead of the snapshot landing
    // under a details block that happens to be expanded.
    const [openDetails, setOpenDetails] = useState(null);
    // A read-only dashboard has nothing to type into, yet the Conversation shell renders its
    // composer for every View. The handle is only present on the Conversation View instance, and
    // disposing it on unmount brings the real card back with its draft intact. Mount-only: the
    // takeover belongs to this View's lifetime, and a host that rebuilds the injected props object
    // must not make the seat flap between registrations.
    const seatHandle = useRef(blankComposerSeat);
    seatHandle.current = blankComposerSeat;
    useEffect(() => {
        const take = seatHandle.current;
        if (typeof take !== 'function')
            return undefined;
        const dispose = take();
        return () => { dispose(); };
    }, []);
    const toggleSnapshot = async (id) => {
        if (snapshot?.id === id) {
            setSnapshot(null);
            return;
        }
        const request = ++snapshotRequest.current;
        setSnapshot({ id });
        const payload = { kind: 'decision', id };
        try {
            let record;
            if (rpc && typeof rpc.call === 'function') {
                try {
                    const result = await rpc.call('/api', 'llm-verifier/statistics', payload);
                    if (result && result.ok === true)
                        record = result.value.decision;
                    else if (result && result.ok === false) {
                        // A rejection is the host's real answer — "no snapshot for this row" is one of them —
                        // so it is shown as-is instead of being retried over the raw fetch endpoint.
                        if (snapshotRequest.current === request)
                            setSnapshot({ id, error: result.error?.message ?? t['recent.decisionMissing'] });
                        return;
                    }
                }
                catch (rpcError) {
                    console.warn('[llm-verifier] decision rpc.call failed, trying fetch fallback:', rpcError);
                }
            }
            if (record === undefined) {
                const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
                const body = await response.json().catch(() => undefined);
                const value = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined;
                if (value === undefined || value === null)
                    throw new EndpointError(body?.error?.message ?? body?.result?.error?.message ?? t['stats.requestFailed']);
                record = value.decision;
            }
            if (snapshotRequest.current === request)
                setSnapshot({ id, ...(record === undefined ? { error: t['recent.decisionMissing'] } : { record }) });
        }
        catch (cause) {
            if (snapshotRequest.current === request)
                setSnapshot({ id, error: message(cause) });
        }
    };
    // Judge probe: one real, bounded call per configured judge. Not recorded in the statistics —
    // it answers "which channel is this judge on, and is my rubric the one in effect", which the
    // aggregate counters cannot.
    const [probe, setProbe] = useState(null);
    const runProbe = async () => {
        if (probe?.busy)
            return;
        setProbe({ busy: true });
        const payload = { kind: 'probe' };
        try {
            let value;
            if (rpc && typeof rpc.call === 'function') {
                try {
                    const result = await rpc.call('/api', 'llm-verifier/statistics', payload);
                    if (result && result.ok === true)
                        value = result.value;
                }
                catch (rpcError) {
                    console.warn('[llm-verifier] probe rpc.call failed, trying fetch fallback:', rpcError);
                }
            }
            if (value === undefined) {
                const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
                const body = await response.json().catch(() => undefined);
                const fallback = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined;
                if (fallback === undefined || fallback === null)
                    throw new EndpointError(body?.error?.message ?? body?.result?.error?.message ?? t['stats.requestFailed']);
                value = fallback;
            }
            setProbe({ busy: false, value });
        }
        catch (cause) {
            setProbe({ busy: false, error: message(cause) });
        }
    };
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
    // The same reservation can produce more than one row (a skip row carries the reason, the purchase
    // row carries the spend), so the pipeline is grouped by cycleId instead of drawn per row.
    const processCycles = useMemo(() => buildProcessCycles(data?.recent ?? [], t), [data?.recent, t]);
    return _jsx("main", { style: { height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '22px clamp(16px, 3vw, 38px) 48px', color: 'var(--dsw-alias-label-primary)', background: 'radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)' }, children: _jsxs("div", { style: { maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }, children: [_jsxs("header", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("span", { style: { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)', color: 'var(--dsw-alias-state-business-primary)' }, children: _jsx(IconData, { size: 18 }) }), _jsx("h2", { style: { margin: 0, fontSize: 23 }, children: isGlobal ? t['global.panelTitle'] : t['stats.pageTitle'] })] }), _jsx("p", { style: { margin: '7px 0 0 44px', ...muted }, children: isGlobal ? t['global.panelIntro'] : tFormat(t['stats.updatedAt'], { time: data ? dateTime(data.generatedAt, lang) : '--' }) })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("div", { style: { display: 'flex', padding: 3, borderRadius: 10, background: 'var(--dsw-alias-bg-multi-select)', border: '1px solid var(--dsw-alias-border-l2)' }, children: [7, 30, 90].map(value => _jsx("button", { "aria-pressed": days === value, onClick: () => setDays(value), style: { border: 0, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: days === value ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)', background: days === value ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent)' : 'transparent' }, children: tFormat(t['stats.daysUnit'], { days: value }) }, value)) }), Boolean(sessionId) && _jsx("button", { "aria-pressed": sessionOnly, onClick: () => setSessionOnly(value => !value), style: { border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: sessionOnly ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)', background: sessionOnly ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)' : 'var(--dsw-alias-interactive-bg-hover)' }, children: sessionOnly ? t['stats.currentSession'] : t['stats.allSessions'] }), _jsx("button", { type: "button", disabled: probe?.busy === true, onClick: () => void runProbe(), style: { border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' }, children: probe?.busy === true ? t['probe.running'] : t['probe.button'] }), _jsx("button", { title: t['stats.refresh'], onClick: () => setRefresh(value => value + 1), style: { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)', cursor: 'pointer' }, children: _jsx(IconRefresh, { size: 16 }) })] })] }), error && _jsxs("div", { style: { ...dashboardCard, padding: 18, borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' }, children: [error, _jsx("div", { style: { ...muted, marginTop: 6 }, children: t['stats.hostRestartHint'] })] }), probe !== null && _jsxs("section", { style: { ...dashboardCard, padding: '16px 18px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("strong", { children: t['probe.title'] }), _jsx("span", { style: muted, children: t['probe.note'] })] }), probe.error !== undefined && _jsx("div", { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }, children: probe.error }), probe.value !== undefined && _jsxs(_Fragment, { children: [_jsx("div", { style: { ...muted, marginTop: 8 }, children: tFormat(t['probe.rubric'], { source: probe.value.rubric.source, count: probe.value.rubric.count, file: probe.value.rubric.file ?? '' }) }), probe.value.rubric.error !== undefined && _jsx("div", { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-warn-label)' }, children: tFormat(t['probe.rubricFallback'], { error: probe.value.rubric.error }) }), _jsx("div", { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }, children: probe.value.judges.map(judge => _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, padding: '9px 11px', borderRadius: 9, background: 'var(--dsw-alias-interactive-bg-hover)' }, children: [_jsx("span", { style: { color: judge.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', fontWeight: 600 }, children: judge.ok ? 'OK' : t['probe.failed'] }), _jsx("strong", { children: judge.label }), _jsxs("span", { style: muted, children: [judge.provider, "/", judge.model] }), judge.ok ? _jsxs(_Fragment, { children: [judge.channel !== undefined && _jsxs("span", { style: muted, children: [tFormat(t['probe.channel'], { channel: judge.channel }), judge.channelProbed === true ? ' · ' + t['probe.reprobed'] : ''] }), judge.scoreA !== undefined && judge.scoreB !== undefined && _jsx("span", { style: muted, children: tFormat(t['probe.scores'], { a: formatPercentage(judge.scoreA), b: formatPercentage(judge.scoreB) }) }), _jsx("span", { style: muted, children: tFormat(t['probe.latency'], { ms: String(judge.latencyMs) }) }), judge.calls !== undefined && _jsx("span", { style: muted, children: tFormat(t['probe.calls'], { calls: String(judge.calls) }) })] }) : _jsx("span", { style: { color: 'var(--dsw-alias-state-error-primary)' }, children: judge.error })] }, judge.label + judge.model)) })] })] }), loading && !data ? _jsx("div", { style: { ...dashboardCard, padding: 32, textAlign: 'center', ...muted }, children: t['stats.loading'] }) : _jsxs(_Fragment, { children: [_jsxs("section", { style: { ...dashboardCard, padding: '22px 24px', display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(240px,1fr)', gap: 24, alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: tFormat(t['stats.costSummary'], { days }) }), _jsx("div", { style: { fontSize: 38, fontWeight: 780, letterSpacing: '-.03em', margin: '5px 0' }, children: money(totals?.estimatedCostUsd ?? 0) }), _jsx("div", { style: muted, children: tFormat(t['stats.callsSummary'], { invocations: compact(totals?.invocations ?? 0, lang), calls: compact(totals?.calls ?? 0, lang) }) })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 16px', fontSize: 13 }, children: [_jsx("span", { style: muted, children: t['stats.successCalls'] }), _jsxs("strong", { children: [compact(totals?.successes ?? 0, lang), " ", _jsxs("small", { style: { color: 'var(--dsw-alias-state-success-primary)' }, children: ["\u25B2 ", ((totals?.successRate ?? 0) * 100).toFixed(1), "%"] })] }), _jsx("span", { style: muted, children: t['stats.failedCalls'] }), _jsx("strong", { children: compact(totals?.failures ?? 0, lang) }), _jsx("span", { style: muted, children: t['stats.avgDuration'] }), _jsx("strong", { children: duration(totals?.averageDurationMs ?? 0) })] })] }), _jsxs("section", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }, children: [_jsx(Metric, { label: t['metric.cacheHitRate'], value: ((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + '%', note: tFormat(t['metric.cacheHitNote'], { hits: compact(totals?.cacheHits ?? 0, lang), total: compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0), lang) }), accent: "var(--dsw-alias-state-success-primary)" }), _jsx(Metric, { label: t['metric.prefixCacheHitRate'], value: ((totals?.prefixCacheHitRate ?? 0) * 100).toFixed(1) + '%', note: tFormat(t['metric.prefixCacheHitNote'], { cached: compact(totals?.cachedInputTokens ?? 0, lang), input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang) }) }), _jsx(Metric, { label: t['metric.tokens'], value: compact(totals?.tokens ?? 0, lang), note: tFormat(t['metric.tokensNote'], { input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang), output: compact(totals?.outputTokens ?? 0, lang) }) }), _jsx(Metric, { label: t['metric.avgModelCalls'], value: (totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : '0', note: tFormat(t['metric.avgModelCallsNote'], { attempts: compact(totals?.attempts ?? 0, lang), retries: compact(totals?.retries ?? 0, lang) }) }), _jsx(Metric, { label: t['metric.scoringMode'], value: compact(totals?.topLogprobScores ?? 0, lang), note: tFormat(t['metric.scoringModeNote'], { explicit: compact(totals?.explicitTagScores ?? 0, lang) }) })] }), _jsxs("section", { style: { ...dashboardCard, padding: '18px 20px 16px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }, children: [_jsx("strong", { children: t['chart.title'] }), _jsx("span", { style: muted, children: sessionOnly ? t['stats.currentSession'] : t['stats.allSessions'] })] }), _jsx(TrendChart, { daily: data?.daily ?? [], days: days, lang: lang })] }), _jsxs("section", { style: { ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }, children: [_jsx("strong", { children: t['table.title'] }), _jsx("span", { style: muted, children: tFormat(t['table.toolCount'], { count: (data?.tools ?? []).length }) })] }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }, children: [_jsx("thead", { children: _jsx("tr", { style: { textAlign: 'left', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)' }, children: [t['table.colTool'], t['table.colInvocations'], t['table.colSuccessRate'], t['table.colAvgDuration'], t['table.colModelCalls'], t['table.colTokens'], t['table.colCacheHits'], t['table.colEstimatedCost']].map(value => _jsx("th", { style: { padding: '10px 12px', fontWeight: 500 }, children: value }, value)) }) }), _jsxs("tbody", { children: [(data?.tools ?? []).map(tool => _jsxs("tr", { style: { borderTop: '1px solid var(--dsw-alias-border-l2)' }, children: [_jsxs("td", { style: { padding: '13px 12px' }, children: [_jsx("span", { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toolColors[tool.toolName] ?? '#8691a8', marginRight: 8 } }), _jsx("strong", { children: labels[tool.toolName] ?? tool.toolName }), _jsx("div", { style: { ...muted, margin: '3px 0 0 16px' }, children: tool.toolName })] }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.invocations, lang) }), _jsxs("td", { style: { padding: '13px 12px', color: tool.successRate >= .9 ? 'var(--dsw-alias-state-success-primary)' : tool.successRate >= .7 ? 'var(--dsw-alias-state-warn-label)' : 'var(--dsw-alias-state-error-primary)' }, children: [(tool.successRate * 100).toFixed(1), "%"] }), _jsx("td", { style: { padding: '13px 12px' }, children: duration(tool.averageDurationMs) }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.calls, lang) }), _jsx("td", { style: { padding: '13px 12px' }, children: compact(tool.tokens, lang) }), _jsxs("td", { style: { padding: '13px 12px' }, children: [tool.cacheHits, "/", tool.cacheHits + tool.cacheMisses] }), _jsx("td", { style: { padding: '13px 12px' }, children: money(tool.estimatedCostUsd) })] }, tool.toolName)), (data?.tools.length ?? 0) === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 8, style: { padding: 28, textAlign: 'center', ...muted }, children: t['table.empty'] }) })] })] }) })] }), _jsxs("section", { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(290px,.45fr)', gap: 16, alignItems: 'start' }, children: [_jsxs("div", { style: { ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }, children: [_jsx("strong", { children: t['recent.title'] }), _jsx("span", { style: muted, children: t['recent.maxCount'] })] }), _jsxs("div", { style: { maxHeight: 360, overflow: 'auto' }, children: [(data?.recent ?? []).map(item => {
                                                    const verdictInfo = item.verdict ? formatVerdictDetails(item.verdict, t) : undefined;
                                                    const failed = !item.success || (verdictInfo ? verdictInfo.isFailed : false);
                                                    const detailsOpen = openDetails === item.id;
                                                    const panelStyle = { margin: '8px 0 0 15px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-interactive-bg-hover)', fontSize: 11 };
                                                    // The row is a column: identity plus timing on the first line, then the two controls on
                                                    // one line, then whichever panel they opened. Panels therefore span the whole row
                                                    // instead of being squeezed into the identity column.
                                                    return _jsxs("div", { style: { padding: '11px 8px', borderTop: '1px solid var(--dsw-alias-border-l2)' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) auto', gap: 12 }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { width: 7, height: 7, borderRadius: '50%', background: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } }), _jsx("strong", { style: { fontSize: 13 }, children: labels[item.toolName] ?? item.toolName }), _jsxs("span", { style: muted, children: [item.provider, "/", item.model] })] }), !item.success && _jsx("div", { title: item.errorMessage, style: { margin: '5px 0 0 15px', fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: item.errorMessage ?? item.errorName }), item.verdict && verdictInfo && _jsxs("div", { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 0 0 15px', fontSize: 11 }, children: [verdictInfo.outcomeText && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, fontWeight: 500, fontSize: 11, ...toneChip(verdictInfo.isFailed ? 'error' : item.verdict.outcome === 'tie' ? 'warn' : 'pass') }, children: verdictInfo.outcomeText }), verdictInfo.phaseText && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)' }, children: verdictInfo.phaseText }), verdictInfo.scoreText && _jsx("span", { style: { color: (typeof item.verdict.threshold === 'number' && typeof item.verdict.score === 'number' && item.verdict.score < item.verdict.threshold) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)' }, children: verdictInfo.scoreText }), verdictInfo.checkpointsText && _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: verdictInfo.checkpointsText }), verdictInfo.criteriaText && _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: verdictInfo.criteriaText }), verdictInfo.winnerText && _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: verdictInfo.winnerText }), item.route && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', ...toneChip('neutral') }, children: tFormat(t['recent.route.badge'], { stage: item.route.stage, destination: item.route.destination }) }), item.stats.usageIncomplete === true && _jsx("span", { style: { padding: '1px 5px', borderRadius: 4, fontSize: 11, ...toneChip('warn') }, children: t['recent.detail.usageIncomplete'] })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: 12 }, children: duration(item.durationMs) }), _jsx("div", { style: { ...muted, marginTop: 3 }, children: dateTime(item.startedAt, lang) })] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0 15px' }, children: [_jsx("button", { type: "button", "aria-expanded": snapshot?.id === item.id, onClick: () => void toggleSnapshot(item.id), style: { fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)', border: '1px solid var(--dsw-alias-border-l2)' }, children: snapshot?.id === item.id ? t['recent.decisionHide'] : t['recent.decision'] }), _jsx("button", { type: "button", "aria-expanded": detailsOpen, onClick: () => setOpenDetails(current => current === item.id ? null : item.id), style: { fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)', border: '1px solid var(--dsw-alias-border-l2)' }, children: detailsOpen ? t['recent.detailsHide'] : t['recent.details'] })] }), snapshot?.id === item.id && _jsxs("div", { style: panelStyle, children: [snapshot.error !== undefined && _jsx("div", { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' }, children: snapshot.error }), snapshot.record === undefined && snapshot.error === undefined && _jsx("div", { style: { ...muted, fontSize: 11 }, children: t['recent.decisionLoading'] }), snapshot.record !== undefined && snapshot.record.calls.length === 0 && _jsx("div", { style: { ...muted, fontSize: 11 }, children: t['recent.decisionEmpty'] }), (snapshot.record?.calls ?? []).map((call, index) => _jsxs("div", { style: { marginBottom: index === snapshot.record.calls.length - 1 ? 0 : 10 }, children: [_jsxs("div", { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }, children: [call.label, " \u00B7 ", call.channel, call.score === undefined ? '' : ' · ' + formatPercentage(call.score)] }), _jsx("div", { style: { fontSize: 11, marginTop: 4 }, children: t['recent.decisionPrompt'] }), _jsx("pre", { style: { margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--dsw-alias-markdown-code-block)', padding: '6px 8px', borderRadius: 6 }, children: call.prompt }), _jsx("div", { style: { fontSize: 11, marginTop: 4 }, children: t['recent.decisionOutput'] }), _jsx("pre", { style: { margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--dsw-alias-markdown-code-block)', padding: '6px 8px', borderRadius: 6 }, children: call.output })] }, index))] }), detailsOpen && _jsxs("div", { style: panelStyle, children: [(item.verdict?.criteria?.length ?? 0) > 0 && _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) auto auto', gap: '4px 14px', marginBottom: 8 }, children: [_jsx("strong", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: t['recent.detail.criterion'] }), _jsx("strong", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: t['recent.detail.score'] }), _jsx("strong", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: t['recent.detail.threshold'] }), item.verdict.criteria.map(criterion => {
                                                                                const threshold = typeof item.verdict.threshold === 'number' ? item.verdict.threshold : undefined;
                                                                                const missed = threshold !== undefined && criterion.score < threshold;
                                                                                return _jsxs(Fragment, { children: [_jsx("span", { children: criterion.id }), _jsx("span", { style: { color: missed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' }, children: formatPercentage(criterion.score) }), _jsx("span", { style: { color: 'var(--dsw-alias-label-secondary)' }, children: threshold === undefined ? '—' : formatPercentage(threshold) })] }, criterion.id);
                                                                            })] }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 10, color: 'var(--dsw-alias-label-secondary)' }, children: [_jsx("span", { children: tFormat(t['recent.detail.calls'], { calls: compact(item.stats.calls, lang) }) }), _jsx("span", { children: tFormat(t['recent.detail.tokens'], { input: compact(item.stats.inputTokens, lang), cached: compact(item.stats.cachedInputTokens, lang), output: compact(item.stats.outputTokens, lang) }) }), _jsx("span", { children: tFormat(t['recent.detail.scoreCache'], { hits: compact(item.stats.cacheHits, lang), misses: compact(item.stats.cacheMisses, lang) }) }), _jsx("span", { children: tFormat(t['recent.detail.prefixCache'], { rate: ((item.stats.inputTokens + item.stats.cachedInputTokens) > 0 ? (100 * item.stats.cachedInputTokens / (item.stats.inputTokens + item.stats.cachedInputTokens)).toFixed(0) : '0') + '%' }) }), _jsx("span", { children: tFormat(t['recent.detail.cost'], { cost: money(item.stats.estimatedCostUsd) }) }), item.route && _jsx("span", { children: tFormat(t['recent.detail.route'], { cycle: item.route.cycleId, trigger: item.route.trigger, stage: item.route.stage, destination: item.route.destination, attempt: item.route.attempt ?? 1 }) }), item.route && item.route.reservedCalls !== undefined && _jsx("span", { children: tFormat(t['recent.detail.routeReserved'], { reserved: compact(item.route.reservedCalls, lang), actual: compact(item.stats.calls, lang) }) }), item.route?.skipReason !== undefined && _jsx("span", { children: tFormat(t['recent.detail.routeSkip'], { reason: item.route.skipReason }) }), item.route?.replayed !== undefined && _jsx("span", { children: tFormat(t['recent.detail.routeProcess'], { replayed: item.route.replayed === 'candidate' ? t['recent.detail.replayCandidate'] : item.route.replayed === 'original' ? t['recent.detail.replayOriginal'] : t['recent.detail.replayNone'], generated: compact(item.route.generatedCalls ?? 0, lang), judges: compact(item.route.judgeCalls ?? 0, lang) }) }), item.route?.sameCandidate === true && _jsx("span", { children: t['recent.detail.routeSameCandidate'] }), item.route?.alternativeAugmented === true && _jsx("span", { children: t['recent.detail.routeAugmented'] }), item.route?.alternativeModel !== undefined && _jsx("span", { children: tFormat(t['recent.detail.routeAlternativeModel'], { model: item.route.alternativeModel }) }), (item.stats.channelFallbacks ?? 0) > 0 && _jsx("span", { children: tFormat(t['recent.detail.channelFallback'], { count: compact(item.stats.channelFallbacks ?? 0, lang) }) })] })] })] }, item.id);
                                                }), (data?.recent.length ?? 0) === 0 && _jsx("div", { style: { padding: 24, textAlign: 'center', ...muted }, children: t['recent.empty'] })] })] }), _jsxs("div", { style: { ...dashboardCard, padding: '18px' }, children: [_jsx("strong", { children: t['models.title'] }), _jsxs("div", { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }, children: [(data?.models ?? []).map(model => _jsxs("div", { style: { padding: '11px 12px', borderRadius: 10, background: 'var(--dsw-alias-interactive-bg-hover)' }, children: [_jsx("div", { style: { fontWeight: 650, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }, children: model.model }), _jsx("div", { style: { ...muted, marginTop: 3 }, children: model.provider }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 12 }, children: [_jsx("span", { children: tFormat(t['models.calls'], { calls: compact(model.calls, lang) }) }), _jsx("span", { children: tFormat(t['models.tokens'], { tokens: compact(model.tokens, lang) }) }), _jsx("strong", { children: money(model.estimatedCostUsd) })] })] }, model.provider + '\0' + model.model)), (data?.models.length ?? 0) === 0 && _jsx("div", { style: muted, children: t['models.empty'] })] })] })] }), processCycles.length > 0 && _jsxs("section", { style: { ...dashboardCard, padding: '18px 20px 16px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }, children: [_jsx("strong", { children: t['processCycles.title'] }), _jsx("span", { style: muted, children: tFormat(t['processCycles.note'], { count: processCycles.length }) })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }, children: processCycles.map(cycle => _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'var(--dsw-alias-interactive-bg-hover)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, children: [_jsx("span", { title: cycle.cycleId, style: { fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--dsw-alias-label-secondary)' }, children: tFormat(t['processCycles.cycle'], { cycle: shortCycleId(cycle.cycleId) }) }), cycle.startedAt > 0 && _jsx("span", { style: muted, children: dateTime(cycle.startedAt, lang) }), cycle.rows > 1 && _jsx("span", { style: muted, children: tFormat(t['processCycles.rows'], { rows: cycle.rows }) })] }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }, children: cycle.stages.map((stage, index) => _jsxs(Fragment, { children: [index > 0 && _jsx("span", { "aria-hidden": "true", style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }, children: "\u2192" }), _jsx("span", { style: { padding: '1px 6px', borderRadius: 4, fontSize: 11, ...toneChip(stage.tone) }, children: stage.text })] }, stage.stage)) })] }, cycle.cycleId)) })] })] })] }) });
}
export function VerifierSidebarIcon({ size, active }) {
    return _jsx("span", { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, color: active ? 'var(--dsw-alias-state-business-primary)' : 'currentColor' }, children: _jsx(IconData, { size: Math.min(18, size) }) });
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
/** Poll interval of the chat chip while a turn runs (the answer is in-memory and cheap). */
export const VERIFIER_ACTIVITY_POLL_MS = 1_000;
/**
 * Read what the plugin is doing for one session (P06 cycle, routed review, final acceptance).
 *
 * The chip explains a pause the chat cannot explain by itself, so a failed or refused read is
 * SILENCE, never an error banner: the composer must not grow noise because a dashboard endpoint was
 * unavailable.
 * @param rpc - the host RPC handle, when the client exposes one.
 * @param sessionId - the session to ask about.
 * @param signal - abort signal of the owning effect.
 * @returns The activity view, or null when there is nothing (or nothing readable).
 */
async function readVerifierActivity(rpc, sessionId, signal) {
    // The wire kind is historical (it once meant P06 only) and is kept so a page holding the older
    // client bundle keeps talking to the same endpoint.
    const payload = { kind: 'process', sessionId };
    try {
        if (rpc && typeof rpc.call === 'function') {
            try {
                const result = await rpc.call('/api', 'llm-verifier/statistics', payload, signal);
                if (result && result.ok === true)
                    return result.value;
                if (result && result.ok === false)
                    return null;
            }
            catch (rpcError) {
                if (signal.aborted)
                    return null;
                console.warn('[llm-verifier] activity rpc.call failed, trying fetch fallback:', rpcError);
            }
        }
        const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
        const body = await response.json().catch(() => undefined);
        const value = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined;
        return value === undefined || value === null ? null : value;
    }
    catch {
        return null;
    }
}
/**
 * Dock-card geometry, copied from the host's own composer-stack cards (Todo/Goal/Queue).
 *
 * Those cards share one width axis — the chat content column minus the composer clearances and the
 * four dock insets — and the fallbacks below only matter on a host that does not publish the three
 * custom properties. Without this clamp the status line stretches to the window edge and its text
 * sits far left of the composer it belongs to, which is exactly the misplacement it is here to fix.
 *
 * ONE element owns BOTH the dock-column width and the card surface. The composer stack is a host
 * region a host or skin stylesheet may paint (the dock row, for instance with the tip surface), and
 * a wider wrapper that paints no background of its own would show that paint as a mask reaching
 * well past the card on both sides. The surface here is declared inline, so it is itself the card:
 * a background can never be painted outside the border box it is declared on.
 */
const activityCard = {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: 'calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))',
    maxWidth: 'calc(var(--dsh-composer-card-max-width, 952px) - 4 * var(--dsh-composer-dock-inset, 8px))',
    height: 36,
    margin: '0 auto',
    padding: '0 12px',
    border: '0.5px solid var(--dsw-alias-border-l1)',
    borderRadius: 12,
    background: 'var(--dsw-specific-tip)',
};
const activityTextStyle = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-secondary)',
};
/**
 * The chat-visible half of the automatic stages: what the plugin is doing for this session right now.
 *
 * It answers the pauses the chat cannot explain: a P06 cycle buffers the reply, a routed review and
 * the final acceptance hold the turn open while the judges run, and a PASSING acceptance otherwise
 * says nothing at all. Polls only while a read can change the answer — while the turn runs, and
 * while something is still being shown — so an idle conversation makes no requests.
 * @param props - the input-dock owner values (the session snapshot) plus the injected RPC handle.
 */
export function VerifierActivityChip({ session, rpc }) {
    const lang = useLanguage();
    const t = dictionaries[lang];
    const raw = session?.sessionId;
    const sessionId = raw === undefined || raw === null || String(raw) === '' ? undefined : String(raw);
    const running = session?.running === true;
    const [view, setView] = useState(null);
    const rendered = verifierActivityText(view, t);
    // Keyed on whether anything is RENDERED rather than on whether a read answered: an empty view has
    // to stop the polling too, or a conversation that once ran a cycle would poll forever.
    const showing = rendered !== null;
    useEffect(() => {
        if (sessionId === undefined) {
            setView(null);
            return;
        }
        if (!running && !showing) {
            setView(null);
            return;
        }
        let cancelled = false;
        const controller = new AbortController();
        const load = async () => {
            const value = await readVerifierActivity(rpc, sessionId, controller.signal);
            if (!cancelled)
                setView(value);
        };
        void load();
        const timer = setInterval(() => { void load(); }, VERIFIER_ACTIVITY_POLL_MS);
        return () => { cancelled = true; clearInterval(timer); controller.abort(); };
    }, [sessionId, running, showing, rpc]);
    if (rendered === null)
        return null;
    const dotState = rendered.tone === 'busy' ? 'ongoing' : rendered.tone === 'ok' ? 'done' : 'error';
    return (_jsxs("div", { style: activityCard, role: "status", "aria-live": "polite", children: [_jsx(StateDot, { state: dotState, size: 8 }), _jsx("span", { style: activityTextStyle, children: rendered.text })] }));
}
/**
 * Marker the blank-composer takeover elects with; the value itself is never read.
 *
 * Any non-null selector result elects the entry, so a shared frozen object keeps the selector pure
 * and allocation-free.
 */
const BLANK_COMPOSER = Object.freeze({ blank: true });
export function apply(ctx) {
    const connection = ctx.get('connection');
    const remote = ctx.remote;
    /**
     * Collapse the resident composer while the statistics View is the active one.
     *
     * The Conversation shell renders its composer for EVERY View — a View can only opt into the
     * overlay geometry (`data-conversation-composer-overlay`), never into its absence — so the input
     * card covers the very table the dashboard exists to show. The selector-routed composer chain is
     * the host's own replacement point: while this View is mounted one entry elects an empty
     * composer, and disposing that entry on unmount restores the real card with its draft intact.
     * Tried LAST (`priority` is ascending) so a pending approval, question or subagent takeover still
     * wins the seat. A host that does not know the key leaves the composer in place instead of
     * failing the page.
     * @returns Disposer that hands the seat back to the resident composer.
     */
    const blankComposerSeat = () => {
        try {
            const dispose = ctx.slots.register({
                name: 'conversation.composer',
                id: 'llm-verifier-blank',
                priority: 1000,
                select: () => BLANK_COMPOSER,
            }, (() => null));
            return typeof dispose === 'function' ? dispose : () => { };
        }
        catch (error) {
            console.warn('[llm-verifier] composer takeover registration failed:', error);
            return () => { };
        }
    };
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
        inject: () => ({ rpc: connection.rpc, blankComposerSeat }),
    }, StatisticsPage));
    // P06 buffers the main reply (the chat looks frozen) and the routed/final stages hold the turn
    // open with nothing to show. The dock sits directly above the composer — where the user is already
    // looking — and disappears on its own.
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'llm-verifier-activity',
        order: 30,
        inject: () => ({ rpc: connection.rpc }),
    }, VerifierActivityChip));
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
                        // The host keys each guide cell by this id and hands it to the owner as `entryId`, so an
                        // entry without one renders as `undefined` — a stable literal keeps the cell identified.
                        id: VERIFIER_TAB_ID,
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