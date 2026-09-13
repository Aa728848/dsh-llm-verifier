import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconDataOutline16, IconRefreshOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage,
  compact, money, duration, dateTime, type I18nDict,
  type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave,
  WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, WORST_CASE_CRITERIA_PER_COMPARISON,
  computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState,
  evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails,
} from './client-i18n.ts'
import { CRITERIA_PRESETS, DEFAULT_GROUND_TRUTH_NOTE, buildPairwisePrompt } from './core.ts'
import {
  type ExtraJudgeDraft,
  MAX_EXTRA_JUDGES,
  normalizeExtraJudges,
  judgeIdentity,
  judgeConflict,
  addExtraJudge,
  removeExtraJudge,
  serializeExtraJudges,
} from './client-judges.ts'

export {
  zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict,
  type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE,
  computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed,
  formatPercentage, formatVerdictDetails,
}

const NS = 'llm-verifier'
interface DecisionCallView { label: string; channel: string; prompt: string; output: string; score?: number }
interface DecisionRecordView { id: string; toolName: string; phase: string; provider: string; model: string; startedAt: number; calls: DecisionCallView[] }

export interface Values { enabled: boolean; captureDecisions: boolean; autoProcessSelection: boolean; autoVerifyMode: 'manual'|'smart'|'strict'; autoVerifyThreshold: number; autoVerifyRepeats: number; autoTrackRepeats: number; autoVerifyFinalRepeats: number; autoVerifyMinToolCalls: number; autoVerifyMaxChars: number; autoVerifyMaxPerTask: number; autoVerifyMaxPerSession: number; autoRouteSemantic: boolean; autoRouteMinConfidence: number; autoRouteMaxCandidates: number; autoRouteMaxPerTask: number; autoRouteMaxPerSession: number; autoTrackCompletionThreshold: number; autoRouteMaxItemChars: number; autoRouteMaxInputChars: number; autoMaxModelCallsPerTask: number; autoMaxModelCallsPerSession: number; autoVerifyTeamTasks: boolean; autoVerifyPlanMode: boolean; criteriaPreset: 'coding'|'debug'|'research'|'ops'|'writing'|'custom'; criteriaFile: string; provider: string; model: string; reasoningEffort?: string; maxTokens: number; temperature: number; label?: string; maxConcurrency: number; maxRetries: number; retryBaseDelayMs: number; timeoutMs: number; cacheDir: string; cacheMaxEntries: number; estimatedInputUsdPerMillion: number; estimatedOutputUsdPerMillion: number; autoVerifySubagents: boolean; extraJudges: ExtraJudgeDraft[] }
export interface Loaded { groups: readonly ModelProviderGroup[]; settings: SettingsNamespaceView; writable: boolean; failures: string[] }
export interface RunStats { calls: number; attempts: number; retries: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number; topLogprobScores: number; explicitTagScores: number; usageIncomplete?: boolean; channelFallbacks?: number }
/** S05-A routing-cycle observation, as persisted on the record (all fields optional/lenient). */
export interface RouteObservationView { cycleId: string; trigger: string; stage: string; destination: string; attempt?: number; reservedCalls?: number; skipReason?: string; canceled?: boolean; usageIncomplete?: boolean; evidenceKept?: number; evidenceOmitted?: number; evidenceChars?: number; replayed?: string; generatedCalls?: number; judgeCalls?: number; sameCandidate?: boolean }
export interface InvocationRecord { id: string; toolName: string; sessionId?: string; startedAt: number; finishedAt: number; durationMs: number; success: boolean; errorName?: string; errorMessage?: string; provider: string; model: string; stats: RunStats; verdict?: VerdictSummary; route?: RouteObservationView }
interface DailyStatistics { date: string; invocations: number; successes: number; failures: number; calls: number; tokens: number; estimatedCostUsd: number; byTool: Record<string, number> }
interface ToolStatistics { toolName: string; invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; calls: number; tokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number }
interface ModelStatistics { provider: string; model: string; invocations: number; calls: number; tokens: number; estimatedCostUsd: number }
interface Totals extends RunStats { invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; tokens: number; cacheHitRate: number; prefixCacheHitRate: number }
interface StatisticsOverview { generatedAt: number; fromMs: number; toMs: number; sessionId?: string; totals: Totals; daily: DailyStatistics[]; tools: ToolStatistics[]; models: ModelStatistics[]; recent: InvocationRecord[] }
interface VerifierRemote {
  session: {
    modelCatalog(): Promise<{
      ok: boolean
      value: { groups: readonly ModelProviderGroup[]; failures: readonly { id?: string; provider?: string; name?: string; message: string }[] }
      error: { message: string }
    }>
  }
  settings: {
    describe(): Promise<{
      ok: boolean
      value: { writable: boolean; namespaces: readonly SettingsNamespaceView[] }
      error: { message: string }
    }>
    update(
      ns: string,
      patch: Record<string, unknown>,
      expectedRevision: number | undefined,
    ): Promise<{
      ok: boolean
      value: SettingsNamespaceView
      error: { message: string }
    }>
  }
}

export interface JudgeProbeView { label: string; provider: string; model: string; ok: boolean; channel?: string; channelProbed?: boolean; scoreA?: number; scoreB?: number; latencyMs: number; calls?: number; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; error?: string }
export interface ProbeResultView { judges: JudgeProbeView[]; channelProbed?: boolean; rubric: { source: string; count: number; file?: string; error?: string } }

interface VerifierSettingsProps { remote: VerifierRemote }
interface StatisticsPageProps {
  sessionId?: string
  isGlobal?: boolean
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
  }
}

