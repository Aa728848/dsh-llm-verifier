import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useMemo, useState } from 'react'

const NS = 'llm-verifier'
interface Values { enabled: boolean; provider: string; model: string; reasoningEffort?: string; maxTokens: number; maxConcurrency: number; maxRetries: number; timeoutMs: number; cacheMaxEntries: number; estimatedInputUsdPerMillion: number; estimatedOutputUsdPerMillion: number }
interface Loaded { groups: ModelProviderGroup[]; settings: SettingsNamespaceView; writable: boolean; failures: string[] }
const shell: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 4px 32px', color: 'var(--dsw-text-primary)' }
const card: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 0, padding: '16px 16px 0', border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))', borderRadius: 12, background: 'var(--dsw-alias-bg-module, rgba(20, 31, 57, 0.42))', overflow: 'hidden' }
const sectionTitle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '0 0 12px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' }
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(220px, 1.4fr)', gap: 18, alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' }
const selectStyle: React.CSSProperties = { width: '100%', minHeight: 38, padding: '0 12px', borderRadius: 10, color: 'var(--dsw-text-primary)', background: 'var(--dsw-surface-sunken)', border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))' }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function values(view: SettingsNamespaceView): Values { const v=record(view.value); return { enabled:v.enabled!==false,provider:String(v.provider??''),model:String(v.model??''),...(typeof v.reasoningEffort==='string'?{reasoningEffort:v.reasoningEffort}:{}),maxTokens:Number(v.maxTokens??32768),maxConcurrency:Number(v.maxConcurrency??8),maxRetries:Number(v.maxRetries??3),timeoutMs:Number(v.timeoutMs??300000),cacheMaxEntries:Number(v.cacheMaxEntries??10000),estimatedInputUsdPerMillion:Number(v.estimatedInputUsdPerMillion??0),estimatedOutputUsdPerMillion:Number(v.estimatedOutputUsdPerMillion??0) } }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function Label({title,help}:{title:string;help:string}) { return <div><div style={{fontWeight:600}}>{title}</div><div style={{fontSize:12,color:'var(--dsw-text-secondary)',marginTop:3}}>{help}</div></div> }

