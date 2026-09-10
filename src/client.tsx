import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconDataOutline16, IconRefreshOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useMemo, useState } from 'react'
import {
  zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage,
  compact, money, duration, dateTime, type I18nDict,
} from './client-i18n.ts'

export { zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict }

const NS = 'llm-verifier'
interface Values { enabled: boolean; autoVerifyMode: 'manual'|'smart'|'strict'; autoVerifyThreshold: number; autoVerifyRepeats: number; autoVerifyMinToolCalls: number; autoVerifyMaxChars: number; autoVerifyMaxPerTask: number; autoVerifyMaxPerSession: number; autoRouteSemantic: boolean; autoRouteMinConfidence: number; autoRouteMaxCandidates: number; autoRouteMaxPerTask: number; autoRouteMaxPerSession: number; autoTrackCompletionThreshold: number; autoRouteMaxItemChars: number; autoRouteMaxInputChars: number; autoMaxModelCallsPerTask: number; autoMaxModelCallsPerSession: number; autoVerifyTeamTasks?: boolean; autoVerifyPlanMode?: boolean; provider: string; model: string; reasoningEffort?: string; maxTokens: number; maxConcurrency: number; maxRetries: number; timeoutMs: number; cacheMaxEntries: number; estimatedInputUsdPerMillion: number; estimatedOutputUsdPerMillion: number }
interface Loaded { groups: readonly ModelProviderGroup[]; settings: SettingsNamespaceView; writable: boolean; failures: string[] }
interface RunStats { calls: number; attempts: number; retries: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number; topLogprobScores: number; explicitTagScores: number }
interface InvocationRecord { id: string; toolName: string; sessionId?: string; startedAt: number; finishedAt: number; durationMs: number; success: boolean; errorName?: string; errorMessage?: string; provider: string; model: string; stats: RunStats }
interface DailyStatistics { date: string; invocations: number; successes: number; failures: number; calls: number; tokens: number; estimatedCostUsd: number; byTool: Record<string, number> }
interface ToolStatistics { toolName: string; invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; calls: number; tokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number }
interface ModelStatistics { provider: string; model: string; invocations: number; calls: number; tokens: number; estimatedCostUsd: number }
interface Totals extends RunStats { invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; tokens: number; cacheHitRate: number }
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
const toolColors: Record<string, string> = { verifier_route_classify: '#d97706', verifier_compare: '#4f8cff', verifier_select: '#8b6df6', verifier_track: '#2fc5c9', verifier_current_session: '#f5a524' }

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function values(view: SettingsNamespaceView): Values { const v=record(view.value); const mode=v.autoVerifyMode==='manual'||v.autoVerifyMode==='strict'?v.autoVerifyMode:'smart'; return { enabled:v.enabled!==false,autoVerifyMode:mode,autoVerifyThreshold:Number(v.autoVerifyThreshold??.65),autoVerifyRepeats:Number(v.autoVerifyRepeats??1),autoVerifyMinToolCalls:Number(v.autoVerifyMinToolCalls??3),autoVerifyMaxChars:Number(v.autoVerifyMaxChars??80000),autoVerifyMaxPerTask:Number(v.autoVerifyMaxPerTask??2),autoVerifyMaxPerSession:Number(v.autoVerifyMaxPerSession??8),autoRouteSemantic:v.autoRouteSemantic!==false,autoRouteMinConfidence:Number(v.autoRouteMinConfidence??.9),autoRouteMaxCandidates:Number(v.autoRouteMaxCandidates??8),autoRouteMaxPerTask:Number(v.autoRouteMaxPerTask??2),autoRouteMaxPerSession:Number(v.autoRouteMaxPerSession??8),autoTrackCompletionThreshold:Number(v.autoTrackCompletionThreshold??.8),autoRouteMaxItemChars:Number(v.autoRouteMaxItemChars??20000),autoRouteMaxInputChars:Number(v.autoRouteMaxInputChars??60000),autoMaxModelCallsPerTask:Number(v.autoMaxModelCallsPerTask??48),autoMaxModelCallsPerSession:Number(v.autoMaxModelCallsPerSession??160),provider:String(v.provider??''),model:String(v.model??''),...(typeof v.reasoningEffort==='string'?{reasoningEffort:v.reasoningEffort}:{}),maxTokens:Number(v.maxTokens??32768),maxConcurrency:Number(v.maxConcurrency??8),maxRetries:Number(v.maxRetries??3),timeoutMs:Number(v.timeoutMs??300000),cacheMaxEntries:Number(v.cacheMaxEntries??10000),estimatedInputUsdPerMillion:Number(v.estimatedInputUsdPerMillion??0),estimatedOutputUsdPerMillion:Number(v.estimatedOutputUsdPerMillion??0) } }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function Label({title,help}:{title:string;help:string}) { return <div style={{minWidth:0}}><div style={{fontSize:14,fontWeight:400,lineHeight:'22px',color:'var(--dsw-alias-label-primary)'}}>{title}</div><div style={{fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-label-tertiary)',marginTop:2}}>{help}</div></div> }
function GroupTitle({children}:{children:React.ReactNode}) { return <h3 style={groupTitle}>{children}</h3> }
function startOfRange(days: number): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - days + 1); return date.getTime() }
function endOfToday(): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() + 1); return date.getTime() }