const shell: React.CSSProperties = { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12, padding: '0 0 32px', color: 'var(--dsw-alias-label-primary)' }
const settingsHeading: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' }
const settingsIntro: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' }
const group: React.CSSProperties = { width: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--dsw-alias-border-l2)' }
const groupTitle: React.CSSProperties = { margin: 0, padding: '18px 0 8px', fontSize: 14, fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const row: React.CSSProperties = { minHeight: 64, display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(230px, 288px)', gap: 24, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const selectStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: 36, padding: '0 34px 0 12px', borderRadius: 8, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-input)', border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 14, lineHeight: '22px', outline: 'none' }
const toggleStyle = (enabled: boolean): React.CSSProperties => ({ position: 'relative', justifySelf: 'end', width: 40, height: 22, padding: 0, border: 0, borderRadius: 999, cursor: 'pointer', transition: 'background .15s ease', background: enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-input)' })
const toggleThumbStyle = (enabled: boolean): React.CSSProperties => ({ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-static-neutral-00, #fff)', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left .15s ease' })
const dashboardCard: React.CSSProperties = { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.13))', background: 'color-mix(in srgb, var(--dsw-alias-bg-module, #171925) 88%, transparent)', borderRadius: 16, boxShadow: '0 12px 36px rgba(0,0,0,.12)' }
const muted: React.CSSProperties = { color: 'var(--dsw-text-secondary)', fontSize: 12 }
const toolColors: Record<string, string> = { verifier_route_classify: '#d97706', verifier_compare: '#4f8cff', verifier_select: '#8b6df6', verifier_track: '#2fc5c9', verifier_best_of_n: '#e2569b', verifier_current_session: '#f5a524' }

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function values(view: SettingsNamespaceView): Values { const v=record(view.value); const mode=v.autoVerifyMode==='manual'||v.autoVerifyMode==='strict'?v.autoVerifyMode:'smart'; return { enabled:v.enabled!==false,captureDecisions:v.captureDecisions!==false,autoProcessSelection:v.autoProcessSelection===true,autoVerifyMode:mode,autoVerifyThreshold:Number(v.autoVerifyThreshold??.65),autoVerifyRepeats:Number(v.autoVerifyRepeats??1),autoTrackRepeats:Number(v.autoTrackRepeats??3),autoVerifyFinalRepeats:Number(v.autoVerifyFinalRepeats??2),autoVerifyMinToolCalls:Number(v.autoVerifyMinToolCalls??3),autoVerifyMaxChars:Number(v.autoVerifyMaxChars??80000),autoVerifyMaxPerTask:Number(v.autoVerifyMaxPerTask??2),autoVerifyMaxPerSession:Number(v.autoVerifyMaxPerSession??8),autoRouteSemantic:v.autoRouteSemantic!==false,autoRouteMinConfidence:Number(v.autoRouteMinConfidence??.9),autoRouteMaxCandidates:Number(v.autoRouteMaxCandidates??8),autoRouteMaxPerTask:Number(v.autoRouteMaxPerTask??2),autoRouteMaxPerSession:Number(v.autoRouteMaxPerSession??8),autoTrackCompletionThreshold:Number(v.autoTrackCompletionThreshold??.684),autoRouteMaxItemChars:Number(v.autoRouteMaxItemChars??20000),autoRouteMaxInputChars:Number(v.autoRouteMaxInputChars??60000),autoMaxModelCallsPerTask:Number(v.autoMaxModelCallsPerTask??96),autoMaxModelCallsPerSession:Number(v.autoMaxModelCallsPerSession??240),autoVerifyTeamTasks:v.autoVerifyTeamTasks!==false,autoVerifyPlanMode:v.autoVerifyPlanMode!==false,criteriaPreset:(v.criteriaPreset==='debug'||v.criteriaPreset==='research'||v.criteriaPreset==='ops'||v.criteriaPreset==='writing'||v.criteriaPreset==='custom')?v.criteriaPreset:'coding',criteriaFile:typeof v.criteriaFile==='string'?v.criteriaFile.trim():'',provider:String(v.provider??''),model:String(v.model??''),...(typeof v.reasoningEffort==='string'?{reasoningEffort:v.reasoningEffort}:{}),maxTokens:Number(v.maxTokens??32768),temperature:Number(v.temperature??0.2),...(typeof v.label==='string'&&v.label.trim()?{label:v.label.trim()}:{}),maxConcurrency:Number(v.maxConcurrency??8),maxRetries:Number(v.maxRetries??3),retryBaseDelayMs:Number(v.retryBaseDelayMs??500),timeoutMs:Number(v.timeoutMs??300000),cacheDir:typeof v.cacheDir==='string'&&v.cacheDir.trim()?v.cacheDir.trim():'verifier',cacheMaxEntries:Number(v.cacheMaxEntries??10000),estimatedInputUsdPerMillion:Number(v.estimatedInputUsdPerMillion??0),estimatedOutputUsdPerMillion:Number(v.estimatedOutputUsdPerMillion??0),autoVerifySubagents:v.autoVerifySubagents===true,extraJudges:normalizeExtraJudges(v.extraJudges) } }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
/** The endpoint answered but rejected the request: a transport fallback would only repeat it. */
class EndpointError extends Error {}
function Label({title,help}:{title:string;help:string}) { return <div style={{minWidth:0}}><div style={{fontSize:14,fontWeight:400,lineHeight:'22px',color:'var(--dsw-alias-label-primary)'}}>{title}</div><div style={{fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-label-tertiary)',marginTop:2}}>{help}</div></div> }
function GroupTitle({children}:{children:React.ReactNode}) { return <h3 style={groupTitle}>{children}</h3> }
function startOfRange(days: number): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - days + 1); return date.getTime() }
function endOfToday(): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() + 1); return date.getTime() }

export function VerifierSettings({ remote }: VerifierSettingsProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const [loaded,setLoaded]=useState<Loaded|null>(null); const [draft,setDraft]=useState<Values|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false); const [editing,setEditing]=useState<Record<string,string>>({})
  const load=async()=>{setError(null);try{const [m,s]=await Promise.all([remote.session.modelCatalog(),remote.settings.describe()]);if(!m.ok)throw new Error(m.error.message);if(!s.ok)throw new Error(s.error.message);const view=s.value.namespaces.find((x:SettingsNamespaceView)=>x.ns===NS);if(!view)throw new Error(t['settings.nsUnregistered']);const next={groups:m.value.groups,settings:view,writable:s.value.writable,failures:m.value.failures.map((f: { id?: string; provider?: string; name?: string; message: string })=>(f.id??f.provider??f.name??'unknown')+': '+f.message)};setLoaded(next);setDraft(values(view));setEditing({})}catch(e){setError(message(e))}}
  useEffect(()=>{void load()},[])
  const dirty=useMemo(()=>loaded!==null&&draft!==null&&!sameSettingValue(draft,values(loaded.settings)),[loaded,draft])
  // Another writer — the settings shell's reset, a second window, an edit to
  // settings.yaml — can move this namespace under a page that never re-reads
  // it, and the stale draft would then be written straight back on the next
  // save. Re-read whenever the page regains focus, but only while the draft
  // holds no unsaved edit: a pending edit belongs to the user, and the
  // revision check on save still rejects a write that raced a moved namespace.
  const latest=useRef({loaded,draft})
  latest.current={loaded,draft}
  useEffect(()=>{
    const sync=()=>{
      if(document.visibilityState==='hidden')return
      const {loaded:at,draft:local}=latest.current
      if(!at||!local)return
      if(!sameSettingValue(local,values(at.settings)))return
      void (async()=>{
        try{
          const s=await remote.settings.describe()
          if(!s.ok)return
          const view=s.value.namespaces.find((x:SettingsNamespaceView)=>x.ns===NS)
          if(!view||view.revision===at.settings.revision)return
          const next:Loaded={...at,settings:view,writable:s.value.writable}
          latest.current={loaded:next,draft:values(view)}
          setLoaded(next);setDraft(values(view));setEditing({});setSaved(false)
        }catch{/* keep the last good view; the reload button still forces a read */}
      })()
    }
    window.addEventListener('focus',sync)
    document.addEventListener('visibilitychange',sync)
    return ()=>{window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync)}
  },[remote])
  const models=useMemo(()=>loaded?.groups.find(g=>g.id===draft?.provider)?.models??[],[loaded,draft?.provider])
  const selected=models.find(m=>m.id===draft?.model); const efforts=selected?.reasoning?.efforts??[]
  const patch=<K extends keyof Values>(key:K,value:Values[K])=>{setSaved(false);setDraft(v=>v?{...v,[key]:value}:v)}
  const conflict = useMemo(() => (draft ? judgeConflict({ provider: draft.provider, model: draft.model }, draft.extraJudges) : undefined), [draft?.provider, draft?.model, draft?.extraJudges])
  const addJudge = () => {
    if (!loaded || !draft || draft.extraJudges.length >= MAX_EXTRA_JUDGES) return
    const firstGroup = loaded.groups[0]
    const firstProvider = firstGroup?.id ?? ''
    const firstModelObj = firstGroup?.models[0]
    const firstModel = firstModelObj?.id ?? ''
    const defaultEffort = firstModelObj?.reasoning?.defaultEffort
    const newJudge: ExtraJudgeDraft = {
      provider: firstProvider,
      model: firstModel,
      ...(defaultEffort ? { reasoningEffort: defaultEffort } : {}),
    }
    patch('extraJudges', addExtraJudge(draft.extraJudges, newJudge))
  }
  const removeJudge = (idx: number) => {
    if (!draft) return
    patch('extraJudges', removeExtraJudge(draft.extraJudges, idx))
  }
  const updateJudge = (idx: number, updates: Partial<ExtraJudgeDraft>) => {
    if (!draft) return
    const next = draft.extraJudges.map((j, i) => (i === idx ? { ...j, ...updates } : j))
    patch('extraJudges', next)
  }
  const budgetWarning = useMemo(() => {
    if (!draft) return null
    // The engine reserves budget from the REAL criteria count. A built-in preset's count is known
    // here; a custom file's is not (it lives on the server), so the estimate falls back to the
    // three-criteria default and the file field's help says as much.
    const criteria = draft.criteriaPreset === 'custom' ? WORST_CASE_CRITERIA_PER_COMPARISON : CRITERIA_PRESETS[draft.criteriaPreset].length
    return evaluateBudgetWarning(
      draft.autoVerifyMode,
      draft.extraJudges.length,
      draft.autoMaxModelCallsPerTask,
      draft.autoMaxModelCallsPerSession,
      criteria,
    )
  }, [draft?.autoVerifyMode, draft?.criteriaPreset, draft?.extraJudges.length, draft?.autoMaxModelCallsPerTask, draft?.autoMaxModelCallsPerSession])
  // The saved section holds only real overrides: a draft field equal to the
  // composition base is dropped so a later plugin default still reaches this
  // install (see sectionForSave).
  const save=async()=>{
    if(!loaded||!draft||conflict)return
    setBusy(true);setSaved(false);setError(null)
    try{
      // An explicit undefined means "clear the stored override": sectionForSave
      // starts from the previous user layer, so simply omitting a key would let
      // the stale override outlive the save that cleared it.
      const editable:Record<string,unknown>={
        ...draft,
        extraJudges:serializeExtraJudges(draft.extraJudges),
        reasoningEffort:draft.reasoningEffort||undefined,
        label:draft.label?.trim()||undefined,
        cacheDir:resolveCacheDirOnSave(draft.cacheDir,values(loaded.settings).cacheDir),
      }
      const base=loaded.settings.base===undefined?undefined:record(loaded.settings.base)
      const section=sectionForSave(record(loaded.settings.user),editable,base)
      const res=await remote.settings.update(NS,section as never,loaded.settings.revision)
      if(!res.ok)throw new Error(res.error.message)
      setLoaded(v=>v?{...v,settings:res.value}:v);setDraft(values(res.value));setEditing({});setSaved(true)
    }catch(e){setError(message(e))}finally{setBusy(false)}
  }
  if(!loaded||!draft)return <div style={shell}><h2 style={settingsHeading}>{t['settings.title']}</h2><p style={settingsIntro}>{error??t['settings.loading']}</p>{error&&<div><Button variant="outline" onClick={()=>void load()}>{t['settings.retry']}</Button></div>}</div>
  // Fractional settings are typed character by character, so the raw text is
  // kept while the field has focus: a controlled type="number" input rewrites
  // "0." back to "0" and swallows the decimal point. The parsed value is
  // committed on every keystroke that parses, and blur restores canonical text.
  const numeric=(key:keyof Values,min=0)=><Input
    style={{width:'100%',height:36,borderRadius:8}}
    type="text"
    inputMode="decimal"
    disabled={busy}
    aria-label={(t[('field.'+key+'.title') as keyof I18nDict] as string|undefined)??String(key)}
    value={editing[key]??String(draft[key]??'')}
    onChange={e=>{const raw=e.target.value;setEditing(current=>current[key]===raw?current:{...current,[key]:raw});const parsed=Number(raw);if(raw.trim()!==''&&Number.isFinite(parsed)&&parsed>=min)patch(key,parsed as never)}}
    onBlur={()=>setEditing(current=>{if(!(key in current))return current;const next={...current};delete next[key];return next})}
  />
  const textField=(key:keyof Values,placeholder?:string)=><Input
    style={{width:'100%',height:36,borderRadius:8}}
    type="text"
    disabled={busy}
    placeholder={placeholder}
    aria-label={(t[('field.'+key+'.title') as keyof I18nDict] as string|undefined)??String(key)}
    value={String(draft[key]??'')}
    onChange={e=>patch(key,e.target.value as never)}
  />
  return <div style={shell}>
    <h2 style={settingsHeading}>{t['settings.title']}</h2>
    <p style={settingsIntro}>{t['settings.intro']}</p>

    <section style={group}><GroupTitle>{t['section.tools']}</GroupTitle>
      <div style={row}><Label title={t['field.enabled.title']} help={draft.enabled?t['field.enabled.helpOn']:t['field.enabled.helpOff']}/><button type="button" role="switch" aria-checked={draft.enabled} aria-label={t['field.enabled.title']} onClick={()=>patch('enabled',!draft.enabled)} style={toggleStyle(draft.enabled)}><span style={toggleThumbStyle(draft.enabled)}/></button></div>
      {!draft.enabled&&<p style={{margin:'8px 0 0',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{t['field.enabled.warnDisabled']}</p>}
    </section>

    <section style={group}><GroupTitle>{t['section.autoVerify']}</GroupTitle>
      <div style={row}><Label title={t['field.autoVerifyMode.title']} help={t['field.autoVerifyMode.help']}/><select style={selectStyle} disabled={busy} aria-label={t['field.autoVerifyMode.title']} value={draft.autoVerifyMode} onChange={e=>patch('autoVerifyMode',e.target.value as Values['autoVerifyMode'])}><option value="manual">{t['field.autoVerifyMode.manual']}</option><option value="smart">{t['field.autoVerifyMode.smart']}</option><option value="strict">{t['field.autoVerifyMode.strict']}</option></select></div>
      <div style={row}><Label title={t['field.criteriaPreset.title']} help={t['field.criteriaPreset.help']}/><select style={selectStyle} disabled={busy} aria-label={t['field.criteriaPreset.title']} value={draft.criteriaPreset} onChange={e=>patch('criteriaPreset',e.target.value as Values['criteriaPreset'])}>{(['coding','debug','research','ops','writing','custom'] as const).map(id=><option key={id} value={id}>{t[('field.criteriaPreset.'+id) as keyof I18nDict] as string}</option>)}</select></div>
      {draft.criteriaPreset==='custom'&&<div style={row}><Label title={t['field.criteriaFile.title']} help={t['field.criteriaFile.help']}/>{textField('criteriaFile','criteria/my-task.md')}</div>}
      {draft.criteriaPreset!=='custom'&&(()=>{const preset=CRITERIA_PRESETS[draft.criteriaPreset];const first=preset[0];if(!first)return null;return <details style={{margin:'2px 0 0 4px',fontSize:12}}><summary style={{cursor:'pointer',color:'var(--dsw-text-secondary)'}}>{tFormat(t['field.criteriaPreset.previewSummary'],{count:preset.length})}</summary><pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:240,overflow:'auto',background:'var(--dsw-surface-sunken)',border:'1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))',borderRadius:8,padding:10,marginTop:8}}>{buildPairwisePrompt(t['field.criteriaPreset.sampleTask'],t['field.criteriaPreset.sampleA'],t['field.criteriaPreset.sampleB'],first,DEFAULT_GROUND_TRUTH_NOTE)}</pre></details>})()}
      <div style={row}><Label title={t['field.autoRouteSemantic.title']} help={t['field.autoRouteSemantic.help']}/><button type="button" role="switch" aria-checked={draft.autoRouteSemantic} aria-label={t['field.autoRouteSemantic.title']} onClick={()=>patch('autoRouteSemantic',!draft.autoRouteSemantic)} style={toggleStyle(draft.autoRouteSemantic)}><span style={toggleThumbStyle(draft.autoRouteSemantic)}/></button></div>
      <div style={row}><Label title={t['field.autoVerifyTeamTasks.title']} help={t['field.autoVerifyTeamTasks.help']}/><button type="button" role="switch" aria-checked={draft.autoVerifyTeamTasks} aria-label={t['field.autoVerifyTeamTasks.title']} onClick={()=>patch('autoVerifyTeamTasks',!(draft.autoVerifyTeamTasks))} style={toggleStyle(draft.autoVerifyTeamTasks)}><span style={toggleThumbStyle(draft.autoVerifyTeamTasks)}/></button></div>
      <div style={row}><Label title={t['field.captureDecisions.title']} help={t['field.captureDecisions.help']}/><button type="button" role="switch" aria-checked={draft.captureDecisions} aria-label={t['field.captureDecisions.title']} onClick={()=>patch('captureDecisions',!draft.captureDecisions)} style={toggleStyle(draft.captureDecisions)}><span style={toggleThumbStyle(draft.captureDecisions)}/></button></div>
      <div style={row}><Label title={t['field.autoVerifySubagents.title']} help={t['field.autoVerifySubagents.help']}/><button type="button" role="switch" aria-checked={draft.autoVerifySubagents} aria-label={t['field.autoVerifySubagents.title']} onClick={()=>patch('autoVerifySubagents',!draft.autoVerifySubagents)} style={toggleStyle(draft.autoVerifySubagents)}><span style={toggleThumbStyle(draft.autoVerifySubagents)}/></button></div>
      <div style={row}><Label title={t['field.autoVerifyPlanMode.title']} help={t['field.autoVerifyPlanMode.help']}/><button type="button" role="switch" aria-checked={draft.autoVerifyPlanMode} aria-label={t['field.autoVerifyPlanMode.title']} onClick={()=>patch('autoVerifyPlanMode',!(draft.autoVerifyPlanMode))} style={toggleStyle(draft.autoVerifyPlanMode)}><span style={toggleThumbStyle(draft.autoVerifyPlanMode)}/></button></div>
      <div style={row}><Label title={t['field.autoProcessSelection.title']} help={t['field.autoProcessSelection.help']}/><button type="button" role="switch" aria-checked={draft.autoProcessSelection} aria-label={t['field.autoProcessSelection.title']} onClick={()=>patch('autoProcessSelection',!draft.autoProcessSelection)} style={toggleStyle(draft.autoProcessSelection)}><span style={toggleThumbStyle(draft.autoProcessSelection)}/></button></div>
      <div style={row}><Label title={t['field.autoRouteMinConfidence.title']} help={t['field.autoRouteMinConfidence.help']}/>{numeric('autoRouteMinConfidence',0)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxCandidates.title']} help={t['field.autoRouteMaxCandidates.help']}/>{numeric('autoRouteMaxCandidates',3)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxPerTask.title']} help={t['field.autoRouteMaxPerTask.help']}/>{numeric('autoRouteMaxPerTask',1)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxPerSession.title']} help={t['field.autoRouteMaxPerSession.help']}/>{numeric('autoRouteMaxPerSession',1)}</div>
      <div style={row}><Label title={t['field.autoTrackCompletionThreshold.title']} help={t['field.autoTrackCompletionThreshold.help']}/>{numeric('autoTrackCompletionThreshold',0)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxItemChars.title']} help={t['field.autoRouteMaxItemChars.help']}/>{numeric('autoRouteMaxItemChars',100)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxInputChars.title']} help={t['field.autoRouteMaxInputChars.help']}/>{numeric('autoRouteMaxInputChars',1000)}</div>
      <div style={row}><Label title={t['field.autoMaxModelCallsPerTask.title']} help={t['field.autoMaxModelCallsPerTask.help']}/>{numeric('autoMaxModelCallsPerTask',1)}</div>
      {budgetWarning?.warnTask&&<p style={{margin:'-4px 0 10px',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{tFormat(t['field.autoMaxModelCallsPerTask.warnBudget'],{current:draft.autoMaxModelCallsPerTask,required:budgetWarning.worstCaseTask,judges:budgetWarning.judgeCount})}</p>}
      <div style={row}><Label title={t['field.autoMaxModelCallsPerSession.title']} help={t['field.autoMaxModelCallsPerSession.help']}/>{numeric('autoMaxModelCallsPerSession',1)}</div>
      {budgetWarning?.warnSession&&<p style={{margin:'-4px 0 10px',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{tFormat(t['field.autoMaxModelCallsPerSession.warnBudget'],{current:draft.autoMaxModelCallsPerSession,required:budgetWarning.worstCaseSession,judges:budgetWarning.judgeCount})}</p>}
      <div style={row}><Label title={t['field.autoVerifyThreshold.title']} help={t['field.autoVerifyThreshold.help']}/>{numeric('autoVerifyThreshold',0)}</div>
      <div style={row}><Label title={t['field.autoVerifyRepeats.title']} help={t['field.autoVerifyRepeats.help']}/>{numeric('autoVerifyRepeats',1)}</div>
      <div style={row}><Label title={t['field.autoTrackRepeats.title']} help={t['field.autoTrackRepeats.help']}/>{numeric('autoTrackRepeats',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyFinalRepeats.title']} help={t['field.autoVerifyFinalRepeats.help']}/>{numeric('autoVerifyFinalRepeats',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMinToolCalls.title']} help={t['field.autoVerifyMinToolCalls.help']}/>{numeric('autoVerifyMinToolCalls',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxChars.title']} help={t['field.autoVerifyMaxChars.help']}/>{numeric('autoVerifyMaxChars',1000)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxPerTask.title']} help={t['field.autoVerifyMaxPerTask.help']}/>{numeric('autoVerifyMaxPerTask',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxPerSession.title']} help={t['field.autoVerifyMaxPerSession.help']}/>{numeric('autoVerifyMaxPerSession',1)}</div>
      {draft.autoVerifyMode!=='manual'&&<p style={{margin:'8px 0 0',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{t['field.autoVerify.warnNotice']}</p>}
    </section>

    <section style={group}><GroupTitle>{t['section.model']}</GroupTitle>
      <div style={row}><Label title={t['field.provider.title']} help={t['field.provider.help']}/><select style={selectStyle} disabled={busy} aria-label={t['field.provider.title']} value={draft.provider} onChange={e=>{const provider=e.target.value;const first=loaded.groups.find(g=>g.id===provider)?.models[0];setDraft({...draft,provider,...(first?{model:first.id,reasoningEffort:first.reasoning?.defaultEffort}:{})})}}>{loaded.groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}</select></div>
      <div style={row}><Label title={t['field.model.title']} help={t['field.model.help']}/><select style={selectStyle} disabled={busy} aria-label={t['field.model.title']} value={draft.model} onChange={e=>{const model=e.target.value;const found=models.find(m=>m.id===model);setDraft({...draft,model,...(found?.reasoning?.defaultEffort?{reasoningEffort:found.reasoning.defaultEffort}:{reasoningEffort:undefined})})}}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></div>
      <div style={row}><Label title={t['field.reasoningEffort.title']} help={t['field.reasoningEffort.help']}/><select style={selectStyle} disabled={busy} aria-label={t['field.reasoningEffort.title']} value={draft.reasoningEffort??''} onChange={e=>patch('reasoningEffort',e.target.value||undefined)}><option value="">{t['field.reasoningEffort.default']}</option>{efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      <div style={row}><Label title={t['field.maxTokens.title']} help={t['field.maxTokens.help']}/>{numeric('maxTokens',1)}</div>
      <div style={row}><Label title={t['field.temperature.title']} help={t['field.temperature.help']}/>{numeric('temperature',0)}</div>
      <div style={row}><Label title={t['field.label.title']} help={t['field.label.help']}/><Input style={{width:'100%',height:36,borderRadius:8}} type="text" disabled={busy} placeholder={draft.model||t['field.label.placeholder']} aria-label={t['field.label.title']} value={draft.label??''} onChange={e=>patch('label',e.target.value||undefined)}/></div>
      <div style={{...row,gridTemplateColumns:'minmax(180px, 1fr) auto',minHeight:48}}><Label title={t['field.extraJudges.title']} help={t['field.extraJudges.help']}/><Button variant="outline" disabled={busy||draft.extraJudges.length>=MAX_EXTRA_JUDGES} onClick={addJudge}>{t['field.extraJudges.add']}</Button></div>
      {draft.extraJudges.length>0&&<div style={{display:'flex',flexDirection:'column',gap:8,padding:'10px 0',borderBottom:'1px solid var(--dsw-alias-border-l2)'}}>
        <div style={{display:'grid',gridTemplateColumns:'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto',gap:8,fontSize:12,color:'var(--dsw-alias-label-tertiary)',paddingBottom:2}}>
          <div>{t['field.provider.title']}</div>
          <div>{t['field.model.title']}</div>
          <div>{t['field.reasoningEffort.title']}</div>
          <div>{t['field.extraJudges.labelTitle']}</div>
          <div/>
        </div>
        {draft.extraJudges.map((judge,idx)=>{
          const judgeGroup=loaded.groups.find(g=>g.id===judge.provider)
          const judgeModels=judgeGroup?.models??[]
          const judgeModel=judgeModels.find(m=>m.id===judge.model)
          const judgeEfforts=judgeModel?.reasoning?.efforts??[]
          return <div key={idx} style={{display:'grid',gridTemplateColumns:'minmax(110px, 1.2fr) minmax(120px, 1.3fr) minmax(95px, 1fr) minmax(95px, 1fr) auto',gap:8,alignItems:'center'}}>
            <select style={selectStyle} disabled={busy} aria-label={tFormat(t['field.extraJudges.providerAria'],{index:idx+1})} value={judge.provider} onChange={e=>{
              const newProvider=e.target.value
              const targetGroup=loaded.groups.find(g=>g.id===newProvider)
              const firstM=targetGroup?.models[0]
              updateJudge(idx,{
                provider:newProvider,
                model:firstM?.id??'',
                ...(firstM?.reasoning?.defaultEffort?{reasoningEffort:firstM.reasoning.defaultEffort}:{reasoningEffort:undefined}),
              })
            }}>
              {!loaded.groups.some(g=>g.id===judge.provider)&&judge.provider&&<option value={judge.provider}>{judge.provider}</option>}
              {loaded.groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}
            </select>
            <select style={selectStyle} disabled={busy} aria-label={tFormat(t['field.extraJudges.modelAria'],{index:idx+1})} value={judge.model} onChange={e=>{
              const newModel=e.target.value
              const found=judgeModels.find(m=>m.id===newModel)
              updateJudge(idx,{
                model:newModel,
                ...(found?.reasoning?.defaultEffort?{reasoningEffort:found.reasoning.defaultEffort}:{reasoningEffort:undefined}),
              })
            }}>
              {!judgeModels.some(m=>m.id===judge.model)&&judge.model&&<option value={judge.model}>{judge.model}</option>}
              {judgeModels.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
            </select>
            <select style={selectStyle} disabled={busy} aria-label={tFormat(t['field.extraJudges.effortAria'],{index:idx+1})} value={judge.reasoningEffort??''} onChange={e=>updateJudge(idx,{reasoningEffort:e.target.value||undefined})}>
              <option value="">{t['field.reasoningEffort.default']}</option>
              {judgeEfforts.map(ef=><option key={ef.id} value={ef.id}>{ef.name}</option>)}
            </select>
            <Input style={{width:'100%',height:36,borderRadius:8}} type="text" disabled={busy} placeholder={t['field.extraJudges.labelPlaceholder']} aria-label={tFormat(t['field.extraJudges.labelAria'],{index:idx+1})} value={judge.label??''} onChange={e=>updateJudge(idx,{label:e.target.value})}/>
            <Button variant="outline" disabled={busy} aria-label={tFormat(t['field.extraJudges.removeAria'],{index:idx+1})} onClick={()=>removeJudge(idx)}>{t['field.extraJudges.remove']}</Button>
          </div>
        })}
      </div>}
      {conflict&&<p style={{margin:'8px 0 0',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{conflict.duplicateOf==='primary'?tFormat(t['field.extraJudges.conflictPrimary'],{index:conflict.index+1,id:judgeIdentity(draft.extraJudges[conflict.index]?.provider??'',draft.extraJudges[conflict.index]?.model??'')}):tFormat(t['field.extraJudges.conflictDuplicate'],{index:conflict.index+1,other:conflict.duplicateOf+1,id:judgeIdentity(draft.extraJudges[conflict.index]?.provider??'',draft.extraJudges[conflict.index]?.model??'')})}</p>}
    </section>

    <section style={group}><GroupTitle>{t['section.execution']}</GroupTitle>
      <div style={row}><Label title={t['field.maxConcurrency.title']} help={t['field.maxConcurrency.help']}/>{numeric('maxConcurrency',1)}</div>
      <div style={row}><Label title={t['field.maxRetries.title']} help={t['field.maxRetries.help']}/>{numeric('maxRetries',0)}</div>
      <div style={row}><Label title={t['field.retryBaseDelayMs.title']} help={t['field.retryBaseDelayMs.help']}/>{numeric('retryBaseDelayMs',1)}</div>
      <div style={row}><Label title={t['field.timeoutMs.title']} help={t['field.timeoutMs.help']}/>{numeric('timeoutMs',1)}</div>
      <div style={row}><Label title={t['field.cacheDir.title']} help={t['field.cacheDir.help']}/>{textField('cacheDir','verifier')}</div>
      <div style={row}><Label title={t['field.cacheMaxEntries.title']} help={t['field.cacheMaxEntries.help']}/>{numeric('cacheMaxEntries',1)}</div>
    </section>

    <section style={group}><GroupTitle>{t['section.cost']}</GroupTitle>
      <div style={row}><Label title={t['field.estimatedInputUsdPerMillion.title']} help={t['field.estimatedInputUsdPerMillion.help']}/>{numeric('estimatedInputUsdPerMillion',0)}</div>
      <div style={row}><Label title={t['field.estimatedOutputUsdPerMillion.title']} help={t['field.estimatedOutputUsdPerMillion.help']}/>{numeric('estimatedOutputUsdPerMillion',0)}</div>
    </section>

    {loaded.failures.length>0&&<div style={{padding:'10px 12px',borderRadius:8,background:'var(--dsw-alias-state-warn-bg)',color:'var(--dsw-alias-state-warn-label)',fontSize:12,lineHeight:'18px'}}><div style={{fontWeight:500,marginBottom:3}}>{t['settings.catalogFailures']}</div>{loaded.failures.map(x=><div key={x}>{x}</div>)}</div>}
    {error&&<p style={{margin:0,fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-error-primary)'}}>{error}</p>}{saved&&!dirty&&<p style={{margin:0,fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-success-primary)'}}>{t['settings.saved']}</p>}
    {dirty&&<p style={{margin:0,fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{t['settings.unsaved']}</p>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,paddingTop:4}}><Button variant="outline" disabled={busy} onClick={()=>void load()}>{t['settings.reload']}</Button><Button variant="primary" disabled={busy||!loaded.writable||Boolean(conflict)} onClick={()=>void save()}>{busy?t['settings.saving']:t['settings.save']}</Button></div>
  </div>
}

function Metric({ label, value, note, accent }:{label:string;value:string;note:string;accent?:string}) {
  return <div style={{...dashboardCard,padding:'16px 18px',minWidth:0}}><div style={muted}>{label}</div><div style={{fontSize:25,fontWeight:750,lineHeight:1.2,margin:'7px 0 5px',color:accent}}>{value}</div><div style={{...muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{note}</div></div>
}

function TrendChart({ daily, days, lang }:{daily:DailyStatistics[];days:number;lang:'zh'|'en'}) {
  const t = dictionaries[lang]
  const rows=useMemo(()=>{const map=new Map(daily.map(row=>[row.date,row]));const values:DailyStatistics[]=[];const start=new Date(startOfRange(days));for(let i=0;i<days;i+=1){const date=new Date(start);date.setDate(start.getDate()+i);const key=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');values.push(map.get(key)??{date:key,invocations:0,successes:0,failures:0,calls:0,tokens:0,estimatedCostUsd:0,byTool:{}})}return values},[daily,days])
  const width=760,height=230,pad={l:44,r:24,t:20,b:38};const innerW=width-pad.l-pad.r,innerH=height-pad.t-pad.b
  const max=Math.max(1,...rows.flatMap(row=>[row.invocations,row.calls]));const x=(index:number)=>pad.l+(rows.length<=1?innerW/2:index*innerW/(rows.length-1));const y=(value:number)=>pad.t+innerH-value/max*innerH
  const points=rows.map((row,index)=>`${x(index)},${y(row.calls)}`).join(' ');const step=rows.length>16?Math.ceil(rows.length/7):Math.max(1,Math.ceil(rows.length/7));const barWidth=Math.max(3,Math.min(18,innerW/Math.max(rows.length,1)*.55))
  return <div style={{width:'100%',overflowX:'auto'}}><svg viewBox={`0 0 ${width} ${height}`} style={{display:'block',width:'100%',minWidth:620,height:'auto'}} aria-label={t['chart.ariaLabel']}>
    {[0,.25,.5,.75,1].map(ratio=><g key={ratio}><line x1={pad.l} x2={width-pad.r} y1={pad.t+innerH*ratio} y2={pad.t+innerH*ratio} stroke="rgba(148,163,184,.16)"/><text x={pad.l-8} y={pad.t+innerH*ratio+4} textAnchor="end" fontSize="10" fill="var(--dsw-text-secondary)">{Math.round(max*(1-ratio))}</text></g>)}
    {rows.map((row,index)=><rect key={row.date} x={x(index)-barWidth/2} y={y(row.invocations)} width={barWidth} height={pad.t+innerH-y(row.invocations)} rx="2" fill="#4f8cff" opacity=".82"/>)}
    <polyline points={points} fill="none" stroke="#5ed7e8" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/>
    {rows.map((row,index)=>index%step===0||index===rows.length-1?<text key={row.date} x={x(index)} y={height-14} textAnchor="middle" fontSize="10" fill="var(--dsw-text-secondary)">{Number(row.date.slice(5,7))}/{Number(row.date.slice(8,10))}</text>:null)}
  </svg><div style={{display:'flex',justifyContent:'center',gap:18,...muted}}><span><i style={{display:'inline-block',width:8,height:8,borderRadius:2,background:'#4f8cff',marginRight:6}}/>{t['chart.legendToolCalls']}</span><span><i style={{display:'inline-block',width:14,height:2,background:'#5ed7e8',marginRight:6,verticalAlign:'middle'}}/>{t['chart.legendModelCalls']}</span></div></div>
}

export function StatisticsPage({ sessionId, rpc, isGlobal }: StatisticsPageProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const labels = toolLabels[lang]
  const [days, setDays] = useState(30)
  const [sessionOnly, setSessionOnly] = useState(!isGlobal && Boolean(sessionId))
  const [data, setData] = useState<StatisticsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  // Decision snapshots are fetched on demand: they carry whole prompts, and a dashboard
  // that loaded all of them would ship megabytes of text for rows nobody opened.
  const [snapshot, setSnapshot] = useState<{ id: string; record?: DecisionRecordView; error?: string } | null>(null)
  const snapshotRequest = useRef(0)
  const toggleSnapshot = async (id: string) => {
    if (snapshot?.id === id) { setSnapshot(null); return }
    const request = ++snapshotRequest.current
    setSnapshot({ id })
    const payload = { kind: 'decision', id }
    try {
      let record: DecisionRecordView | undefined
      if (rpc && typeof rpc.call === 'function') {
        try {
          const result = await rpc.call('/api', 'llm-verifier/statistics', payload)
          if (result && result.ok === true) record = (result.value as { decision?: DecisionRecordView }).decision
        } catch (rpcError) { console.warn('[llm-verifier] decision rpc.call failed, trying fetch fallback:', rpcError) }
      }
      if (record === undefined) {
        const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        const body = await response.json().catch(() => undefined)
        const value = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined
        if (value === undefined || value === null) throw new EndpointError(body?.error?.message ?? body?.result?.error?.message ?? t['stats.requestFailed'])
        record = (value as { decision?: DecisionRecordView }).decision
      }
      if (snapshotRequest.current === request) setSnapshot({ id, ...(record === undefined ? { error: t['recent.decisionMissing'] } : { record }) })
    } catch (cause) {
      if (snapshotRequest.current === request) setSnapshot({ id, error: message(cause) })
    }
  }
  // Judge probe: one real, bounded call per configured judge. Not recorded in the statistics —
  // it answers "which channel is this judge on, and is my rubric the one in effect", which the
  // aggregate counters cannot.
  const [probe, setProbe] = useState<{ busy: boolean; value?: ProbeResultView; error?: string } | null>(null)
  const runProbe = async () => {
    if (probe?.busy) return
    setProbe({ busy: true })
    const payload = { kind: 'probe' }
    try {
      let value: ProbeResultView | undefined
      if (rpc && typeof rpc.call === 'function') {
        try {
          const result = await rpc.call('/api', 'llm-verifier/statistics', payload)
          if (result && result.ok === true) value = result.value as ProbeResultView
        } catch (rpcError) { console.warn('[llm-verifier] probe rpc.call failed, trying fetch fallback:', rpcError) }
      }
      if (value === undefined) {
        const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        const body = await response.json().catch(() => undefined)
        const fallback = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined
        if (fallback === undefined || fallback === null) throw new EndpointError(body?.error?.message ?? body?.result?.error?.message ?? t['stats.requestFailed'])
        value = fallback as ProbeResultView
      }
      setProbe({ busy: false, value })
    } catch (cause) {
      setProbe({ busy: false, error: message(cause) })
    }
  }
  // Data belongs to the range/session that produced it: keeping the previous
  // range's numbers under an error banner reads as if they were current.
  const queryKey = days + '|' + sessionOnly + '|' + String(sessionId ?? '')
  const lastQueryKey = useRef<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    if (lastQueryKey.current !== undefined && lastQueryKey.current !== queryKey) setData(null)
    lastQueryKey.current = queryKey
    const effectiveSessionId = sessionOnly && sessionId ? String(sessionId) : undefined
    const queryPayload = {
      fromMs: startOfRange(days),
      toMs: endOfToday(),
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      recentLimit: 50,
      ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
    }

    const fetchOverview = async (): Promise<StatisticsOverview> => {
      if (rpc && typeof rpc.call === 'function') {
        try {
          const result = await rpc.call('/api', 'llm-verifier/statistics', queryPayload, controller.signal)
          if (result && result.ok) {
            return result.value as StatisticsOverview
          }
          if (result && result.ok === false) {
            throw new EndpointError(result.error?.message ?? t['stats.requestFailed'])
          }
        } catch (rpcError) {
          if (controller.signal.aborted) throw rpcError
          // A business rejection is the host's real answer; retrying it over the
          // raw fetch endpoint would only duplicate the request and hide it.
          if (rpcError instanceof EndpointError) throw rpcError
          console.warn('[llm-verifier] rpc.call failed, trying fetch fallback:', rpcError)
        }
      }

      try {
        const response = await fetch('/api/llm-verifier/statistics', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(queryPayload),
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText || t['stats.requestFailed']}`)
        }
        const data = await response.json()
        if (data && data.ok === true) {
          return data.value as StatisticsOverview
        }
        if (data && data.type === 'server-response' && data.result?.ok === true) {
          return data.result.value as StatisticsOverview
        }
        throw new EndpointError(data?.error?.message ?? data?.result?.error?.message ?? t['stats.requestFailed'])
      } catch (fetchError) {
        if (controller.signal.aborted) throw fetchError
        if (fetchError instanceof EndpointError) throw fetchError
        // Hosts without the exact Fetch route registry only answer on the plugin's own channel.
        if (rpc && typeof rpc.call === 'function') {
          const legacy = await rpc.call('/llm-verifier', 'statistics', queryPayload, controller.signal)
          if (legacy && legacy.ok) return legacy.value as StatisticsOverview
        }
        throw fetchError
      }
    }

    void fetchOverview()
      .then(overview => {
        if (!controller.signal.aborted) setData(overview)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [days, sessionOnly, sessionId, refresh, rpc, t, queryKey])

  const totals = data?.totals
  return <main style={{ height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '22px clamp(16px, 3vw, 38px) 48px', color: 'var(--dsw-text-primary)', background: 'radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(79,140,255,.14)', color: '#6da0ff' }}>
              <IconDataOutline16 size={18} />
            </span>
            <h2 style={{ margin: 0, fontSize: 23 }}>{isGlobal ? t['global.panelTitle'] : t['stats.pageTitle']}</h2>
          </div>
          <p style={{ margin: '7px 0 0 44px', ...muted }}>{isGlobal ? t['global.panelIntro'] : tFormat(t['stats.updatedAt'], { time: data ? dateTime(data.generatedAt, lang) : '--' })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--dsw-surface-sunken)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))' }}>
            {[7, 30, 90].map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)} style={{ border: 0, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: days === value ? '#fff' : 'var(--dsw-text-secondary)', background: days === value ? '#3f68d8' : 'transparent' }}>{tFormat(t['stats.daysUnit'], { days: value })}</button>)}
          </div>
          {Boolean(sessionId) && <button aria-pressed={sessionOnly} onClick={() => setSessionOnly(value => !value)} style={{ border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-text-primary)', background: sessionOnly ? 'rgba(79,140,255,.18)' : 'var(--dsw-surface-sunken)' }}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</button>}
          <button type="button" disabled={probe?.busy === true} onClick={() => void runProbe()} style={{ border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)' }}>{probe?.busy === true ? t['probe.running'] : t['probe.button']}</button>
          <button title={t['stats.refresh']} onClick={() => setRefresh(value => value + 1)} style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)', cursor: 'pointer' }}><IconRefreshOutline16 size={16} /></button>
        </div>
      </header>
      {error && <div style={{ ...dashboardCard, padding: 18, borderColor: 'var(--dsw-danger, #e85858)', color: 'var(--dsw-danger, #e85858)' }}>{error}<div style={{ ...muted, marginTop: 6 }}>{t['stats.hostRestartHint']}</div></div>}
      {probe !== null && <section style={{ ...dashboardCard, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>{t['probe.title']}</strong><span style={muted}>{t['probe.note']}</span></div>
        {probe.error !== undefined && <div style={{ marginTop: 10, fontSize: 12, color: '#e76565' }}>{probe.error}</div>}
        {probe.value !== undefined && <>
          <div style={{ ...muted, marginTop: 8 }}>{tFormat(t['probe.rubric'], { source: probe.value.rubric.source, count: probe.value.rubric.count, file: probe.value.rubric.file ?? '' })}</div>
          {probe.value.rubric.error !== undefined && <div style={{ marginTop: 6, fontSize: 12, color: '#e3bd63' }}>{tFormat(t['probe.rubricFallback'], { error: probe.value.rubric.error })}</div>}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {probe.value.judges.map(judge => <div key={judge.label + judge.model} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, padding: '9px 11px', borderRadius: 9, background: 'var(--dsw-surface-sunken)' }}>
              <span style={{ color: judge.ok ? '#77d49b' : '#e76565', fontWeight: 600 }}>{judge.ok ? 'OK' : t['probe.failed']}</span>
              <strong>{judge.label}</strong>
              <span style={muted}>{judge.provider}/{judge.model}</span>
              {judge.ok ? <>
                {judge.channel !== undefined && <span style={muted}>{tFormat(t['probe.channel'], { channel: judge.channel })}{judge.channelProbed === true ? ' · ' + t['probe.reprobed'] : ''}</span>}
                {judge.scoreA !== undefined && judge.scoreB !== undefined && <span style={muted}>{tFormat(t['probe.scores'], { a: formatPercentage(judge.scoreA), b: formatPercentage(judge.scoreB) })}</span>}
                <span style={muted}>{tFormat(t['probe.latency'], { ms: String(judge.latencyMs) })}</span>
                {judge.calls !== undefined && <span style={muted}>{tFormat(t['probe.calls'], { calls: String(judge.calls) })}</span>}
              </> : <span style={{ color: '#e76565' }}>{judge.error}</span>}
            </div>)}
          </div>
        </>}
      </section>}
      {loading && !data ? <div style={{ ...dashboardCard, padding: 32, textAlign: 'center', ...muted }}>{t['stats.loading']}</div> : <>
        <section style={{ ...dashboardCard, padding: '22px 24px', display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(240px,1fr)', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={muted}>{tFormat(t['stats.costSummary'], { days })}</div>
            <div style={{ fontSize: 38, fontWeight: 780, letterSpacing: '-.03em', margin: '5px 0' }}>{money(totals?.estimatedCostUsd ?? 0)}</div>
            <div style={muted}>{tFormat(t['stats.callsSummary'], { invocations: compact(totals?.invocations ?? 0, lang), calls: compact(totals?.calls ?? 0, lang) })}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '9px 16px', fontSize: 13 }}>
            <span style={muted}>{t['stats.successCalls']}</span><strong>{compact(totals?.successes ?? 0, lang)} <small style={{ color: '#77d49b' }}>▲ {((totals?.successRate ?? 0) * 100).toFixed(1)}%</small></strong>
            <span style={muted}>{t['stats.failedCalls']}</span><strong>{compact(totals?.failures ?? 0, lang)}</strong>
            <span style={muted}>{t['stats.avgDuration']}</span><strong>{duration(totals?.averageDurationMs ?? 0)}</strong>
          </div>
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <Metric label={t['metric.cacheHitRate']} value={((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + '%'} note={tFormat(t['metric.cacheHitNote'], { hits: compact(totals?.cacheHits ?? 0, lang), total: compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0), lang) })} accent="#b7dd64" />
          <Metric label={t['metric.prefixCacheHitRate']} value={((totals?.prefixCacheHitRate ?? 0) * 100).toFixed(1) + '%'} note={tFormat(t['metric.prefixCacheHitNote'], { cached: compact(totals?.cachedInputTokens ?? 0, lang), input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang) })} />
          <Metric label={t['metric.tokens']} value={compact(totals?.tokens ?? 0, lang)} note={tFormat(t['metric.tokensNote'], { input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang), output: compact(totals?.outputTokens ?? 0, lang) })} />
          <Metric label={t['metric.avgModelCalls']} value={(totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : '0'} note={tFormat(t['metric.avgModelCallsNote'], { attempts: compact(totals?.attempts ?? 0, lang), retries: compact(totals?.retries ?? 0, lang) })} />
          <Metric label={t['metric.scoringMode']} value={compact(totals?.topLogprobScores ?? 0, lang)} note={tFormat(t['metric.scoringModeNote'], { explicit: compact(totals?.explicitTagScores ?? 0, lang) })} />
        </section>
        <section style={{ ...dashboardCard, padding: '18px 20px 16px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><strong>{t['chart.title']}</strong><span style={muted}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</span></div><TrendChart daily={data?.daily ?? []} days={days} lang={lang} /></section>
        <section style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['table.title']}</strong><span style={muted}>{tFormat(t['table.toolCount'], { count: (data?.tools ?? []).length })}</span></div><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}><thead><tr style={{ textAlign: 'left', color: 'var(--dsw-text-secondary)', background: 'var(--dsw-surface-sunken)' }}>{[t['table.colTool'], t['table.colInvocations'], t['table.colSuccessRate'], t['table.colAvgDuration'], t['table.colModelCalls'], t['table.colTokens'], t['table.colCacheHits'], t['table.colEstimatedCost']].map(value => <th key={value} style={{ padding: '10px 12px', fontWeight: 500 }}>{value}</th>)}</tr></thead><tbody>{(data?.tools ?? []).map(tool => <tr key={tool.toolName} style={{ borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }}><td style={{ padding: '13px 12px' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toolColors[tool.toolName] ?? '#8691a8', marginRight: 8 }} /><strong>{labels[tool.toolName] ?? tool.toolName}</strong><div style={{ ...muted, margin: '3px 0 0 16px' }}>{tool.toolName}</div></td><td style={{ padding: '13px 12px' }}>{compact(tool.invocations, lang)}</td><td style={{ padding: '13px 12px', color: tool.successRate >= .9 ? '#77d49b' : tool.successRate >= .7 ? '#e3bd63' : '#ed7777' }}>{(tool.successRate * 100).toFixed(1)}%</td><td style={{ padding: '13px 12px' }}>{duration(tool.averageDurationMs)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.calls, lang)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.tokens, lang)}</td><td style={{ padding: '13px 12px' }}>{tool.cacheHits}/{tool.cacheHits + tool.cacheMisses}</td><td style={{ padding: '13px 12px' }}>{money(tool.estimatedCostUsd)}</td></tr>)}{(data?.tools.length ?? 0) === 0 && <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', ...muted }}>{t['table.empty']}</td></tr>}</tbody></table></div></section>
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(290px,.45fr)', gap: 16, alignItems: 'start' }}><div style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['recent.title']}</strong><span style={muted}>{t['recent.maxCount']}</span></div><div style={{ maxHeight: 360, overflow: 'auto' }}>{(data?.recent ?? []).map(item => {
            const verdictInfo = item.verdict ? formatVerdictDetails(item.verdict, t) : undefined
            const failed = !item.success || (verdictInfo ? verdictInfo.isFailed : false)
            return <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) auto', gap: 12, padding: '11px 8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: failed ? '#e76565' : '#59c985' }} />
                  <strong style={{ fontSize: 13 }}>{labels[item.toolName] ?? item.toolName}</strong>
                  <span style={muted}>{item.provider}/{item.model}</span>
                </div>
                {!item.success && <div title={item.errorMessage} style={{ margin: '5px 0 0 15px', fontSize: 11, color: '#e76565', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.errorMessage ?? item.errorName}</div>}
                {item.verdict && verdictInfo && <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 0 0 15px', fontSize: 11 }}>
                  {verdictInfo.outcomeText && <span style={{ padding: '1px 5px', borderRadius: 4, fontWeight: 500, fontSize: 11, background: verdictInfo.isFailed ? 'rgba(231,101,101,.16)' : item.verdict.outcome === 'tie' ? 'rgba(227,189,99,.16)' : 'rgba(89,201,133,.16)', color: verdictInfo.isFailed ? '#e76565' : item.verdict.outcome === 'tie' ? '#e3bd63' : '#77d49b', border: `1px solid ${verdictInfo.isFailed ? 'rgba(231,101,101,.3)' : item.verdict.outcome === 'tie' ? 'rgba(227,189,99,.3)' : 'rgba(89,201,133,.3)'}` }}>{verdictInfo.outcomeText}</span>}
                  {verdictInfo.phaseText && <span style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-surface-sunken)', color: 'var(--dsw-text-secondary)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }}>{verdictInfo.phaseText}</span>}
                  {verdictInfo.scoreText && <span style={{ color: (typeof item.verdict.threshold === 'number' && typeof item.verdict.score === 'number' && item.verdict.score < item.verdict.threshold) ? '#e76565' : 'var(--dsw-text-primary)' }}>{verdictInfo.scoreText}</span>}
                  {verdictInfo.checkpointsText && <span style={{ color: 'var(--dsw-text-secondary)' }}>{verdictInfo.checkpointsText}</span>}
                  {verdictInfo.criteriaText && <span style={{ color: 'var(--dsw-text-secondary)' }}>{verdictInfo.criteriaText}</span>}
                  {verdictInfo.winnerText && <span style={{ color: 'var(--dsw-text-secondary)' }}>{verdictInfo.winnerText}</span>}
                  {item.route && <span style={{ padding: '1px 5px', borderRadius: 4, fontSize: 11, background: 'rgba(120,140,220,.14)', color: 'var(--dsw-text-secondary)', border: '1px solid rgba(120,140,220,.3)' }}>{tFormat(t['recent.route.badge'], { stage: item.route.stage, destination: item.route.destination })}</span>}
                  {item.stats.usageIncomplete === true && <span style={{ padding: '1px 5px', borderRadius: 4, fontSize: 11, background: 'rgba(227,189,99,.16)', color: '#e3bd63', border: '1px solid rgba(227,189,99,.3)' }}>{t['recent.detail.usageIncomplete']}</span>}
                </div>}
                <div style={{ margin: '6px 0 0 15px' }}>
                  <button type="button" onClick={() => void toggleSnapshot(item.id)} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--dsw-text-secondary)', background: 'var(--dsw-surface-sunken)', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))' }}>{snapshot?.id === item.id ? t['recent.decisionHide'] : t['recent.decision']}</button>
                </div>
                <details style={{ margin: '6px 0 0 15px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--dsw-text-secondary)' }}>{t['recent.details']}</summary>
                  <div style={{ marginTop: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-surface-sunken)', fontSize: 11 }}>
                    {(item.verdict?.criteria?.length ?? 0) > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) auto auto', gap: '4px 14px', marginBottom: 8 }}>
                      <strong style={{ color: 'var(--dsw-text-secondary)' }}>{t['recent.detail.criterion']}</strong>
                      <strong style={{ color: 'var(--dsw-text-secondary)' }}>{t['recent.detail.score']}</strong>
                      <strong style={{ color: 'var(--dsw-text-secondary)' }}>{t['recent.detail.threshold']}</strong>
                      {item.verdict!.criteria!.map(criterion => {
                        const threshold = typeof item.verdict!.threshold === 'number' ? item.verdict!.threshold : undefined
                        const missed = threshold !== undefined && criterion.score < threshold
                        return <Fragment key={criterion.id}>
                          <span>{criterion.id}</span>
                          <span style={{ color: missed ? '#e76565' : '#77d49b' }}>{formatPercentage(criterion.score)}</span>
                          <span style={{ color: 'var(--dsw-text-secondary)' }}>{threshold === undefined ? '—' : formatPercentage(threshold)}</span>
                        </Fragment>
                      })}
                    </div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, color: 'var(--dsw-text-secondary)' }}>
                      <span>{tFormat(t['recent.detail.calls'], { calls: compact(item.stats.calls, lang) })}</span>
                      <span>{tFormat(t['recent.detail.tokens'], { input: compact(item.stats.inputTokens, lang), cached: compact(item.stats.cachedInputTokens, lang), output: compact(item.stats.outputTokens, lang) })}</span>
                      <span>{tFormat(t['recent.detail.scoreCache'], { hits: compact(item.stats.cacheHits, lang), misses: compact(item.stats.cacheMisses, lang) })}</span>
                      <span>{tFormat(t['recent.detail.prefixCache'], { rate: ((item.stats.inputTokens + item.stats.cachedInputTokens) > 0 ? (100 * item.stats.cachedInputTokens / (item.stats.inputTokens + item.stats.cachedInputTokens)).toFixed(0) : '0') + '%' })}</span>
                      <span>{tFormat(t['recent.detail.cost'], { cost: money(item.stats.estimatedCostUsd) })}</span>
                      {item.route && <span>{tFormat(t['recent.detail.route'], { cycle: item.route.cycleId, trigger: item.route.trigger, stage: item.route.stage, destination: item.route.destination, attempt: item.route.attempt ?? 1 })}</span>}
                      {item.route && item.route.reservedCalls !== undefined && <span>{tFormat(t['recent.detail.routeReserved'], { reserved: compact(item.route.reservedCalls, lang), actual: compact(item.stats.calls, lang) })}</span>}
                      {item.route?.skipReason !== undefined && <span>{tFormat(t['recent.detail.routeSkip'], { reason: item.route.skipReason })}</span>}
                      {(item.stats.channelFallbacks ?? 0) > 0 && <span>{tFormat(t['recent.detail.channelFallback'], { count: compact(item.stats.channelFallbacks ?? 0, lang) })}</span>}
                    </div>
                  </div>
                </details>
                {snapshot?.id === item.id && <div style={{ margin: '8px 0 2px 15px', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-surface-sunken)' }}>
                  {snapshot.error !== undefined && <div style={{ fontSize: 11, color: '#e76565' }}>{snapshot.error}</div>}
                  {snapshot.record === undefined && snapshot.error === undefined && <div style={{ ...muted, fontSize: 11 }}>{t['recent.decisionLoading']}</div>}
                  {snapshot.record !== undefined && snapshot.record.calls.length === 0 && <div style={{ ...muted, fontSize: 11 }}>{t['recent.decisionEmpty']}</div>}
                  {(snapshot.record?.calls ?? []).map((call, index) => <div key={index} style={{ marginBottom: index === snapshot.record!.calls.length - 1 ? 0 : 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--dsw-text-secondary)' }}>{call.label} · {call.channel}{call.score === undefined ? '' : ' · ' + formatPercentage(call.score)}</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>{t['recent.decisionPrompt']}</div>
                    <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,.2)', padding: '6px 8px', borderRadius: 6 }}>{call.prompt}</pre>
                    <div style={{ fontSize: 11, marginTop: 4 }}>{t['recent.decisionOutput']}</div>
                    <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,.2)', padding: '6px 8px', borderRadius: 6 }}>{call.output}</pre>
                  </div>)}
                </div>}
              </div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12 }}>{duration(item.durationMs)}</div><div style={{ ...muted, marginTop: 3 }}>{dateTime(item.startedAt, lang)}</div></div>
            </div>
          })}{(data?.recent.length ?? 0) === 0 && <div style={{ padding: 24, textAlign: 'center', ...muted }}>{t['recent.empty']}</div>}</div></div>
          <div style={{ ...dashboardCard, padding: '18px' }}><strong>{t['models.title']}</strong><div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{(data?.models ?? []).map(model => <div key={model.provider + '\0' + model.model} style={{ padding: '11px 12px', borderRadius: 10, background: 'var(--dsw-surface-sunken)' }}><div style={{ fontWeight: 650, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.model}</div><div style={{ ...muted, marginTop: 3 }}>{model.provider}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 12 }}><span>{tFormat(t['models.calls'], { calls: compact(model.calls, lang) })}</span><span>{tFormat(t['models.tokens'], { tokens: compact(model.tokens, lang) })}</span><strong>{money(model.estimatedCostUsd)}</strong></div></div>)}{(data?.models.length ?? 0) === 0 && <div style={muted}>{t['models.empty']}</div>}</div></div></section>
      </>}
    </div>
  </main>
}

export function VerifierSidebarIcon({ size, active }: { size: number; active?: boolean }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, color: active ? 'var(--dsw-alias-brand-primary, #4f8cff)' : 'currentColor' }}><IconDataOutline16 size={Math.min(18, size)} /></span>
}

export function GlobalVerifierDashboard({ rpc }: { rpc: any }) {
  return <StatisticsPage rpc={rpc} isGlobal />
}

export function RightSidebarVerifierPanel({ rpc, sessionId }: { rpc: any; sessionId?: string }) {
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <StatisticsPage rpc={rpc} sessionId={sessionId} />
    </div>
  )
}

export function RightSidebarVerifierTitle() {
  const lang = useLanguage()
  const t = dictionaries[lang]
  return <span style={{ fontSize: 13, fontWeight: 500 }}>{t['slot.statistics']}</span>
}

export const inject = ['slots', 'connection', 'remote', 'remote.session', 'remote.settings']
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as any
  const remote = ctx.remote
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'llm-verifier',
    order: 35,
    label: 'LLM Verifier',
    inject: () => ({ remote }),
  }, VerifierSettings as never))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'llm-verifier-statistics',
    order: 30,
    label: () => (detectLanguage() === 'zh' ? zh['slot.statistics'] : en['slot.statistics']),
    inject: () => ({ rpc: connection.rpc }),
  }, StatisticsPage as never))
  const VERIFIER_TAB_KIND = 'llm-verifier'
  const VERIFIER_TAB_ID = 'dsh-llm-verifier'

  const registerRightSidebar = (tabs: any): (() => void) | undefined => {
    if (!tabs || typeof tabs.register !== 'function') return undefined
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
      })
      return typeof disposer === 'function' ? disposer : undefined
    } catch (error) {
      console.warn('[llm-verifier] sidebar tab registration failed:', error)
      return undefined
    }
  }

  // ctx.inject() already runs its callback as soon as the service exists, so an
  // extra ctx.get() pre-check registered the same tab type twice; the registry
  // throws on a duplicate id and that throw used to be swallowed. The returned
  // disposer is owned by the injecting scope, so a reload cannot leave a stale
  // tab definition behind.
  if (typeof (ctx as any).inject === 'function') {
    try {
      (ctx as any).inject(['sidebarRightTabs'], (subCtx: any) => {
        const subTabs = typeof subCtx?.get === 'function' ? subCtx.get('sidebarRightTabs') : (subCtx as any)?.sidebarRightTabs
        const disposer = registerRightSidebar(subTabs)
        if (disposer) subCtx.effect(() => disposer)
      })
    } catch (error) {
      console.warn('[llm-verifier] sidebar tab injection failed:', error)
    }
  }

  ctx.slots.inject('sidebar.right.pane.tab' as never, () => ctx.slots.register({
    name: 'sidebar.right.pane.tab' as never,
    key: VERIFIER_TAB_ID,
    inject: () => ({ rpc: connection.rpc }),
  } as never, RightSidebarVerifierPanel as never))

  ctx.slots.inject('sidebar.right.pane.tab.title' as never, () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title' as never,
    key: VERIFIER_TAB_ID,
  } as never, RightSidebarVerifierTitle as never))
}