function VerifierSettings({ api }:{api:any}) {
  const [loaded,setLoaded]=useState<Loaded|null>(null); const [draft,setDraft]=useState<Values|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null); const [saved,setSaved]=useState(false)
  const load=async()=>{setError(null);try{const [m,s]=await Promise.all([api.llm.models({}),api.settings.describe({})]);if(!m.result.ok)throw new Error(m.result.error.message);if(!s.result.ok)throw new Error(s.result.error.message);const view=s.result.value.namespaces.find((x:SettingsNamespaceView)=>x.ns===NS);if(!view)throw new Error('Verifier settings namespace is not registered. Restart the DSH host.');const next={groups:m.result.value.groups,settings:view,writable:s.result.value.writable,failures:m.result.value.failures.map((f:any)=>f.name+': '+f.message)};setLoaded(next);setDraft(values(view))}catch(e){setError(message(e))}}
  useEffect(()=>{void load()},[])
  const models=useMemo(()=>loaded?.groups.find(g=>g.id===draft?.provider)?.models??[],[loaded,draft?.provider])
  const selected=models.find(m=>m.id===draft?.model); const efforts=selected?.reasoning?.efforts??[]
  const patch=<K extends keyof Values>(key:K,value:Values[K])=>setDraft(v=>v?{...v,[key]:value}:v)
  const save=async()=>{if(!loaded||!draft)return;setBusy(true);setSaved(false);setError(null);try{const section={...record(loaded.settings.user),...draft};if(!draft.reasoningEffort)delete section.reasoningEffort;const res=await api.settings.update({ns:NS,patch:section,expectedRevision:loaded.settings.revision});if(!res.result.ok)throw new Error(res.result.error.message);setLoaded(v=>v?{...v,settings:res.result.value}:v);setDraft(values(res.result.value));setSaved(true)}catch(e){setError(message(e))}finally{setBusy(false)}}
  if(!loaded||!draft)return <div style={shell}><h2>LLM Verifier</h2><p>{error??'正在读取 DSH 模型和设置…'}</p>{error&&<Button onClick={()=>void load()}>重试</Button>}</div>
  const numeric=(key:keyof Values,min=0)=><Input type="number" min={min} value={String(draft[key])} onChange={e=>patch(key,Number(e.target.value) as never)} />
  return <div style={shell}>
    <div><h2 style={{margin:'0 0 6px'}}>LLM Verifier</h2><p style={{margin:0,color:'var(--dsw-text-secondary)'}}>选择任意已在 DSH「模型」页配置并启用的模型作为独立裁判。设置实时生效。</p></div>
    <div style={card}><div style={sectionTitle}><StateDot state={draft.enabled?'done':'error'}/><strong>工具开关</strong></div>
      <div style={row}><Label title="启用 Verifier 工具" help={draft.enabled?'四个 verifier 工具可被 Agent 调用，每次调用会向裁判模型发起请求。':'已停用：Agent 调用 verifier 工具会立即返回错误，不产生任何模型请求。'}/><button onClick={()=>patch('enabled',!draft.enabled)} style={{width:80,height:32,borderRadius:16,border:'1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16))',background:draft.enabled?'var(--dsw-success, #2f9e5b)':'var(--dsw-surface-sunken)',color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600}}>{draft.enabled?'已启用':'已停用'}</button></div>
      {!draft.enabled&&<div style={{padding:'0 0 14px',fontSize:12,color:'var(--dsw-state-warn-primary, #d9a441)'}}>⚠ 当前停用 verifier_compare / verifier_select / verifier_track / verifier_current_session 四个工具</div>}
    </div>
    <div style={card}><div style={sectionTitle}><StateDot state="done"/><strong>裁判模型</strong></div>
      <div style={row}><Label title="供应商" help="只显示当前 DSH 中可路由的供应商"/><select style={selectStyle} value={draft.provider} onChange={e=>{const provider=e.target.value;const first=loaded.groups.find(g=>g.id===provider)?.models[0];setDraft({...draft,provider,...(first?{model:first.id,reasoningEffort:first.reasoning?.defaultEffort}:{})})}}>{loaded.groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}</select></div>
      <div style={row}><Label title="模型" help="模型目录来自 DSH adapter，选择结果会持久化"/><select style={selectStyle} value={draft.model} onChange={e=>{const model=e.target.value;const found=models.find(m=>m.id===model);setDraft({...draft,model,...(found?.reasoning?.defaultEffort?{reasoningEffort:found.reasoning.defaultEffort}:{reasoningEffort:undefined})})}}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></div>
      <div style={row}><Label title="推理强度" help="由所选模型 adapter 声明；留空使用模型默认值"/><select style={selectStyle} value={draft.reasoningEffort??''} onChange={e=>patch('reasoningEffort',e.target.value||undefined)}><option value="">模型默认</option>{efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      <div style={row}><Label title="最大输出 Token" help="每个裁判请求的输出上限"/>{numeric('maxTokens',1)}</div>
    </div>
    <div style={card}><div style={sectionTitle}><strong>执行控制</strong></div><div style={row}><Label title="最大并发" help="所有 verifier 工具共享的请求并发上限"/>{numeric('maxConcurrency',1)}</div><div style={row}><Label title="最多重试" help="短暂网络、限流和服务端错误的重试次数"/>{numeric('maxRetries',0)}</div><div style={row}><Label title="请求超时（毫秒）" help="单个模型请求的超时时间"/>{numeric('timeoutMs',1)}</div><div style={row}><Label title="缓存条目上限" help="持久评分缓存保留的最大条目数"/>{numeric('cacheMaxEntries',1)}</div></div>
    <div style={card}><div style={sectionTitle}><strong>费用估算（每百万 Token，USD）</strong></div><div style={row}><Label title="输入价格" help="仅用于结果中的 estimatedCostUsd"/>{numeric('estimatedInputUsdPerMillion',0)}</div><div style={row}><Label title="输出价格" help="仅用于结果中的 estimatedCostUsd"/>{numeric('estimatedOutputUsdPerMillion',0)}</div></div>
    {loaded.failures.length>0&&<div style={{...card,borderColor:'var(--dsw-alias-state-warn-primary, #d9a441)',paddingBottom:16}}><strong>部分模型目录读取失败</strong>{loaded.failures.map(x=><div key={x}>{x}</div>)}</div>}
    {error&&<div style={{color:'var(--dsw-danger)'}}>{error}</div>}{saved&&<div style={{color:'var(--dsw-success)'}}>已保存，后续 verifier 调用将使用新设置。</div>}
    <div style={{display:'flex',gap:10}}><Button disabled={busy||!loaded.writable} onClick={()=>void save()}>{busy?'保存中…':'保存设置'}</Button><Button variant="outline" disabled={busy} onClick={()=>void load()}>重新载入</Button></div>
  </div>
}

export const inject=['slots','connection']
export function apply(ctx:ClientContext):void { const connection=ctx.get('connection') as any; ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'llm-verifier',order:35,label:'LLM Verifier',inject:()=>({api:connection.api})},VerifierSettings as never)) }