export function VerifierSettings({ remote }: VerifierSettingsProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const [loaded,setLoaded]=useState<Loaded|null>(null); const [draft,setDraft]=useState<Values|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false)
  const load=async()=>{setError(null);try{const [m,s]=await Promise.all([remote.session.modelCatalog(),remote.settings.describe()]);if(!m.ok)throw new Error(m.error.message);if(!s.ok)throw new Error(s.error.message);const view=s.value.namespaces.find((x:SettingsNamespaceView)=>x.ns===NS);if(!view)throw new Error(t['settings.nsUnregistered']);const next={groups:m.value.groups,settings:view,writable:s.value.writable,failures:m.value.failures.map((f: { id?: string; provider?: string; name?: string; message: string })=>(f.id??f.provider??f.name??'unknown')+': '+f.message)};setLoaded(next);setDraft(values(view))}catch(e){setError(message(e))}}
  useEffect(()=>{void load()},[])
  const models=useMemo(()=>loaded?.groups.find(g=>g.id===draft?.provider)?.models??[],[loaded,draft?.provider])
  const selected=models.find(m=>m.id===draft?.model); const efforts=selected?.reasoning?.efforts??[]
  const patch=<K extends keyof Values>(key:K,value:Values[K])=>setDraft(v=>v?{...v,[key]:value}:v)
  const save=async()=>{if(!loaded||!draft)return;setBusy(true);setSaved(false);setError(null);try{const section={...record(loaded.settings.user),...draft};if(!draft.reasoningEffort)delete section.reasoningEffort;const res=await remote.settings.update(NS,section as never,loaded.settings.revision);if(!res.ok)throw new Error(res.error.message);setLoaded(v=>v?{...v,settings:res.value}:v);setDraft(values(res.value));setSaved(true)}catch(e){setError(message(e))}finally{setBusy(false)}}
  if(!loaded||!draft)return <div style={shell}><h2 style={settingsHeading}>{t['settings.title']}</h2><p style={settingsIntro}>{error??t['settings.loading']}</p>{error&&<div><Button variant="outline" onClick={()=>void load()}>{t['settings.retry']}</Button></div>}</div>
  const numeric=(key:keyof Values,min=0)=><Input style={{width:'100%',height:36,borderRadius:8}} type="number" min={min} value={String(draft[key])} onChange={e=>patch(key,Number(e.target.value) as never)} />
  return <div style={shell}>
    <h2 style={settingsHeading}>{t['settings.title']}</h2>
    <p style={settingsIntro}>{t['settings.intro']}</p>

    <section style={group}><GroupTitle>{t['section.tools']}</GroupTitle>
      <div style={row}><Label title={t['field.enabled.title']} help={draft.enabled?t['field.enabled.helpOn']:t['field.enabled.helpOff']}/><button type="button" role="switch" aria-checked={draft.enabled} aria-label={t['field.enabled.title']} onClick={()=>patch('enabled',!draft.enabled)} style={toggleStyle(draft.enabled)}><span style={toggleThumbStyle(draft.enabled)}/></button></div>
      {!draft.enabled&&<p style={{margin:'8px 0 0',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{t['field.enabled.warnDisabled']}</p>}
    </section>

    <section style={group}><GroupTitle>{t['section.autoVerify']}</GroupTitle>
      <div style={row}><Label title={t['field.autoVerifyMode.title']} help={t['field.autoVerifyMode.help']}/><select style={selectStyle} value={draft.autoVerifyMode} onChange={e=>patch('autoVerifyMode',e.target.value as Values['autoVerifyMode'])}><option value="manual">{t['field.autoVerifyMode.manual']}</option><option value="smart">{t['field.autoVerifyMode.smart']}</option><option value="strict">{t['field.autoVerifyMode.strict']}</option></select></div>
      <div style={row}><Label title={t['field.autoRouteSemantic.title']} help={t['field.autoRouteSemantic.help']}/><button type="button" role="switch" aria-checked={draft.autoRouteSemantic} aria-label={t['field.autoRouteSemantic.title']} onClick={()=>patch('autoRouteSemantic',!draft.autoRouteSemantic)} style={toggleStyle(draft.autoRouteSemantic)}><span style={toggleThumbStyle(draft.autoRouteSemantic)}/></button></div>
      <div style={row}><Label title={t['field.autoVerifyTeamTasks.title']} help={t['field.autoVerifyTeamTasks.help']}/><button type="button" role="switch" aria-checked={draft.autoVerifyTeamTasks??true} aria-label={t['field.autoVerifyTeamTasks.title']} onClick={()=>patch('autoVerifyTeamTasks',!(draft.autoVerifyTeamTasks??true))} style={toggleStyle(draft.autoVerifyTeamTasks??true)}><span style={toggleThumbStyle(draft.autoVerifyTeamTasks??true)}/></button></div>
      <div style={row}><Label title={t['field.autoVerifyPlanMode.title']} help={t['field.autoVerifyPlanMode.help']}/><button type="button" role="switch" aria-checked={draft.autoVerifyPlanMode??true} aria-label={t['field.autoVerifyPlanMode.title']} onClick={()=>patch('autoVerifyPlanMode',!(draft.autoVerifyPlanMode??true))} style={toggleStyle(draft.autoVerifyPlanMode??true)}><span style={toggleThumbStyle(draft.autoVerifyPlanMode??true)}/></button></div>
      <div style={row}><Label title={t['field.autoRouteMinConfidence.title']} help={t['field.autoRouteMinConfidence.help']}/>{numeric('autoRouteMinConfidence',0)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxCandidates.title']} help={t['field.autoRouteMaxCandidates.help']}/>{numeric('autoRouteMaxCandidates',3)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxPerTask.title']} help={t['field.autoRouteMaxPerTask.help']}/>{numeric('autoRouteMaxPerTask',1)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxPerSession.title']} help={t['field.autoRouteMaxPerSession.help']}/>{numeric('autoRouteMaxPerSession',1)}</div>
      <div style={row}><Label title={t['field.autoTrackCompletionThreshold.title']} help={t['field.autoTrackCompletionThreshold.help']}/>{numeric('autoTrackCompletionThreshold',0)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxItemChars.title']} help={t['field.autoRouteMaxItemChars.help']}/>{numeric('autoRouteMaxItemChars',100)}</div>
      <div style={row}><Label title={t['field.autoRouteMaxInputChars.title']} help={t['field.autoRouteMaxInputChars.help']}/>{numeric('autoRouteMaxInputChars',1000)}</div>
      <div style={row}><Label title={t['field.autoMaxModelCallsPerTask.title']} help={t['field.autoMaxModelCallsPerTask.help']}/>{numeric('autoMaxModelCallsPerTask',1)}</div>
      <div style={row}><Label title={t['field.autoMaxModelCallsPerSession.title']} help={t['field.autoMaxModelCallsPerSession.help']}/>{numeric('autoMaxModelCallsPerSession',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyThreshold.title']} help={t['field.autoVerifyThreshold.help']}/>{numeric('autoVerifyThreshold',0)}</div>
      <div style={row}><Label title={t['field.autoVerifyRepeats.title']} help={t['field.autoVerifyRepeats.help']}/>{numeric('autoVerifyRepeats',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMinToolCalls.title']} help={t['field.autoVerifyMinToolCalls.help']}/>{numeric('autoVerifyMinToolCalls',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxChars.title']} help={t['field.autoVerifyMaxChars.help']}/>{numeric('autoVerifyMaxChars',1000)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxPerTask.title']} help={t['field.autoVerifyMaxPerTask.help']}/>{numeric('autoVerifyMaxPerTask',1)}</div>
      <div style={row}><Label title={t['field.autoVerifyMaxPerSession.title']} help={t['field.autoVerifyMaxPerSession.help']}/>{numeric('autoVerifyMaxPerSession',1)}</div>
      {draft.autoVerifyMode!=='manual'&&<p style={{margin:'8px 0 0',fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-warn-label)'}}>{t['field.autoVerify.warnNotice']}</p>}
    </section>

    <section style={group}><GroupTitle>{t['section.model']}</GroupTitle>
      <div style={row}><Label title={t['field.provider.title']} help={t['field.provider.help']}/><select style={selectStyle} value={draft.provider} onChange={e=>{const provider=e.target.value;const first=loaded.groups.find(g=>g.id===provider)?.models[0];setDraft({...draft,provider,...(first?{model:first.id,reasoningEffort:first.reasoning?.defaultEffort}:{})})}}>{loaded.groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}</select></div>
      <div style={row}><Label title={t['field.model.title']} help={t['field.model.help']}/><select style={selectStyle} value={draft.model} onChange={e=>{const model=e.target.value;const found=models.find(m=>m.id===model);setDraft({...draft,model,...(found?.reasoning?.defaultEffort?{reasoningEffort:found.reasoning.defaultEffort}:{reasoningEffort:undefined})})}}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></div>
      <div style={row}><Label title={t['field.reasoningEffort.title']} help={t['field.reasoningEffort.help']}/><select style={selectStyle} value={draft.reasoningEffort??''} onChange={e=>patch('reasoningEffort',e.target.value||undefined)}><option value="">{t['field.reasoningEffort.default']}</option>{efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      <div style={row}><Label title={t['field.maxTokens.title']} help={t['field.maxTokens.help']}/>{numeric('maxTokens',1)}</div>
    </section>

    <section style={group}><GroupTitle>{t['section.execution']}</GroupTitle>
      <div style={row}><Label title={t['field.maxConcurrency.title']} help={t['field.maxConcurrency.help']}/>{numeric('maxConcurrency',1)}</div>
      <div style={row}><Label title={t['field.maxRetries.title']} help={t['field.maxRetries.help']}/>{numeric('maxRetries',0)}</div>
      <div style={row}><Label title={t['field.timeoutMs.title']} help={t['field.timeoutMs.help']}/>{numeric('timeoutMs',1)}</div>
      <div style={row}><Label title={t['field.cacheMaxEntries.title']} help={t['field.cacheMaxEntries.help']}/>{numeric('cacheMaxEntries',1)}</div>
    </section>

    <section style={group}><GroupTitle>{t['section.cost']}</GroupTitle>
      <div style={row}><Label title={t['field.estimatedInputUsdPerMillion.title']} help={t['field.estimatedInputUsdPerMillion.help']}/>{numeric('estimatedInputUsdPerMillion',0)}</div>
      <div style={row}><Label title={t['field.estimatedOutputUsdPerMillion.title']} help={t['field.estimatedOutputUsdPerMillion.help']}/>{numeric('estimatedOutputUsdPerMillion',0)}</div>
    </section>

    {loaded.failures.length>0&&<div style={{padding:'10px 12px',borderRadius:8,background:'var(--dsw-alias-state-warn-bg)',color:'var(--dsw-alias-state-warn-label)',fontSize:12,lineHeight:'18px'}}><div style={{fontWeight:500,marginBottom:3}}>{t['settings.catalogFailures']}</div>{loaded.failures.map(x=><div key={x}>{x}</div>)}</div>}
    {error&&<p style={{margin:0,fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-error-primary)'}}>{error}</p>}{saved&&<p style={{margin:0,fontSize:12,lineHeight:'18px',color:'var(--dsw-alias-state-success-primary)'}}>{t['settings.saved']}</p>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,paddingTop:4}}><Button variant="outline" disabled={busy} onClick={()=>void load()}>{t['settings.reload']}</Button><Button variant="primary" disabled={busy||!loaded.writable} onClick={()=>void save()}>{busy?t['settings.saving']:t['settings.save']}</Button></div>
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

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
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
            throw new Error(result.error?.message ?? t['stats.requestFailed'])
          }
        } catch (rpcError) {
          if (controller.signal.aborted) throw rpcError
          console.warn('[llm-verifier] rpc.call failed, trying fetch fallback:', rpcError)
        }
      }

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
      throw new Error(data?.error?.message ?? data?.result?.error?.message ?? t['stats.requestFailed'])
    }

    void fetchOverview()
      .then(overview => {
        setData(overview)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(message(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [days, sessionOnly, sessionId, refresh, rpc, t])

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
            {[7, 30, 90].map(value => <button key={value} onClick={() => setDays(value)} style={{ border: 0, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: days === value ? '#fff' : 'var(--dsw-text-secondary)', background: days === value ? '#3f68d8' : 'transparent' }}>{tFormat(t['stats.daysUnit'], { days: value })}</button>)}
          </div>
          {Boolean(sessionId) && <button onClick={() => setSessionOnly(value => !value)} style={{ border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-text-primary)', background: sessionOnly ? 'rgba(79,140,255,.18)' : 'var(--dsw-surface-sunken)' }}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</button>}
          <button title={t['stats.refresh']} onClick={() => setRefresh(value => value + 1)} style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))', color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)', cursor: 'pointer' }}><IconRefreshOutline16 size={16} /></button>
        </div>
      </header>
      {error && <div style={{ ...dashboardCard, padding: 18, borderColor: 'var(--dsw-danger, #e85858)', color: 'var(--dsw-danger, #e85858)' }}>{error}<div style={{ ...muted, marginTop: 6 }}>{t['stats.hostRestartHint']}</div></div>}
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
          <Metric label={t['metric.tokens']} value={compact(totals?.tokens ?? 0, lang)} note={tFormat(t['metric.tokensNote'], { input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang), output: compact(totals?.outputTokens ?? 0, lang) })} />
          <Metric label={t['metric.avgModelCalls']} value={(totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : '0'} note={tFormat(t['metric.avgModelCallsNote'], { attempts: compact(totals?.attempts ?? 0, lang), retries: compact(totals?.retries ?? 0, lang) })} />
          <Metric label={t['metric.scoringMode']} value={compact(totals?.topLogprobScores ?? 0, lang)} note={tFormat(t['metric.scoringModeNote'], { explicit: compact(totals?.explicitTagScores ?? 0, lang) })} />
        </section>
        <section style={{ ...dashboardCard, padding: '18px 20px 16px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><strong>{t['chart.title']}</strong><span style={muted}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</span></div><TrendChart daily={data?.daily ?? []} days={days} lang={lang} /></section>
        <section style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['table.title']}</strong><span style={muted}>{tFormat(t['table.toolCount'], { count: data?.tools.length ?? 0 })}</span></div><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}><thead><tr style={{ textAlign: 'left', color: 'var(--dsw-text-secondary)', background: 'var(--dsw-surface-sunken)' }}>{[t['table.colTool'], t['table.colInvocations'], t['table.colSuccessRate'], t['table.colAvgDuration'], t['table.colModelCalls'], t['table.colTokens'], t['table.colCacheHits'], t['table.colEstimatedCost']].map(value => <th key={value} style={{ padding: '10px 12px', fontWeight: 500 }}>{value}</th>)}</tr></thead><tbody>{(data?.tools ?? []).map(tool => <tr key={tool.toolName} style={{ borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }}><td style={{ padding: '13px 12px' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toolColors[tool.toolName] ?? '#8691a8', marginRight: 8 }} /><strong>{labels[tool.toolName] ?? tool.toolName}</strong><div style={{ ...muted, margin: '3px 0 0 16px' }}>{tool.toolName}</div></td><td style={{ padding: '13px 12px' }}>{compact(tool.invocations, lang)}</td><td style={{ padding: '13px 12px', color: tool.successRate >= .9 ? '#77d49b' : tool.successRate >= .7 ? '#e3bd63' : '#ed7777' }}>{(tool.successRate * 100).toFixed(1)}%</td><td style={{ padding: '13px 12px' }}>{duration(tool.averageDurationMs)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.calls, lang)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.tokens, lang)}</td><td style={{ padding: '13px 12px' }}>{tool.cacheHits}/{tool.cacheHits + tool.cacheMisses}</td><td style={{ padding: '13px 12px' }}>{money(tool.estimatedCostUsd)}</td></tr>)}{(data?.tools.length ?? 0) === 0 && <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', ...muted }}>{t['table.empty']}</td></tr>}</tbody></table></div></section>
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(290px,.45fr)', gap: 16, alignItems: 'start' }}><div style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['recent.title']}</strong><span style={muted}>{t['recent.maxCount']}</span></div><div style={{ maxHeight: 360, overflow: 'auto' }}>{(data?.recent ?? []).map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) auto', gap: 12, padding: '11px 8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))' }}><div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: item.success ? '#59c985' : '#e76565' }} /><strong style={{ fontSize: 13 }}>{labels[item.toolName] ?? item.toolName}</strong><span style={muted}>{item.provider}/{item.model}</span></div>{!item.success && <div title={item.errorMessage} style={{ margin: '5px 0 0 15px', fontSize: 11, color: '#e76565', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.errorMessage ?? item.errorName}</div>}</div><div style={{ textAlign: 'right' }}><div style={{ fontSize: 12 }}>{duration(item.durationMs)}</div><div style={{ ...muted, marginTop: 3 }}>{dateTime(item.startedAt, lang)}</div></div></div>)}{(data?.recent.length ?? 0) === 0 && <div style={{ padding: 24, textAlign: 'center', ...muted }}>{t['recent.empty']}</div>}</div></div>
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
    label: detectLanguage() === 'zh' ? zh['slot.statistics'] : en['slot.statistics'],
    inject: () => ({ rpc: connection.rpc }),
  }, StatisticsPage as never))
  ctx.slots.inject('sidebar.panellist' as never, () => ctx.slots.register({
    name: 'sidebar.panellist' as never,
    id: 'llm-verifier',
    order: 40,
    label: detectLanguage() === 'zh' ? zh['slot.globalDashboard'] : en['slot.globalDashboard'],
  } as never, VerifierSidebarIcon as never))
  ctx.slots.inject('main' as never, () => ctx.slots.register({
    name: 'main' as never,
    key: 'llm-verifier',
    inject: () => ({ rpc: connection.rpc }),
  } as never, GlobalVerifierDashboard as never))

  const VERIFIER_TAB_KIND = 'llm-verifier'
  const VERIFIER_TAB_ID = 'dsh-llm-verifier'

  const registerRightSidebar = (tabs: any) => {
    if (!tabs || typeof tabs.register !== 'function') return
    try {
      tabs.register({
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
    } catch {}
  }

  const existingTabs = typeof (ctx as any).get === 'function' ? (ctx as any).get('sidebarRightTabs') : undefined
  if (existingTabs) {
    registerRightSidebar(existingTabs)
  }
  if (typeof (ctx as any).inject === 'function') {
    try {
      (ctx as any).inject(['sidebarRightTabs'], (subCtx: any) => {
        const subTabs = typeof subCtx?.get === 'function' ? subCtx.get('sidebarRightTabs') : (subCtx as any)?.sidebarRightTabs
        if (subTabs) registerRightSidebar(subTabs)
      })
    } catch {}
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
