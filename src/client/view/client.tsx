import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the registry behind `ctx.slots` is a service of this package, so its `Context`
// declaration has to be in this program for the registrations below to be type-checked at all.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * The one glyph still borrowed from the host, resolved by name across the two vocabularies this
 * plugin spans.
 *
 * DSH 0.1.7 renamed the whole host icon set from a size suffix to a stroke suffix
 * (`IconDataOutline16` → `IconDataOutlineRegular`). The icon module is external to this bundle, so
 * a named import of either spelling is `undefined` on a host on the other side of the rename — and
 * React throws on an undefined element type, which would take the entire settings page down
 * instead of dropping one glyph. Probing the namespace at runtime keeps one bundle working on
 * either line; a name that neither line defines renders nothing.
 *
 * The statistics mark is deliberately NOT in this list: every host glyph paints on `currentColor`,
 * so as a guide entry it rendered grey-on-navy. `VerifierSidebarIcon` paints its own brand ramp.
 */
const hostIcons = uiPrimitives as unknown as Record<string, React.ComponentType<{ size?: number }> | undefined>
const IconRefresh = hostIcons.IconRefreshOutlineRegular ?? hostIcons.IconRefreshOutline16 ?? (() => null)
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage,
  compact, money, duration, dateTime, type I18nDict,
  type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave,
  WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE, WORST_CASE_CRITERIA_PER_COMPARISON,
  computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState,
  evaluateBudgetWarning, isVerdictFailed, formatPercentage, formatVerdictDetails,
  verifierActivityText, type ActivityChipView,
} from '../model/client-i18n.ts'
import { CRITERIA_PRESETS, DEFAULT_GROUND_TRUTH_NOTE, buildPairwisePrompt } from '../../scoring/core.ts'
import { IOT_THINKING_MODES, type IotThinkingMode } from '../../config/config.ts'
import {
  type ExtraJudgeDraft,
  MAX_EXTRA_JUDGES,
  normalizeExtraJudges,
  judgeIdentity,
  judgeConflict,
  addExtraJudge,
  removeExtraJudge,
  serializeExtraJudges,
} from '../model/client-judges.ts'
import { buildProcessCycles, type ProcessCycleTone } from '../model/client-process-cycles.ts'
import {
  FIELDS,
  PROFILES,
  SECTIONS,
  SETTINGS_TABS,
  acceptsNumber,
  activeProfile,
  applyProfile,
  isFieldChanged,
  isFieldEnabled,
  issueMap,
  issueMessageKey,
  recommendedBudgets,
  resetField,
  sectionSummary,
  renderTabSections,
  textIssue,
  validateValues,
  valuesFromView,
  type FieldIssue,
  type FieldSpec,
  type Format,
  type ProfileId,
  type SettingsTabId,
  type Translate,
  type Values,
} from '../model/client-fields.ts'

export type { Values } from '../model/client-fields.ts'

export {
  zh, en, dictionaries, toolLabels, tFormat, useLanguage, detectLanguage, compact, money, duration, dateTime, type I18nDict,
  type VerdictSummary, resolveCacheDirOnSave, sameSettingValue, sectionForSave, WORST_CASE_ROUTE_CALLS_PER_JUDGE, WORST_CASE_FINAL_CALLS_PER_JUDGE, WORST_CASE_TASK_PER_JUDGE, WORST_CASE_SESSION_PER_JUDGE,
  computeJudgeCount, computeWorstCaseBudget, type BudgetWarningState, evaluateBudgetWarning, isVerdictFailed,
  formatPercentage, formatVerdictDetails,
}

const NS = 'llm-verifier'
interface DecisionCallView { label: string; channel: string; prompt: string; output: string; score?: number }
interface DecisionRecordView { id: string; toolName: string; phase: string; provider: string; model: string; startedAt: number; calls: DecisionCallView[] }

export interface Loaded { groups: readonly ModelProviderGroupView[]; settings: SettingsNamespaceView; writable: boolean; failures: string[] }
export interface RunStats { calls: number; attempts: number; retries: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number; topLogprobScores: number; explicitTagScores: number; usageIncomplete?: boolean; channelFallbacks?: number }
/** S05-A routing-cycle observation, as persisted on the record (all fields optional/lenient). */
export interface RouteObservationView { cycleId: string; trigger: string; stage: string; destination: string; attempt?: number; reservedCalls?: number; skipReason?: string; canceled?: boolean; usageIncomplete?: boolean; evidenceKept?: number; evidenceOmitted?: number; evidenceChars?: number; replayed?: string; generatedCalls?: number; judgeCalls?: number; sameCandidate?: boolean; alternativeAugmented?: boolean; alternativeModel?: string }
export interface InvocationRecord { id: string; toolName: string; sessionId?: string; startedAt: number; finishedAt: number; durationMs: number; success: boolean; errorName?: string; errorMessage?: string; provider: string; model: string; stats: RunStats; verdict?: VerdictSummary; route?: RouteObservationView }
interface DailyStatistics { date: string; invocations: number; successes: number; failures: number; calls: number; tokens: number; estimatedCostUsd: number; byTool: Record<string, number> }
interface ToolStatistics { toolName: string; invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; calls: number; tokens: number; cacheHits: number; cacheMisses: number; estimatedCostUsd: number }
interface ModelStatistics { provider: string; model: string; invocations: number; calls: number; tokens: number; estimatedCostUsd: number }
interface Totals extends RunStats { invocations: number; successes: number; failures: number; successRate: number; averageDurationMs: number; tokens: number; cacheHitRate: number; prefixCacheHitRate: number }
interface StatisticsOverview { generatedAt: number; fromMs: number; toMs: number; sessionId?: string; totals: Totals; daily: DailyStatistics[]; tools: ToolStatistics[]; models: ModelStatistics[]; recent: InvocationRecord[] }
/**
 * Provider/model catalog as this page reads it.
 *
 * The host owns this vocabulary, but DSH 0.1.7 stopped re-exporting its `ModelProviderGroup`
 * through the remotes client barrel, and reaching it now means installing the whole session
 * controller dependency graph. The page reads exactly the four fields below, so it declares the
 * part of the wire shape it consumes — the same treatment every other response in this interface
 * already gets.
 */
interface ModelProviderGroupView {
  id: string
  name: string
  models: readonly {
    id: string
    name: string
    reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string }
  }[]
}
interface VerifierRemote {
  session: {
    modelCatalog(): Promise<{
      ok: boolean
      value: { groups: readonly ModelProviderGroupView[]; failures: readonly { id?: string; provider?: string; name?: string; message: string }[] }
      error: { message: string }
    }>
  }
settings: {
      describe(): Promise<{
        ok: boolean
        value: { writable: boolean; namespaces: readonly SettingsNamespaceView[] }
        error: { message: string }
      }>
      /**
       * Merge a patch into the stored section. Absent keys keep their stored
       * value, so this cannot undo an override.
       */
      update(
        ns: string,
        patch: Record<string, unknown>,
        expectedRevision: number | undefined,
      ): Promise<{
        ok: boolean
        value: SettingsNamespaceView
        error: { message: string }
      }>
      /**
       * Replace the stored section wholesale, so keys left out re-inherit the
       * composition base. Optional: a host without it falls back to 'update'
       * with every draft value pinned.
       */
      replace?(
        ns: string,
        section: Record<string, unknown>,
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
  /**
   * Mount-scoped takeover of the Conversation composer, handed to the Conversation View instance only.
   *
   * The sidebar pane and the global dashboard share this page but stay mounted while the user
   * chats, so only the registration behind the Conversation View gets the handle: it returns a
   * disposer that restores the real composer.
   */
  blankComposerSeat?: () => () => void
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
  }
}

const shell: React.CSSProperties = { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 24px', color: 'var(--dsw-alias-label-primary)' }
const settingsHeader: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
const settingsHeading: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' }
const settingsIntro: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' }
const statusChips: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }
const statusChip: React.CSSProperties = { padding: '1px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: '18px' }
const panelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 }
const group: React.CSSProperties = { width: '100%', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--dsw-alias-border-l2)', marginTop: 16 }
const sectionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '14px 0 6px', border: 0, background: 'transparent', textAlign: 'left', font: 'inherit', color: 'var(--dsw-alias-label-primary)' }
const sectionHeadingStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, lineHeight: '20px' }
const sectionSummaryStyle: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }
const badgeStyle: React.CSSProperties = { flex: '0 0 auto', padding: '0 6px', borderRadius: 999, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l2)' }
const linkButton: React.CSSProperties = { border: 0, background: 'transparent', padding: 0, font: 'inherit', fontSize: 12, lineHeight: '18px', cursor: 'pointer', color: 'var(--dsw-alias-link)' }
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px', padding: '14px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const blockRow: React.CSSProperties = { ...row, flexDirection: 'column', alignItems: 'stretch', gap: 10 }
const subRow: React.CSSProperties = { paddingTop: 6, borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const labelCell: React.CSSProperties = { flex: '1 1 200px', minWidth: 0 }
const controlCell: React.CSSProperties = { flex: '0 1 280px', maxWidth: '100%', minWidth: 0, display: 'flex', justifyContent: 'flex-end' }
/** The switch is a fixed 40px glyph; this cell keeps it on the same right edge as every other control. */
const toggleCell: React.CSSProperties = { width: '100%', display: 'flex', justifyContent: 'flex-end' }
const fieldTitle: React.CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const fieldHelp: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 }
const fullLine: React.CSSProperties = { flex: '1 1 100%', margin: '0 0 2px', fontSize: 12, lineHeight: '18px' }
const unitStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const sliderStyle: React.CSSProperties = { width: '100%', margin: 0, accentColor: 'var(--dsw-alias-state-business-primary)' }
const judgeCard: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-specific-input-major)' }
const judgeGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 10 }
const auxThinkingGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }
const auxThinkingCard: React.CSSProperties = { ...judgeCard, gap: 10, padding: '10px 12px', minHeight: 44, boxSizing: 'border-box' }
const judgeField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }
const judgeFieldLabel: React.CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' }
/** Every input and select shares one box, including the fields inside judge cards. */
const controlStyle: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: 36, borderRadius: 8, color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-specific-input-major)', border: '1px solid var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 14, lineHeight: '22px', outline: 'none' }
const selectStyle: React.CSSProperties = { ...controlStyle, padding: '0 34px 0 12px' }
const inputStyle: React.CSSProperties = { ...controlStyle, padding: '0 12px' }
const toggleStyle = (enabled: boolean): React.CSSProperties => ({ position: 'relative', flex: '0 0 auto', width: 40, height: 22, padding: 0, border: 0, borderRadius: 999, cursor: 'pointer', transition: 'background .15s ease', background: enabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-specific-input-major)' })
const toggleThumbStyle = (enabled: boolean): React.CSSProperties => ({ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-static-neutral-00)', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left .15s ease' })
const dashboardCard: React.CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 16, boxShadow: '0 12px 36px var(--dsw-alias-bg-mask-2)' }
const muted: React.CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }
/** Chart palette rides the state aliases so bars and line stay legible in both themes. */
const chartBarColor = 'var(--dsw-alias-state-business-primary)'
const chartLineColor = 'var(--dsw-alias-state-warn-primary)'
/**
 * Status chip tones; each one mixes its own state token, so a fill, a ring and its text move together.
 *
 * The process-cycle view model declares the same union locally (it must not import from this module),
 * so the two are kept structurally identical and `toneChip` accepts either name.
 */
type StatusTone = ProcessCycleTone
function toneChip(tone: StatusTone): React.CSSProperties {
  const token = tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
    : tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
      : tone === 'pass' ? 'var(--dsw-alias-state-success-primary)'
        : 'var(--dsw-alias-state-business-primary)'
  return {
    background: `color-mix(in srgb, ${token} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${token} 32%, transparent)`,
    // Amber's 500 step is a fill; its 600 step is the readable text rung.
    color: tone === 'warn' ? 'var(--dsw-alias-state-warn-label)' : token,
  }
}
const toolColors: Record<string, string> = { verifier_route_classify: '#d97706', verifier_compare: '#4f8cff', verifier_select: '#8b6df6', verifier_track: '#2fc5c9', verifier_best_of_n: '#e2569b', verifier_current_session: '#f5a524' }

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function values(view: SettingsNamespaceView): Values { return valuesFromView(record(view.value)) }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
/** The endpoint answered but rejected the request: a transport fallback would only repeat it. */
class EndpointError extends Error {}
/** A cycle id is a long random reservation id; the head identifies it and the full one stays in the title. */
function shortCycleId(cycleId: string): string { return cycleId.length <= 10 ? cycleId : cycleId.slice(0, 8) }
function startOfRange(days: number): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - days + 1); return date.getTime() }
function endOfToday(): number { const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() + 1); return date.getTime() }

const SETTINGS_CSS = `
.llm-verifier-segments { position: relative; display: inline-flex; align-items: center; gap: 2px; padding: 2px; box-sizing: border-box; border-radius: 7px; background: var(--dsw-specific-input-major); }
.llm-verifier-segments::before { content: ""; position: absolute; left: 0; top: 0; width: var(--llm-verifier-pill-w, 0px); height: var(--llm-verifier-pill-h, 0px); border-radius: 7px; background: var(--dsw-alias-bg-module-platform); box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2); opacity: 0; pointer-events: none; transform: translate(var(--llm-verifier-pill-x, 0px), var(--llm-verifier-pill-y, 0px)); }
.llm-verifier-segments[data-pill]::before { opacity: 1; transition: transform 180ms cubic-bezier(.2,.8,.2,1), width 180ms cubic-bezier(.2,.8,.2,1), height 180ms cubic-bezier(.2,.8,.2,1); }
body[data-ds-dark-theme] .llm-verifier-segments::before { background: rgba(255,255,255,.14); box-shadow: none; }
.llm-verifier-segments > * { position: relative; z-index: 1; }
.llm-verifier-segment { appearance: none; margin: 0; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; font-size: 14px; font-weight: 500; line-height: 18px; padding: 3px 12px; transition: color 120ms ease; }
.llm-verifier-segment:hover:not([data-active]) { color: var(--dsw-alias-label-primary); }
.llm-verifier-segment[data-active] { color: var(--dsw-alias-label-primary); }
.llm-verifier-segment:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.llm-verifier-segment:disabled { cursor: not-allowed; opacity: .45; }
.llm-verifier-segments-compact .llm-verifier-segment { font-size: 12px; line-height: 18px; padding: 3px 10px; }
.llm-verifier-settings-tabs { display: flex; align-self: stretch; flex-wrap: wrap; width: 100%; }
.llm-verifier-settings-tabs > [role="tab"] { flex: 1 1 0; min-width: max-content; }
.llm-verifier-settings-tab-icon { width: 15px; height: 15px; margin-right: 6px; vertical-align: -2px; }
.llm-verifier-settings-pages { position: relative; min-width: 0; }
.llm-verifier-settings-leaving { position: absolute; inset: 0 0 auto; pointer-events: none; }
.llm-verifier-settings-panel { min-width: 0; }
.llm-verifier-settings-panel[data-enter] { animation: llm-verifier-page-in 180ms cubic-bezier(.2,.8,.2,1); }
.llm-verifier-settings-panel[data-enter="back"], .llm-verifier-settings-panel[data-leave="forward"] { --llm-verifier-page-shift: -20px; }
.llm-verifier-settings-panel[data-enter="forward"], .llm-verifier-settings-panel[data-leave="back"] { --llm-verifier-page-shift: 20px; }
.llm-verifier-settings-panel[data-leave] { animation: llm-verifier-page-out 180ms cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes llm-verifier-page-in { from { opacity: 0; transform: translateX(var(--llm-verifier-page-shift)); filter: blur(2px); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes llm-verifier-page-out { from { opacity: 1; transform: none; filter: blur(0); } to { opacity: 0; transform: translateX(var(--llm-verifier-page-shift)); filter: blur(2px); } }
@media (prefers-reduced-motion: reduce) { .llm-verifier-settings-panel[data-enter], .llm-verifier-settings-panel[data-leave] { animation: none; } }
`

interface SlidingOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
  id?: string
  controls?: string
}

function syncSlidingPill(control: HTMLDivElement | null): void {
  if (!control) return
  const active = control.querySelector('[data-active]')
  if (!(active instanceof HTMLElement)) {
    control.removeAttribute('data-pill')
    return
  }
  const box = control.getBoundingClientRect()
  const item = active.getBoundingClientRect()
  if (box.width === 0 || item.width === 0) {
    control.removeAttribute('data-pill')
    return
  }
  control.style.setProperty('--llm-verifier-pill-x', `${item.left - box.left - control.clientLeft}px`)
  control.style.setProperty('--llm-verifier-pill-y', `${item.top - box.top - control.clientTop}px`)
  control.style.setProperty('--llm-verifier-pill-w', `${item.width}px`)
  control.style.setProperty('--llm-verifier-pill-h', `${item.height}px`)
  control.setAttribute('data-pill', '')
}

function SlidingSegments<T extends string>(props: {
  label: string
  options: readonly SlidingOption<T>[]
  value: T
  onPick(value: T): void
  disabled?: boolean
  role?: 'group' | 'tablist'
  className?: string
  compact?: boolean
}) {
  const group = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { syncSlidingPill(group.current) })
  useLayoutEffect(() => {
    const control = group.current
    if (!control || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => syncSlidingPill(control))
    observer.observe(control)
    return () => observer.disconnect()
  }, [])
  const tabs = props.role === 'tablist'
  const classes = ['llm-verifier-segments', props.compact ? 'llm-verifier-segments-compact' : '', props.className ?? ''].filter(Boolean).join(' ')
  return <div ref={group} className={classes} role={props.role ?? 'group'} aria-label={props.label}>
    {props.options.map(option => <button
      key={option.value}
      id={option.id}
      type="button"
      className="llm-verifier-segment"
      role={tabs ? 'tab' : 'button'}
      data-active={option.value === props.value ? '' : undefined}
      aria-selected={tabs ? option.value === props.value : undefined}
      aria-pressed={tabs ? undefined : option.value === props.value}
      aria-controls={option.controls}
      disabled={props.disabled}
      onClick={() => { if (option.value !== props.value) props.onPick(option.value) }}
    >{option.icon}{option.label}</button>)}
  </div>
}

function SettingsTabIcon({ id }: { id: SettingsTabId }) {
  const paths: Record<SettingsTabId, React.ReactNode> = {
    general: <path d="M4 8h6M14 8h6M12 5.4v5.2M4 16h16M8 13.4v5.2"/>,
    judges: <><path d="M12 3.4 19 6v5.2c0 4.3-2.8 7.5-7 9.4-4.2-1.9-7-5.1-7-9.4V6z"/><path d="m8.8 12 2.1 2.1 4.3-4.3"/></>,
    automation: <><path d="M5 7h10M12 4l3 3-3 3M19 17H9M12 14l-3 3 3 3"/><path d="M5 4v6M19 14v6"/></>,
    limits: <><path d="M4.2 16a8 8 0 1 1 15.6 0"/><path d="m12 12 4-4M8 16h8"/></>,
    data: <><ellipse cx="12" cy="5.5" rx="7" ry="3"/><path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,
  }
  return <svg className="llm-verifier-settings-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">{paths[id]}</svg>
}

export function iotThinkingSegments(t: I18nDict): { value: IotThinkingMode; label: string }[] {
  return IOT_THINKING_MODES.map(id => ({ value: id, label: t[('field.iotThinking.' + id) as keyof I18nDict] as string }))
}

const PAGE_MOTION_MS = 180

export function VerifierSettings({ remote }: VerifierSettingsProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const [loaded,setLoaded]=useState<Loaded|null>(null); const [draft,setDraft]=useState<Values|null>(null); const [error,setError]=useState<string|null>(null); const [editing,setEditing]=useState<Record<string,string>>({})
  const [saveState,setSaveState]=useState<'saving'|'saved'|null>(null)
  const [openSections,setOpenSections]=useState<Record<string,boolean>>(()=>Object.fromEntries(SECTIONS.map(section=>[section.id,section.open])))
  const [activeTab,setActiveTab]=useState<SettingsTabId>('general')
  const [pageDirection,setPageDirection]=useState<'forward'|'back'|null>(null)
  const panelRef=useRef<HTMLDivElement>(null)
  const leavingRef=useRef<HTMLDivElement>(null)
  const pageTimer=useRef<number|null>(null)
  const saveVersion=useRef(0)
  const writtenVersion=useRef(0)
  const saveInFlight=useRef(false)
  const persistRef=useRef<(version:number)=>Promise<void>>(async()=>{})
  const load=async()=>{setError(null);try{const [m,s]=await Promise.all([remote.session.modelCatalog(),remote.settings.describe()]);if(!m.ok)throw new Error(m.error.message);if(!s.ok)throw new Error(s.error.message);const view=s.value.namespaces.find((x:SettingsNamespaceView)=>x.ns===NS);if(!view)throw new Error(t['settings.nsUnregistered']);const next={groups:m.value.groups,settings:view,writable:s.value.writable,failures:m.value.failures.map((f: { id?: string; provider?: string; name?: string; message: string })=>(f.id??f.provider??f.name??'unknown')+': '+f.message)};setLoaded(next);setDraft(values(view));setEditing({})}catch(e){setError(message(e))}}
  useEffect(()=>{void load()},[])
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
          setLoaded(next);setDraft(values(view));setEditing({});setSaveState(null)
        }catch{/* keep the last good view; the reload button still forces a read */}
      })()
    }
    window.addEventListener('focus',sync)
    document.addEventListener('visibilitychange',sync)
    return ()=>{window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync)}
  },[remote])
  const models=useMemo(()=>loaded?.groups.find(g=>g.id===draft?.provider)?.models??[],[loaded,draft?.provider])
  const selected=models.find(m=>m.id===draft?.model); const efforts=selected?.reasoning?.efforts??[]
  const patch=<K extends keyof Values>(key:K,value:Values[K])=>{setSaveState(null);setDraft(v=>v?{...v,[key]:value}:v)}
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
  const translate = useMemo<Translate>(() => (key: string) => (t as unknown as Record<string, string | undefined>)[key], [t])
  const format = useMemo<Format>(() => (key: string, params?: Record<string, string | number>) => tFormat(translate(key) ?? key, params), [translate])
  const issues = useMemo(() => (draft ? validateValues(draft) : []), [draft])
  const issuesByField = useMemo(() => issueMap(issues), [issues])
  // Writes are serialized. A newer draft waits for the active request, then uses the revision
  // returned by that request; rapid edits therefore cannot finish out of order.
  const persist=async(version:number)=>{
    if(saveInFlight.current)return
    const {loaded:at,draft:target}=latest.current
    if(!at||!target)return
    writtenVersion.current=version
    if(!at.writable||sameSettingValue(target,values(at.settings)))return
    if(validateValues(target).length>0||judgeConflict({provider:target.provider,model:target.model},target.extraJudges)){
      setSaveState(null)
      return
    }
    saveInFlight.current=true;setSaveState('saving');setError(null)
    try{
      const editable:Record<string,unknown>={
        ...target,
        extraJudges:serializeExtraJudges(target.extraJudges),
        reasoningEffort:target.reasoningEffort||undefined,
        label:target.label?.trim()||undefined,
        cacheDir:resolveCacheDirOnSave(target.cacheDir,values(at.settings).cacheDir),
      }
      const base=at.settings.base===undefined?undefined:record(at.settings.base)
      const replaceSettings=remote.settings.replace
      const canReplace=typeof replaceSettings==='function'
      const section=sectionForSave(record(at.settings.user),editable,base,{reInheritBase:canReplace})
      const res=canReplace
        ?await replaceSettings.call(remote.settings,NS,section as never,at.settings.revision)
        :await remote.settings.update(NS,section as never,at.settings.revision)
      if(!res.ok)throw new Error(res.error.message)
      const next={...at,settings:res.value}
      latest.current={...latest.current,loaded:next}
      setLoaded(next)
      if(latest.current.draft&&sameSettingValue(latest.current.draft,target)){
        setDraft(values(res.value));setEditing({})
      }
      setSaveState('saved')
    }catch(e){setError(message(e));setSaveState(null)}finally{
      saveInFlight.current=false
      if(writtenVersion.current<saveVersion.current)void persistRef.current(saveVersion.current)
    }
  }
  persistRef.current=persist
  useEffect(()=>{
    if(!loaded||!draft||!loaded.writable||sameSettingValue(draft,values(loaded.settings)))return
    const version=++saveVersion.current
    const timer=window.setTimeout(()=>void persistRef.current(version),300)
    return()=>window.clearTimeout(timer)
  },[draft])
  useEffect(() => () => {
    if (pageTimer.current !== null) window.clearTimeout(pageTimer.current)
  }, [])
  if(!loaded||!draft)return <div style={shell}><h2 style={settingsHeading}>{t['settings.title']}</h2><p style={settingsIntro}>{error??t['settings.loading']}</p>{error&&<div><Button variant="outline" onClick={()=>void load()}>{t['settings.retry']}</Button></div>}</div>
  const readOnly = !loaded.writable
  const criteriaCount = draft.criteriaPreset === 'custom' ? WORST_CASE_CRITERIA_PER_COMPARISON : CRITERIA_PRESETS[draft.criteriaPreset].length
  const issueText = (issue: FieldIssue): string => tFormat(translate(issueMessageKey(issue)) ?? issueMessageKey(issue), issue.params)
  const helpFor = (field: FieldSpec): string =>
    field.key === 'enabled'
      ? translate(draft.enabled ? field.helpKey : (field.helpKeyOff ?? field.helpKey)) ?? ''
      : translate(field.helpKey) ?? ''
  const inputAria = (field: FieldSpec): string => translate(field.titleKey) ?? String(field.key)
  const setSectionOpen = (id: string, open: boolean) => setOpenSections(current => ({ ...current, [id]: open }))
  const pickTab = (next: SettingsTabId) => {
    if (next === activeTab) return
    const direction = SETTINGS_TABS.findIndex(tab => tab.id === next) > SETTINGS_TABS.findIndex(tab => tab.id === activeTab) ? 'forward' : 'back'
    const panel = panelRef.current
    const leaving = leavingRef.current
    if (panel && leaving && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const still = panel.cloneNode(true) as HTMLElement
      still.removeAttribute('id')
      still.removeAttribute('data-enter')
      still.setAttribute('aria-hidden', 'true')
      still.setAttribute('inert', '')
      still.setAttribute('data-leave', direction)
      leaving.replaceChildren(still)
      if (pageTimer.current !== null) window.clearTimeout(pageTimer.current)
      pageTimer.current = window.setTimeout(() => still.remove(), PAGE_MOTION_MS)
    }
    setPageDirection(direction)
    setActiveTab(next)
  }
  const jumpTo = (key: keyof Values) => {
    const field = FIELDS.find(candidate => candidate.key === key)
    if (!field) return
    const tab = SETTINGS_TABS.find(candidate => candidate.sections.includes(field.section))
    if (tab) pickTab(tab.id)
    setSectionOpen(field.section, true)
    window.requestAnimationFrame(() => {
      const node = document.querySelector('[data-field="' + String(key) + '"]')
      if (!(node instanceof HTMLElement)) return
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const focusable = node.querySelector('input, select, button, textarea')
      if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true })
    })
  }
  const resetOne = (field: FieldSpec) => {
    setSaveState(null)
    setEditing(current => { if (!(field.key in current)) return current; const next = { ...current }; delete next[field.key]; return next })
    setDraft(current => (current ? resetField(current, field.key) : current))
  }
  const fillRecommended = () => {
    setSaveState(null)
    setDraft(current => (current ? { ...current, ...recommendedBudgets(computeJudgeCount(current.extraJudges.length), criteriaCount) } : current))
  }
  const messageFor = (field: FieldSpec): FieldIssue | null => {
    const issue = issuesByField.get(field.key)
    if (issue) return issue
    if (field.kind === 'number' && editing[field.key] !== undefined) return textIssue(field, editing[field.key])
    return null
  }
  const renderSegment = <T extends string,>(label: string, options: readonly { value: T; label: string }[], value: T, onPick: (value: T) => void, enabled = true) => <SlidingSegments
    compact
    label={label}
    options={options}
    value={value}
    onPick={onPick}
    disabled={readOnly || !enabled}
  />
  const renderNumber = (field: FieldSpec, enabled: boolean) => {
    const key = field.key
    const current = Number(draft[key])
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: '1 1 auto', minWidth: 0 }}
          type="text"
          inputMode="decimal"
          disabled={readOnly || !enabled}
          aria-label={inputAria(field)}
          aria-invalid={messageFor(field) ? true : undefined}
          value={editing[key] ?? String(draft[key] ?? '')}
          onChange={event => {
            const raw = event.target.value
            setEditing(state => (state[key] === raw ? state : { ...state, [key]: raw }))
            if (acceptsNumber(field, raw)) patch(key, Number(raw.trim()) as never)
          }}
          onBlur={() => setEditing(state => { if (!(key in state)) return state; const next = { ...state }; delete next[key]; return next })}
        />
        {field.unitKey && <span style={unitStyle}>{t[field.unitKey]}</span>}
      </div>
      {field.slider && <input
        type="range"
        style={sliderStyle}
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={field.max !== undefined && field.max <= 1 ? 0.001 : 1}
        disabled={readOnly || !enabled}
        aria-label={inputAria(field)}
        value={Number.isFinite(current) ? current : field.min ?? 0}
        onChange={event => patch(key, Number(event.target.value) as never)}
      />}
    </div>
  }
  const renderText = (field: FieldSpec, enabled: boolean) => {
    const key = field.key
    const placeholder = key === 'criteriaFile' ? 'criteria/my-task.md' : key === 'cacheDir' ? 'verifier' : undefined
    return <input
      style={inputStyle}
      type="text"
      disabled={readOnly || !enabled}
      placeholder={placeholder}
      aria-label={inputAria(field)}
      value={String(draft[key] ?? '')}
      onChange={event => patch(key, event.target.value as never)}
    />
  }
  const addThinkingTarget = () => {
    if (!loaded || !draft) return
    const used = new Set(draft.iotThinkingTargets.map(target => target.provider + '/' + (target.model ?? '*')))
    const group = loaded.groups.find(candidate => !used.has(candidate.id + '/*') && candidate.models.length > 0) ?? loaded.groups.find(candidate => candidate.models.length > 0)
    if (!group) return
    patch('iotThinkingTargets', [...draft.iotThinkingTargets, { provider: group.id }])
  }
  const removeThinkingTarget = (idx: number) => {
    if (!draft) return
    patch('iotThinkingTargets', draft.iotThinkingTargets.filter((_target, index) => index !== idx))
  }
  const updateThinkingTarget = (idx: number, updates: Partial<Values['iotThinkingTargets'][number]>) => {
    if (!draft) return
    patch('iotThinkingTargets', draft.iotThinkingTargets.map((target, index) => index === idx ? { ...target, ...updates } : target))
  }
  const renderSelect = (field: FieldSpec, enabled: boolean) => {
    if (field.select === 'mode') return renderSegment(inputAria(field), [
      { value: 'manual', label: t['field.autoVerifyMode.manual'] },
      { value: 'smart', label: t['field.autoVerifyMode.smart'] },
      { value: 'strict', label: t['field.autoVerifyMode.strict'] },
    ], draft.autoVerifyMode, value => patch('autoVerifyMode', value), enabled)
    if (field.select === 'processSelection') return renderSegment(inputAria(field), (['off','recovery','every-step'] as const).map(id => ({
      value: id,
      label: t[('field.autoProcessSelection.' + id) as keyof I18nDict] as string,
    })), draft.autoProcessSelection, value => patch('autoProcessSelection', value), enabled)
    if (field.select === 'iotThinking') return renderSegment(inputAria(field), iotThinkingSegments(t), draft.iotThinking, value => patch('iotThinking', value), enabled)
    if (field.select === 'criteriaPreset') return <select style={selectStyle} disabled={readOnly || !enabled} aria-label={inputAria(field)} value={draft.criteriaPreset} onChange={event => patch('criteriaPreset', event.target.value as Values['criteriaPreset'])}>
      {(['coding','debug','research','ops','writing','custom'] as const).map(id => <option key={id} value={id}>{t[('field.criteriaPreset.' + id) as keyof I18nDict] as string}</option>)}
    </select>
    if (field.select === 'provider') return <select style={selectStyle} disabled={readOnly || !enabled} aria-label={inputAria(field)} value={draft.provider} onChange={event => {
      const provider = event.target.value
      const first = loaded.groups.find(group => group.id === provider)?.models[0]
      setSaveState(null)
      setDraft({ ...draft, provider, ...(first ? { model: first.id, reasoningEffort: first.reasoning?.defaultEffort } : {}) })
    }}>
      {loaded.groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.id}</option>)}
    </select>
    if (field.select === 'model') return <select style={selectStyle} disabled={readOnly || !enabled} aria-label={inputAria(field)} value={draft.model} onChange={event => {
      const model = event.target.value
      const found = models.find(entry => entry.id === model)
      setSaveState(null)
      setDraft({ ...draft, model, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) })
    }}>
      {models.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.id}</option>)}
    </select>
    if (field.select === 'effort') return <select style={selectStyle} disabled={readOnly || !enabled} aria-label={inputAria(field)} value={draft.reasoningEffort ?? ''} onChange={event => patch('reasoningEffort', event.target.value || undefined)}>
      <option value="">{t['field.reasoningEffort.default']}</option>
      {efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    return null
  }
  const renderControl = (field: FieldSpec) => {
    const enabled = isFieldEnabled(field, draft)
    if (field.kind === 'toggle') {
      const on = Boolean(draft[field.key])
      return <div style={toggleCell}><button type="button" role="switch" aria-checked={on} aria-label={inputAria(field)} disabled={readOnly || !enabled} onClick={() => patch(field.key, !on as never)} style={toggleStyle(on)}><span style={toggleThumbStyle(on)}/></button></div>
    }
    if (field.kind === 'number') return renderNumber(field, enabled)
    if (field.kind === 'text') return renderText(field, enabled)
    if (field.kind === 'select') return renderSelect(field, enabled)
    return null
  }
  const renderJudges = () => {
    const conflictText = (idx: number): string | null => {
      if (conflict?.index !== idx) return null
      const judge = draft.extraJudges[idx]
      const id = judgeIdentity(judge?.provider ?? '', judge?.model ?? '')
      return conflict.duplicateOf === 'primary'
        ? tFormat(t['field.extraJudges.conflictPrimary'], { index: idx + 1, id })
        : tFormat(t['field.extraJudges.conflictDuplicate'], { index: idx + 1, other: conflict.duplicateOf + 1, id })
    }
    return <Fragment key="extraJudges">
      <div style={row}>
        <div style={labelCell}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={fieldTitle}>{translate('field.extraJudges.title') ?? 'extraJudges'}</span>
            <span style={badgeStyle}>{tFormat(t['field.extraJudges.count'], { count: draft.extraJudges.length, max: MAX_EXTRA_JUDGES })}</span>
          </div>
          <div style={fieldHelp}>{translate('field.extraJudges.help') ?? ''}</div>
        </div>
        <div style={controlCell}><Button variant="outline" disabled={readOnly || draft.extraJudges.length >= MAX_EXTRA_JUDGES} onClick={addJudge}>{t['field.extraJudges.add']}</Button></div>
      </div>
      {draft.extraJudges.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 0 14px', borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
        {draft.extraJudges.map((judge, idx) => {
          const judgeGroup = loaded.groups.find(group => group.id === judge.provider)
          const judgeModels = judgeGroup?.models ?? []
          const judgeModel = judgeModels.find(entry => entry.id === judge.model)
          const judgeEfforts = judgeModel?.reasoning?.efforts ?? []
          const cardConflict = conflictText(idx)
          return <div key={idx} style={judgeCard} data-judge-index={idx}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ ...fieldTitle, fontSize: 13, fontWeight: 500 }}>{tFormat(t['field.extraJudges.itemTitle'], { index: idx + 1 })}</span>
              <button type="button" style={linkButton} disabled={readOnly} aria-label={tFormat(t['field.extraJudges.removeAria'], { index: idx + 1 })} onClick={() => removeJudge(idx)}>{t['field.extraJudges.remove']}</button>
            </div>
            <div style={judgeGrid}>
              <label style={judgeField}>
                <span style={judgeFieldLabel}>{t['field.provider.title']}</span>
                <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.extraJudges.providerAria'], { index: idx + 1 })} value={judge.provider} onChange={event => {
                  const newProvider = event.target.value
                  const targetGroup = loaded.groups.find(group => group.id === newProvider)
                  const firstM = targetGroup?.models[0]
                  updateJudge(idx, { provider: newProvider, model: firstM?.id ?? '', ...(firstM?.reasoning?.defaultEffort ? { reasoningEffort: firstM.reasoning.defaultEffort } : { reasoningEffort: undefined }) })
                }}>
                  {!loaded.groups.some(group => group.id === judge.provider) && judge.provider && <option value={judge.provider}>{judge.provider}</option>}
                  {loaded.groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.id}</option>)}
                </select>
              </label>
              <label style={judgeField}>
                <span style={judgeFieldLabel}>{t['field.model.title']}</span>
                <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.extraJudges.modelAria'], { index: idx + 1 })} value={judge.model} onChange={event => {
                  const newModel = event.target.value
                  const found = judgeModels.find(entry => entry.id === newModel)
                  updateJudge(idx, { model: newModel, ...(found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: undefined }) })
                }}>
                  {!judgeModels.some(entry => entry.id === judge.model) && judge.model && <option value={judge.model}>{judge.model}</option>}
                  {judgeModels.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.id}</option>)}
                </select>
              </label>
              <label style={judgeField}>
                <span style={judgeFieldLabel}>{t['field.reasoningEffort.title']}</span>
                <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.extraJudges.effortAria'], { index: idx + 1 })} value={judge.reasoningEffort ?? ''} onChange={event => updateJudge(idx, { reasoningEffort: event.target.value || undefined })}>
                  <option value="">{t['field.reasoningEffort.default']}</option>
                  {judgeEfforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <label style={judgeField}>
                <span style={judgeFieldLabel}>{t['field.extraJudges.labelTitle']}</span>
                <input style={inputStyle} type="text" disabled={readOnly} placeholder={t['field.extraJudges.labelPlaceholder']} aria-label={tFormat(t['field.extraJudges.labelAria'], { index: idx + 1 })} value={judge.label ?? ''} onChange={event => updateJudge(idx, { label: event.target.value })}/>
              </label>
            </div>
            {cardConflict && <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }}>{cardConflict}</p>}
          </div>
        })}
      </div>}
    </Fragment>
  }
  const renderThinkingRoute = () => {
    // An empty provider is not a missing value: it is the default, and it means the auxiliary call
    // inherits the enabled route's own route. Its model list therefore belongs to that route, not to
    // this panel, so the model picker is locked to the same "follow" value instead of offering a
    // catalog the auxiliary call may never use.
    const followRoute = !draft.iotThinkingProvider
    const group = loaded.groups.find(candidate => candidate.id === draft.iotThinkingProvider)
    const models = group?.models ?? []
    const selectedModel = models.find(model => model.id === draft.iotThinkingModel)
    const efforts = selectedModel?.reasoning?.efforts ?? []
    const summary = followRoute
      ? t['field.iotThinkingRoute.followRoute'] + ' · ' + (draft.iotThinkingEffort || 'low')
      : draft.iotThinkingProvider + ' · ' + (draft.iotThinkingModel || t['field.reasoningEffort.default']) + ' · ' + (draft.iotThinkingEffort || 'low')
    return <details style={auxThinkingCard} data-thinking-route>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ ...fieldTitle, fontSize: 13, fontWeight: 500 }}>{t['field.iotThinkingRoute.title']}</span>
        <span style={{ ...judgeFieldLabel, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{summary} ▾</span>
      </summary>
      <div style={fieldHelp}>{t['field.iotThinkingRoute.help']}</div>
      <div style={auxThinkingGrid}>
        <label style={judgeField}>
          <span style={judgeFieldLabel}>{t['field.provider.title']}</span>
          <select style={selectStyle} disabled={readOnly} aria-label={t['field.iotThinkingRoute.providerAria']} value={draft.iotThinkingProvider} onChange={event => {
            const provider = event.target.value
            const nextGroup = loaded.groups.find(candidate => candidate.id === provider)
            const model = nextGroup?.models.find(candidate => /deepseek/iu.test(candidate.id + ' ' + candidate.name)) ?? nextGroup?.models[0]
            const effort = model?.reasoning?.efforts.some(option => option.id === 'low') ? 'low' : undefined
            setDraft(current => current ? { ...current, iotThinkingProvider: provider, iotThinkingModel: model?.id, iotThinkingEffort: effort } : current)
          }}>
            <option value="">{t['field.iotThinkingRoute.followRoute']}</option>
            {!loaded.groups.some(candidate => candidate.id === draft.iotThinkingProvider) && draft.iotThinkingProvider && <option value={draft.iotThinkingProvider}>{draft.iotThinkingProvider}</option>}
            {loaded.groups.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}
          </select>
        </label>
        <label style={judgeField}>
          <span style={judgeFieldLabel}>{t['field.model.title']}</span>
          <select style={selectStyle} disabled={readOnly || followRoute} aria-label={t['field.iotThinkingRoute.modelAria']} value={followRoute ? '' : draft.iotThinkingModel ?? ''} onChange={event => {
            const model = models.find(candidate => candidate.id === event.target.value)
            const effort = model?.reasoning?.efforts.some(option => option.id === 'low') ? 'low' : undefined
            setDraft(current => current ? { ...current, iotThinkingModel: event.target.value || undefined, iotThinkingEffort: effort } : current)
          }}>
            <option value="">{followRoute ? t['field.iotThinkingRoute.followRoute'] : t['field.reasoningEffort.default']}</option>
            {!models.some(model => model.id === draft.iotThinkingModel) && draft.iotThinkingModel && <option value={draft.iotThinkingModel}>{draft.iotThinkingModel}</option>}
            {models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
          </select>
        </label>
        <label style={judgeField}>
          <span style={judgeFieldLabel}>{t['field.reasoningEffort.title']}</span>
          <select style={selectStyle} disabled={readOnly} aria-label={t['field.iotThinkingRoute.effortAria']} value={draft.iotThinkingEffort ?? ''} onChange={event => patch('iotThinkingEffort', event.target.value || undefined)}>
            <option value="">{t['field.reasoningEffort.default']}</option>
            {efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>
    </details>
  }
  const renderThinkingTargets = () => {
    const issue = messageFor(FIELDS.find(field => field.key === 'iotThinkingTargets')!)
    return <Fragment key="iotThinkingTargets">
      <div style={row}>
        <div style={labelCell}>
          <span style={fieldTitle}>{t['field.iotThinkingTargets.title']}</span>
          <div style={fieldHelp}>{t['field.iotThinkingTargets.help']}</div>
        </div>
        <div style={controlCell}><Button variant="outline" disabled={readOnly || loaded.groups.length === 0} onClick={addThinkingTarget}>{t['field.iotThinkingTargets.add']}</Button></div>
      </div>
      {draft.iotThinking !== 'off' && draft.iotThinkingTargets.length === 0 && <p data-thinking-empty-hint style={{ ...fullLine, margin: '0 0 12px', color: 'var(--dsw-alias-state-warn-label)' }}>{t['field.iotThinkingTargets.empty']}</p>}
      {issue && <p style={{ ...fullLine, color: 'var(--dsw-alias-state-error-primary)' }}>{issueText(issue)}</p>}
      {draft.iotThinkingTargets.map((target, idx) => {
        const mainGroup = loaded.groups.find(group => group.id === target.provider)
        const mainModels = mainGroup?.models ?? []
        const rewriteGroup = loaded.groups.find(group => group.id === target.rewriteProvider)
        const rewriteModels = rewriteGroup?.models ?? []
        const rewriteModel = rewriteModels.find(model => model.id === target.rewriteModel)
        const efforts = rewriteModel?.reasoning?.efforts ?? []
        return <div key={idx} style={judgeCard} data-thinking-target-index={idx}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ ...fieldTitle, fontSize: 13, fontWeight: 500 }}>{tFormat(t['field.iotThinkingTargets.itemTitle'], { index: idx + 1 })}</span>
            <button type="button" style={linkButton} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.remove'], { index: idx + 1 })} onClick={() => removeThinkingTarget(idx)}>{t['field.iotThinkingTargets.remove']}</button>
          </div>
          <div style={judgeGrid}>
            <label style={judgeField}>
              <span style={judgeFieldLabel}>{tFormat(t['field.iotThinkingTargets.mainProviderAria'], { index: idx + 1 })}</span>
              <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.mainProviderAria'], { index: idx + 1 })} value={target.provider} onChange={event => updateThinkingTarget(idx, { provider: event.target.value, model: undefined })}>
                {!loaded.groups.some(group => group.id === target.provider) && target.provider && <option value={target.provider}>{target.provider}</option>}
                {loaded.groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.id}</option>)}
              </select>
            </label>
            <label style={judgeField}>
              <span style={judgeFieldLabel}>{t['field.model.title']}</span>
              <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.mainModelAria'], { index: idx + 1 })} value={target.model ?? ''} onChange={event => updateThinkingTarget(idx, { model: event.target.value || undefined })}>
                <option value="">{t['field.iotThinkingTargets.allModels']}</option>
                {!mainModels.some(model => model.id === target.model) && target.model && <option value={target.model}>{target.model}</option>}
                {mainModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
              </select>
            </label>
          </div>
          {/* The three overrides are one decision set, so they share one row: wrapping them into
              the auto-fit grid made the third select look like a separate, optional step. */}
          <div style={auxThinkingGrid}>
            <label style={judgeField}>
              <span style={judgeFieldLabel}>{tFormat(t['field.iotThinkingTargets.rewriteProviderAria'], { index: idx + 1 })}</span>
              <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.rewriteProviderAria'], { index: idx + 1 })} value={target.rewriteProvider ?? ''} onChange={event => {
                const provider = event.target.value || undefined
                const group = loaded.groups.find(candidate => candidate.id === provider)
                const model = group?.models.find(candidate => /deepseek/iu.test(candidate.id + ' ' + candidate.name)) ?? group?.models[0]
                updateThinkingTarget(idx, { rewriteProvider: provider, rewriteModel: model?.id, rewriteEffort: undefined })
              }}>
                <option value="">{t['field.iotThinkingTargets.followGlobal']}</option>
                {!loaded.groups.some(group => group.id === target.rewriteProvider) && target.rewriteProvider && <option value={target.rewriteProvider}>{target.rewriteProvider}</option>}
                {loaded.groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.id}</option>)}
              </select>
            </label>
            <label style={judgeField}>
              <span style={judgeFieldLabel}>{tFormat(t['field.iotThinkingTargets.rewriteModelAria'], { index: idx + 1 })}</span>
              <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.rewriteModelAria'], { index: idx + 1 })} value={target.rewriteModel ?? ''} onChange={event => updateThinkingTarget(idx, { rewriteModel: event.target.value || undefined, rewriteEffort: undefined })}>
                <option value="">{t['field.iotThinkingTargets.followGlobal']}</option>
                {!rewriteModels.some(model => model.id === target.rewriteModel) && target.rewriteModel && <option value={target.rewriteModel}>{target.rewriteModel}</option>}
                {rewriteModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
              </select>
            </label>
            <label style={judgeField}>
              <span style={judgeFieldLabel}>{tFormat(t['field.iotThinkingTargets.rewriteEffortAria'], { index: idx + 1 })}</span>
              <select style={selectStyle} disabled={readOnly} aria-label={tFormat(t['field.iotThinkingTargets.rewriteEffortAria'], { index: idx + 1 })} value={target.rewriteEffort ?? ''} onChange={event => updateThinkingTarget(idx, { rewriteEffort: event.target.value || undefined })}>
                <option value="">{t['field.iotThinkingTargets.followGlobal']}</option>
                {efforts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      })}
    </Fragment>
  }
  const renderRow = (field: FieldSpec) => {
    const message = messageFor(field)
    const changed = isFieldChanged(field, draft)
    const enabled = isFieldEnabled(field, draft)
    const warning = field.key === 'autoMaxModelCallsPerTask' && budgetWarning?.warnTask
      ? tFormat(translate('field.autoMaxModelCallsPerTask.warnBudget') ?? '', { current: draft.autoMaxModelCallsPerTask, required: budgetWarning.worstCaseTask, judges: budgetWarning.judgeCount })
      : field.key === 'autoMaxModelCallsPerSession' && budgetWarning?.warnSession
        ? tFormat(translate('field.autoMaxModelCallsPerSession.warnBudget') ?? '', { current: draft.autoMaxModelCallsPerSession, required: budgetWarning.worstCaseSession, judges: budgetWarning.judgeCount })
        : null
    const preview = field.key === 'criteriaPreset' && draft.criteriaPreset !== 'custom' ? (() => {
      const preset = CRITERIA_PRESETS[draft.criteriaPreset]
      const first = preset[0]
      if (!first) return null
      return <details style={{ margin: '2px 0 6px 4px', fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' }}>{tFormat(t['field.criteriaPreset.previewSummary'], { count: preset.length })}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto', background: 'var(--dsw-alias-markdown-code-block)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 10, marginTop: 8 }}>{buildPairwisePrompt(t['field.criteriaPreset.sampleTask'], t['field.criteriaPreset.sampleA'], t['field.criteriaPreset.sampleB'], first, DEFAULT_GROUND_TRUTH_NOTE)}</pre>
      </details>
    })() : null
    return <Fragment key={String(field.key)}>
      <div style={{ ...row, ...(field.enabledWhen ? subRow : null) }} data-field={String(field.key)} data-disabled={enabled ? undefined : ''}>
        <div style={labelCell}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={fieldTitle}>{translate(field.titleKey) ?? String(field.key)}</span>
            {changed && <span style={badgeStyle}>{t['settings.fieldChanged']}</span>}
            {changed && <button type="button" style={linkButton} disabled={readOnly} onClick={() => resetOne(field)}>{t['settings.fieldReset']}</button>}
          </div>
          <div style={fieldHelp}>{helpFor(field)}</div>
        </div>
        <div style={{ ...controlCell, opacity: enabled ? 1 : 0.45 }}>{renderControl(field)}</div>
        {/* The every-step arm buys an alternative and a judging round on EVERY main-loop request, so
            the cost warning belongs next to the switch that turns it on, not only in the help text
            of a section the operator may never open. */}
        {field.key === 'autoProcessSelection' && draft.autoProcessSelection === 'every-step' && <p style={{ ...fullLine, margin: '6px 0 2px', padding: '6px 9px', borderRadius: 8, ...toneChip('warn') }}>{t['field.autoProcessSelection.everyStepWarning']}</p>}
        {message && <p style={{ ...fullLine, color: 'var(--dsw-alias-state-error-primary)' }}>{issueText(message)}</p>}
        {warning && <p style={{ ...fullLine, color: 'var(--dsw-alias-state-warn-label)' }}>{warning}</p>}
      </div>
      {preview}
    </Fragment>
  }
  const currentProfile = activeProfile(draft, criteriaCount)
  const sections = renderTabSections(activeTab, draft)
  return <div style={shell}>
    <style>{SETTINGS_CSS}</style>
    <header style={settingsHeader}>
      <h2 style={settingsHeading}>{t['settings.title']}</h2>
      <p style={settingsIntro}>{t['settings.intro']}</p>
      <div style={statusChips}>
        <span style={statusChip}>{translate('field.autoVerifyMode.' + draft.autoVerifyMode)}</span>
        <span style={statusChip}>{tFormat(t['settings.summary.judges'], { count: computeJudgeCount(draft.extraJudges.length) })}</span>
        {saveState && <span style={{ ...statusChip, color: saveState === 'saved' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)' }}>{saveState === 'saving' ? t['settings.autosave.saving'] : t['settings.autosave.saved']}</span>}
      </div>
    </header>

    <SlidingSegments
      role="tablist"
      className="llm-verifier-settings-tabs"
      label={t['settings.tabs.aria']}
      options={SETTINGS_TABS.map(tab => ({
        value: tab.id,
        label: translate(tab.titleKey) ?? tab.id,
        icon: <SettingsTabIcon id={tab.id}/>,
        id: 'verifier-tab-' + tab.id,
        controls: 'verifier-panel-' + tab.id,
      }))}
      value={activeTab}
      onPick={pickTab}
    />

    {(issues.length > 0 || error) && <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' }}>
      {issues.length > 0
        ? <span>{tFormat(t['settings.invalid.summary'], { count: issues.length })} <button type="button" style={linkButton} onClick={() => jumpTo(issues[0].key)}>{t['settings.jumpToIssue']}</button></span>
        : error}
    </div>}

    <div className="llm-verifier-settings-pages">
      <div ref={leavingRef} className="llm-verifier-settings-leaving"/>
      <div ref={panelRef} key={activeTab} className="llm-verifier-settings-panel" data-enter={pageDirection ?? undefined} style={panelStyle} role="tabpanel" id={'verifier-panel-' + activeTab} aria-labelledby={'verifier-tab-' + activeTab}>
      {activeTab === 'general' && <div style={blockRow}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={labelCell}>
            <div style={fieldTitle}>{t['settings.profile.title']}</div>
            <div style={fieldHelp}>{t['settings.profile.hint']}</div>
          </div>
          {currentProfile === 'custom' && <span style={badgeStyle}>{t['settings.profile.custom']}</span>}
        </div>
        {renderSegment<ProfileId | ''>(t['settings.profile.title'], PROFILES.map(profile => ({
          value: profile.id as ProfileId | '',
          label: translate(profile.titleKey) ?? profile.id,
        })), currentProfile === 'custom' ? '' : currentProfile, picked => {
          if (picked === '') return
          setSaveState(null)
          setDraft(current => (current ? applyProfile(current, picked, criteriaCount) : current))
        })}
      </div>}

      {sections.map(entry => {
        const title = translate(entry.section.titleKey) ?? entry.section.id
        const advanced = entry.section.tier === 'advanced'
        const open = !advanced || openSections[entry.section.id] === true
        const summary = advanced && !open ? sectionSummary(entry.section.id, draft, translate, format) : ''
        const heading = <>
          <span style={sectionHeadingStyle}>{title}</span>
          {advanced && <span style={badgeStyle}>{t['settings.advancedBadge']}</span>}
          {summary && <span style={sectionSummaryStyle}>{summary}</span>}
          {advanced && <span style={{ marginLeft: summary ? 0 : 'auto', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>}
        </>
        return <section key={entry.section.id} style={group} data-section={entry.section.id}>
          {advanced
            ? <button type="button" style={{ ...sectionTitle, cursor: 'pointer' }} aria-expanded={open} aria-label={tFormat(translate(open ? 'settings.sectionCollapse' : 'settings.sectionExpand') ?? '', { title })} onClick={() => setSectionOpen(entry.section.id, !open)}>{heading}</button>
            : <div style={sectionTitle}>{heading}</div>}
          {open && entry.fields.map(field => (field.kind === 'custom'
            ? field.key === 'extraJudges' ? renderJudges() : field.key === 'iotThinkingProvider' ? renderThinkingRoute() : field.key === 'iotThinkingTargets' ? renderThinkingTargets() : null
            : renderRow(field)))}
          {open && entry.section.id === 'tools' && !draft.enabled && <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' }}>{t['field.enabled.warnDisabled']}</p>}
          {open && entry.section.id === 'autoVerify' && draft.autoVerifyMode !== 'manual' && <div style={{ padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            <p style={{ margin: 0 }}>{t['field.autoVerify.warnNotice']}</p>
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' }}>{t['field.autoVerify.flowSummary']}</summary>
              <p style={{ margin: '6px 0 0' }}>{t['field.autoVerify.flow']}</p>
            </details>
          </div>}
          {open && entry.section.id === 'budgets' && <div style={{ padding: '12px 0' }}><Button variant="outline" disabled={readOnly} onClick={fillRecommended}>{t['settings.recommend']}</Button></div>}
        </section>
      })}
      </div>
    </div>

    {loaded.failures.length > 0 && <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-state-warn-label)', fontSize: 12, lineHeight: '18px' }}>
      <div style={{ fontWeight: 500, marginBottom: 3 }}>{t['settings.catalogFailures']}</div>
      {loaded.failures.map(failure => <div key={failure}>{failure}</div>)}
    </div>}
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
    {[0,.25,.5,.75,1].map(ratio=><g key={ratio}><line x1={pad.l} x2={width-pad.r} y1={pad.t+innerH*ratio} y2={pad.t+innerH*ratio} stroke="var(--dsw-alias-border-l2)"/><text x={pad.l-8} y={pad.t+innerH*ratio+4} textAnchor="end" fontSize="10" fill="var(--dsw-alias-label-secondary)">{Math.round(max*(1-ratio))}</text></g>)}
    {rows.map((row,index)=><rect key={row.date} x={x(index)-barWidth/2} y={y(row.invocations)} width={barWidth} height={pad.t+innerH-y(row.invocations)} rx="2" fill={chartBarColor} opacity=".82"/>)}
    <polyline points={points} fill="none" stroke={chartLineColor} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/>
    {rows.map((row,index)=>index%step===0||index===rows.length-1?<text key={row.date} x={x(index)} y={height-14} textAnchor="middle" fontSize="10" fill="var(--dsw-alias-label-secondary)">{Number(row.date.slice(5,7))}/{Number(row.date.slice(8,10))}</text>:null)}
  </svg><div style={{display:'flex',justifyContent:'center',gap:18,...muted}}><span><i style={{display:'inline-block',width:8,height:8,borderRadius:2,background:chartBarColor,marginRight:6}}/>{t['chart.legendToolCalls']}</span><span><i style={{display:'inline-block',width:14,height:2,background:chartLineColor,marginRight:6,verticalAlign:'middle'}}/>{t['chart.legendModelCalls']}</span></div></div>
}

export function StatisticsPage({ sessionId, rpc, isGlobal, blankComposerSeat }: StatisticsPageProps) {
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
  // Details are a controlled disclosure rather than a per-row <details>: both entry points then sit
  // on the SAME line and each panel opens directly beneath it, instead of the snapshot landing
  // under a details block that happens to be expanded.
  const [openDetails, setOpenDetails] = useState<string | null>(null)
  // A read-only dashboard has nothing to type into, yet the Conversation shell renders its
  // composer for every View. The handle is only present on the Conversation View instance, and
  // disposing it on unmount brings the real card back with its draft intact. Mount-only: the
  // takeover belongs to this View's lifetime, and a host that rebuilds the injected props object
  // must not make the seat flap between registrations.
  const seatHandle = useRef(blankComposerSeat)
  seatHandle.current = blankComposerSeat
  useEffect(() => {
    const take = seatHandle.current
    if (typeof take !== 'function') return undefined
    const dispose = take()
    return () => { dispose() }
  }, [])
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
          else if (result && result.ok === false) {
            // A rejection is the host's real answer — "no snapshot for this row" is one of them —
            // so it is shown as-is instead of being retried over the raw fetch endpoint.
            if (snapshotRequest.current === request) setSnapshot({ id, error: result.error?.message ?? t['recent.decisionMissing'] })
            return
          }
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
  // The same reservation can produce more than one row (a skip row carries the reason, the purchase
  // row carries the spend), so the pipeline is grouped by cycleId instead of drawn per row.
  const processCycles = useMemo(() => buildProcessCycles(data?.recent ?? [], t as unknown as Record<string, string>), [data?.recent, t])
  return <main style={{ height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '22px clamp(16px, 3vw, 38px) 48px', color: 'var(--dsw-alias-label-primary)', background: 'radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34 }}>
              <VerifierSidebarIcon size={26} />
            </span>
            <h2 style={{ margin: 0, fontSize: 23 }}>{isGlobal ? t['global.panelTitle'] : t['stats.pageTitle']}</h2>
          </div>
          <p style={{ margin: '7px 0 0 44px', ...muted }}>{isGlobal ? t['global.panelIntro'] : tFormat(t['stats.updatedAt'], { time: data ? dateTime(data.generatedAt, lang) : '--' })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--dsw-alias-bg-multi-select)', border: '1px solid var(--dsw-alias-border-l2)' }}>
            {[7, 30, 90].map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)} style={{ border: 0, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: days === value ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)', background: days === value ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent)' : 'transparent' }}>{tFormat(t['stats.daysUnit'], { days: value })}</button>)}
          </div>
          {Boolean(sessionId) && <button aria-pressed={sessionOnly} onClick={() => setSessionOnly(value => !value)} style={{ border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: sessionOnly ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)', background: sessionOnly ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)' : 'var(--dsw-alias-interactive-bg-hover)' }}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</button>}
          <button type="button" disabled={probe?.busy === true} onClick={() => void runProbe()} style={{ border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 9, padding: '7px 11px', cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' }}>{probe?.busy === true ? t['probe.running'] : t['probe.button']}</button>
          <button title={t['stats.refresh']} onClick={() => setRefresh(value => value + 1)} style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)', cursor: 'pointer' }}><IconRefresh size={16} /></button>
        </div>
      </header>
      {error && <div style={{ ...dashboardCard, padding: 18, borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' }}>{error}<div style={{ ...muted, marginTop: 6 }}>{t['stats.hostRestartHint']}</div></div>}
      {probe !== null && <section style={{ ...dashboardCard, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>{t['probe.title']}</strong><span style={muted}>{t['probe.note']}</span></div>
        {probe.error !== undefined && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>{probe.error}</div>}
        {probe.value !== undefined && <>
          <div style={{ ...muted, marginTop: 8 }}>{tFormat(t['probe.rubric'], { source: probe.value.rubric.source, count: probe.value.rubric.count, file: probe.value.rubric.file ?? '' })}</div>
          {probe.value.rubric.error !== undefined && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-state-warn-label)' }}>{tFormat(t['probe.rubricFallback'], { error: probe.value.rubric.error })}</div>}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {probe.value.judges.map(judge => <div key={judge.label + judge.model} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, padding: '9px 11px', borderRadius: 9, background: 'var(--dsw-alias-interactive-bg-hover)' }}>
              <span style={{ color: judge.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', fontWeight: 600 }}>{judge.ok ? 'OK' : t['probe.failed']}</span>
              <strong>{judge.label}</strong>
              <span style={muted}>{judge.provider}/{judge.model}</span>
              {judge.ok ? <>
                {judge.channel !== undefined && <span style={muted}>{tFormat(t['probe.channel'], { channel: judge.channel })}{judge.channelProbed === true ? ' · ' + t['probe.reprobed'] : ''}</span>}
                {judge.scoreA !== undefined && judge.scoreB !== undefined && <span style={muted}>{tFormat(t['probe.scores'], { a: formatPercentage(judge.scoreA), b: formatPercentage(judge.scoreB) })}</span>}
                <span style={muted}>{tFormat(t['probe.latency'], { ms: String(judge.latencyMs) })}</span>
                {judge.calls !== undefined && <span style={muted}>{tFormat(t['probe.calls'], { calls: String(judge.calls) })}</span>}
              </> : <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{judge.error}</span>}
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
            <span style={muted}>{t['stats.successCalls']}</span><strong>{compact(totals?.successes ?? 0, lang)} <small style={{ color: 'var(--dsw-alias-state-success-primary)' }}>▲ {((totals?.successRate ?? 0) * 100).toFixed(1)}%</small></strong>
            <span style={muted}>{t['stats.failedCalls']}</span><strong>{compact(totals?.failures ?? 0, lang)}</strong>
            <span style={muted}>{t['stats.avgDuration']}</span><strong>{duration(totals?.averageDurationMs ?? 0)}</strong>
          </div>
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <Metric label={t['metric.cacheHitRate']} value={((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + '%'} note={tFormat(t['metric.cacheHitNote'], { hits: compact(totals?.cacheHits ?? 0, lang), total: compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0), lang) })} accent="var(--dsw-alias-state-success-primary)" />
          <Metric label={t['metric.prefixCacheHitRate']} value={((totals?.prefixCacheHitRate ?? 0) * 100).toFixed(1) + '%'} note={tFormat(t['metric.prefixCacheHitNote'], { cached: compact(totals?.cachedInputTokens ?? 0, lang), input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang) })} />
          <Metric label={t['metric.tokens']} value={compact(totals?.tokens ?? 0, lang)} note={tFormat(t['metric.tokensNote'], { input: compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0), lang), output: compact(totals?.outputTokens ?? 0, lang) })} />
          <Metric label={t['metric.avgModelCalls']} value={(totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : '0'} note={tFormat(t['metric.avgModelCallsNote'], { attempts: compact(totals?.attempts ?? 0, lang), retries: compact(totals?.retries ?? 0, lang) })} />
          <Metric label={t['metric.scoringMode']} value={compact(totals?.topLogprobScores ?? 0, lang)} note={tFormat(t['metric.scoringModeNote'], { explicit: compact(totals?.explicitTagScores ?? 0, lang) })} />
        </section>
        <section style={{ ...dashboardCard, padding: '18px 20px 16px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}><strong>{t['chart.title']}</strong><span style={muted}>{sessionOnly ? t['stats.currentSession'] : t['stats.allSessions']}</span></div><TrendChart daily={data?.daily ?? []} days={days} lang={lang} /></section>
        <section style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['table.title']}</strong><span style={muted}>{tFormat(t['table.toolCount'], { count: (data?.tools ?? []).length })}</span></div><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}><thead><tr style={{ textAlign: 'left', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)' }}>{[t['table.colTool'], t['table.colInvocations'], t['table.colSuccessRate'], t['table.colAvgDuration'], t['table.colModelCalls'], t['table.colTokens'], t['table.colCacheHits'], t['table.colEstimatedCost']].map(value => <th key={value} style={{ padding: '10px 12px', fontWeight: 500 }}>{value}</th>)}</tr></thead><tbody>{(data?.tools ?? []).map(tool => <tr key={tool.toolName} style={{ borderTop: '1px solid var(--dsw-alias-border-l2)' }}><td style={{ padding: '13px 12px' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toolColors[tool.toolName] ?? '#8691a8', marginRight: 8 }} /><strong>{labels[tool.toolName] ?? tool.toolName}</strong><div style={{ ...muted, margin: '3px 0 0 16px' }}>{tool.toolName}</div></td><td style={{ padding: '13px 12px' }}>{compact(tool.invocations, lang)}</td><td style={{ padding: '13px 12px', color: tool.successRate >= .9 ? 'var(--dsw-alias-state-success-primary)' : tool.successRate >= .7 ? 'var(--dsw-alias-state-warn-label)' : 'var(--dsw-alias-state-error-primary)' }}>{(tool.successRate * 100).toFixed(1)}%</td><td style={{ padding: '13px 12px' }}>{duration(tool.averageDurationMs)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.calls, lang)}</td><td style={{ padding: '13px 12px' }}>{compact(tool.tokens, lang)}</td><td style={{ padding: '13px 12px' }}>{tool.cacheHits}/{tool.cacheHits + tool.cacheMisses}</td><td style={{ padding: '13px 12px' }}>{money(tool.estimatedCostUsd)}</td></tr>)}{(data?.tools.length ?? 0) === 0 && <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', ...muted }}>{t['table.empty']}</td></tr>}</tbody></table></div></section>
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(290px,.45fr)', gap: 16, alignItems: 'start' }}><div style={{ ...dashboardCard, padding: '18px 18px 8px', overflow: 'hidden' }}><div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 2px 12px' }}><strong>{t['recent.title']}</strong><span style={muted}>{t['recent.maxCount']}</span></div><div style={{ maxHeight: 360, overflow: 'auto' }}>{(data?.recent ?? []).map(item => {
            const verdictInfo = item.verdict ? formatVerdictDetails(item.verdict, t) : undefined
            const failed = !item.success || (verdictInfo ? verdictInfo.isFailed : false)
            const detailsOpen = openDetails === item.id
            const panelStyle: React.CSSProperties = { margin: '8px 0 0 15px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-interactive-bg-hover)', fontSize: 11 }
            // The row is a column: identity plus timing on the first line, then the two controls on
            // one line, then whichever panel they opened. Panels therefore span the whole row
            // instead of being squeezed into the identity column.
            return <div key={item.id} style={{ padding: '11px 8px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1fr) auto', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' }} />
                  <strong style={{ fontSize: 13 }}>{labels[item.toolName] ?? item.toolName}</strong>
                  <span style={muted}>{item.provider}/{item.model}</span>
                </div>
                {!item.success && <div title={item.errorMessage} style={{ margin: '5px 0 0 15px', fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.errorMessage ?? item.errorName}</div>}
                {item.verdict && verdictInfo && <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 0 0 15px', fontSize: 11 }}>
                  {verdictInfo.outcomeText && <span style={{ padding: '1px 5px', borderRadius: 4, fontWeight: 500, fontSize: 11, ...toneChip(verdictInfo.isFailed ? 'error' : item.verdict.outcome === 'tie' ? 'warn' : 'pass') }}>{verdictInfo.outcomeText}</span>}
                  {verdictInfo.phaseText && <span style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)' }}>{verdictInfo.phaseText}</span>}
                  {verdictInfo.scoreText && <span style={{ color: (typeof item.verdict.threshold === 'number' && typeof item.verdict.score === 'number' && item.verdict.score < item.verdict.threshold) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)' }}>{verdictInfo.scoreText}</span>}
                  {verdictInfo.checkpointsText && <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{verdictInfo.checkpointsText}</span>}
                  {verdictInfo.criteriaText && <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{verdictInfo.criteriaText}</span>}
                  {verdictInfo.winnerText && <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{verdictInfo.winnerText}</span>}
                  {item.route && <span style={{ padding: '1px 5px', borderRadius: 4, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', ...toneChip('neutral') }}>{tFormat(t['recent.route.badge'], { stage: item.route.stage, destination: item.route.destination })}</span>}
                  {item.stats.usageIncomplete === true && <span style={{ padding: '1px 5px', borderRadius: 4, fontSize: 11, ...toneChip('warn') }}>{t['recent.detail.usageIncomplete']}</span>}
                </div>}
              </div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12 }}>{duration(item.durationMs)}</div><div style={{ ...muted, marginTop: 3 }}>{dateTime(item.startedAt, lang)}</div></div>
              </div>
              {/* Both entry points sit on ONE line, and each panel opens directly beneath the button
                  that opened it: the snapshot used to render after a details block that merely
                  happened to be expanded, which read as if it belonged to that block. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0 15px' }}>
                <button type="button" aria-expanded={snapshot?.id === item.id} onClick={() => void toggleSnapshot(item.id)} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)', border: '1px solid var(--dsw-alias-border-l2)' }}>{snapshot?.id === item.id ? t['recent.decisionHide'] : t['recent.decision']}</button>
                <button type="button" aria-expanded={detailsOpen} onClick={() => setOpenDetails(current => current === item.id ? null : item.id)} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-interactive-bg-hover)', border: '1px solid var(--dsw-alias-border-l2)' }}>{detailsOpen ? t['recent.detailsHide'] : t['recent.details']}</button>
              </div>
              {snapshot?.id === item.id && <div style={panelStyle}>
                {snapshot.error !== undefined && <div style={{ fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' }}>{snapshot.error}</div>}
                {snapshot.record === undefined && snapshot.error === undefined && <div style={{ ...muted, fontSize: 11 }}>{t['recent.decisionLoading']}</div>}
                {snapshot.record !== undefined && snapshot.record.calls.length === 0 && <div style={{ ...muted, fontSize: 11 }}>{t['recent.decisionEmpty']}</div>}
                {(snapshot.record?.calls ?? []).map((call, index) => <div key={index} style={{ marginBottom: index === snapshot.record!.calls.length - 1 ? 0 : 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>{call.label} · {call.channel}{call.score === undefined ? '' : ' · ' + formatPercentage(call.score)}</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>{t['recent.decisionPrompt']}</div>
                  <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--dsw-alias-markdown-code-block)', padding: '6px 8px', borderRadius: 6 }}>{call.prompt}</pre>
                  <div style={{ fontSize: 11, marginTop: 4 }}>{t['recent.decisionOutput']}</div>
                  <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--dsw-alias-markdown-code-block)', padding: '6px 8px', borderRadius: 6 }}>{call.output}</pre>
                </div>)}
              </div>}
              {detailsOpen && <div style={panelStyle}>
                    {(item.verdict?.criteria?.length ?? 0) > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) auto auto', gap: '4px 14px', marginBottom: 8 }}>
                      <strong style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t['recent.detail.criterion']}</strong>
                      <strong style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t['recent.detail.score']}</strong>
                      <strong style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t['recent.detail.threshold']}</strong>
                      {item.verdict!.criteria!.map(criterion => {
                        const threshold = typeof item.verdict!.threshold === 'number' ? item.verdict!.threshold : undefined
                        const missed = threshold !== undefined && criterion.score < threshold
                        return <Fragment key={criterion.id}>
                          <span>{criterion.id}</span>
                          <span style={{ color: missed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' }}>{formatPercentage(criterion.score)}</span>
                          <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{threshold === undefined ? '—' : formatPercentage(threshold)}</span>
                        </Fragment>
                      })}
                    </div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, color: 'var(--dsw-alias-label-secondary)' }}>
                      <span>{tFormat(t['recent.detail.calls'], { calls: compact(item.stats.calls, lang) })}</span>
                      <span>{tFormat(t['recent.detail.tokens'], { input: compact(item.stats.inputTokens, lang), cached: compact(item.stats.cachedInputTokens, lang), output: compact(item.stats.outputTokens, lang) })}</span>
                      <span>{tFormat(t['recent.detail.scoreCache'], { hits: compact(item.stats.cacheHits, lang), misses: compact(item.stats.cacheMisses, lang) })}</span>
                      <span>{tFormat(t['recent.detail.prefixCache'], { rate: ((item.stats.inputTokens + item.stats.cachedInputTokens) > 0 ? (100 * item.stats.cachedInputTokens / (item.stats.inputTokens + item.stats.cachedInputTokens)).toFixed(0) : '0') + '%' })}</span>
                      <span>{tFormat(t['recent.detail.cost'], { cost: money(item.stats.estimatedCostUsd) })}</span>
                      {item.route && <span>{tFormat(t['recent.detail.route'], { cycle: item.route.cycleId, trigger: item.route.trigger, stage: item.route.stage, destination: item.route.destination, attempt: item.route.attempt ?? 1 })}</span>}
                      {item.route && item.route.reservedCalls !== undefined && <span>{tFormat(t['recent.detail.routeReserved'], { reserved: compact(item.route.reservedCalls, lang), actual: compact(item.stats.calls, lang) })}</span>}
                      {item.route?.skipReason !== undefined && <span>{tFormat(t['recent.detail.routeSkip'], { reason: item.route.skipReason })}</span>}
                      {item.route?.replayed !== undefined && <span>{tFormat(t['recent.detail.routeProcess'], { replayed: item.route.replayed === 'candidate' ? t['recent.detail.replayCandidate'] : item.route.replayed === 'original' ? t['recent.detail.replayOriginal'] : t['recent.detail.replayNone'], generated: compact(item.route.generatedCalls ?? 0, lang), judges: compact(item.route.judgeCalls ?? 0, lang) })}</span>}
                      {item.route?.sameCandidate === true && <span>{t['recent.detail.routeSameCandidate']}</span>}
                      {item.route?.alternativeAugmented === true && <span>{t['recent.detail.routeAugmented']}</span>}
                      {item.route?.alternativeModel !== undefined && <span>{tFormat(t['recent.detail.routeAlternativeModel'], { model: item.route.alternativeModel })}</span>}
                      {(item.stats.channelFallbacks ?? 0) > 0 && <span>{tFormat(t['recent.detail.channelFallback'], { count: compact(item.stats.channelFallbacks ?? 0, lang) })}</span>}
                    </div>
                  </div>}
            </div>
          })}{(data?.recent.length ?? 0) === 0 && <div style={{ padding: 24, textAlign: 'center', ...muted }}>{t['recent.empty']}</div>}</div></div>
          <div style={{ ...dashboardCard, padding: '18px' }}><strong>{t['models.title']}</strong><div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{(data?.models ?? []).map(model => <div key={model.provider + '\0' + model.model} style={{ padding: '11px 12px', borderRadius: 10, background: 'var(--dsw-alias-interactive-bg-hover)' }}><div style={{ fontWeight: 650, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.model}</div><div style={{ ...muted, marginTop: 3 }}>{model.provider}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 12 }}><span>{tFormat(t['models.calls'], { calls: compact(model.calls, lang) })}</span><span>{tFormat(t['models.tokens'], { tokens: compact(model.tokens, lang) })}</span><strong>{money(model.estimatedCostUsd)}</strong></div></div>)}{(data?.models.length ?? 0) === 0 && <div style={muted}>{t['models.empty']}</div>}</div></div></section>
        {/* The recent list answers "what did each call cost"; this block answers "what happened to
            each process-selection cycle", which is the only place the skip reasons and the replay
            decision are visible together. Hidden entirely when no cycle ran in the range. */}
        {processCycles.length > 0 && <section style={{ ...dashboardCard, padding: '18px 20px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong>{t['processCycles.title']}</strong>
            <span style={muted}>{tFormat(t['processCycles.note'], { count: processCycles.length })}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {processCycles.map(cycle => <div key={cycle.cycleId} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'var(--dsw-alias-interactive-bg-hover)' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span title={cycle.cycleId} style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--dsw-alias-label-secondary)' }}>{tFormat(t['processCycles.cycle'], { cycle: shortCycleId(cycle.cycleId) })}</span>
                {/* The full id stays in the title: the head is enough to tell two cycles apart. */}
                {cycle.startedAt > 0 && <span style={muted}>{dateTime(cycle.startedAt, lang)}</span>}
                {/* Only worth saying when the grouping actually folded more than one row together. */}
                {cycle.rows > 1 && <span style={muted}>{tFormat(t['processCycles.rows'], { rows: cycle.rows })}</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {cycle.stages.map((stage, index) => <Fragment key={stage.stage}>
                  {index > 0 && <span aria-hidden="true" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>→</span>}
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 11, ...toneChip(stage.tone) }}>{stage.text}</span>
                </Fragment>)}
              </div>
            </div>)}
          </div>
        </section>}
      </>}
    </div>
  </main>
}

/**
 * The statistics mark: a brand-gradient tile carrying the verifier's shield-and-check.
 *
 * The host's glyph vocabulary is monochrome by contract (every icon draws on
 * `currentColor`, and the guide capsule pins that ink to a grey label alias), so a
 * host icon registered as a guide entry always reads as grey-on-navy — dim next
 * to a plugin whose glyph is coloured. This mark therefore ships its own paint:
 * the same violet→blue→teal ramp the dashboard header already wears, a white
 * shield, and a check cut back out of the ramp in the badge's own coordinates.
 *
 * Props follow the host's `IconProps` shape (`size` is the square edge in px,
 * `className` is for placement), so the same component serves the guide capsule
 * (26px) and the dashboard header (26px in a 34px well).
 *
 * @param props - rendered size and placement class.
 * @returns the statistics badge.
 */
export function VerifierSidebarIcon({ size = 26, className }: { size?: number; className?: string }) {
  // useId keeps two badges on one page from sharing a gradient: a duplicate id
  // would make the second one paint from the first one's <defs>. Colons are
  // stripped because the id is referenced as a url(#…) fragment.
  const gradientId = `llm-verifier-badge-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const paint = `url(#${gradientId})`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="1.5" y1="1" x2="22.5" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8A63FF" />
          <stop offset="0.5" stopColor="#4F7BFF" />
          <stop offset="1" stopColor="#2FC5C9" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7.5" fill={paint} />
      <path d="M12 4.4 18.4 6.9v5.2c0 3.6-2.7 6.4-6.4 7.6-3.7-1.2-6.4-4-6.4-7.6V6.9L12 4.4Z" fill="#FFFFFF" fillOpacity="0.94" />
      <path d="M8.8 12.3 11 14.5 15.3 9.7" stroke={paint} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
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
/** Poll interval of the chat chip while a turn runs (the answer is in-memory and cheap). */
export const VERIFIER_ACTIVITY_POLL_MS = 1_000

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
async function readVerifierActivity(rpc: any, sessionId: string, signal: AbortSignal): Promise<ActivityChipView | null> {
  // The wire kind is historical (it once meant P06 only) and is kept so a page holding the older
  // client bundle keeps talking to the same endpoint.
  const payload = { kind: 'process', sessionId }
  try {
    if (rpc && typeof rpc.call === 'function') {
      try {
        const result = await rpc.call('/api', 'llm-verifier/statistics', payload, signal)
        if (result && result.ok === true) return result.value as ActivityChipView
        if (result && result.ok === false) return null
      } catch (rpcError) {
        if (signal.aborted) return null
        console.warn('[llm-verifier] activity rpc.call failed, trying fetch fallback:', rpcError)
      }
    }
    const response = await fetch('/api/llm-verifier/statistics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal })
    const body = await response.json().catch(() => undefined)
    const value = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined
    return value === undefined || value === null ? null : value as ActivityChipView
  } catch { return null }
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
const activityCard: React.CSSProperties = {
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
}
const activityTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-secondary)',
}

/**
 * The chat-visible half of the automatic stages: what the plugin is doing for this session right now.
 *
 * It answers the pauses the chat cannot explain: a P06 cycle buffers the reply, a routed review and
 * the final acceptance hold the turn open while the judges run, and a PASSING acceptance otherwise
 * says nothing at all. Polls only while a read can change the answer — while the turn runs, and
 * while something is still being shown — so an idle conversation makes no requests.
 * @param props - the input-dock owner values (the session snapshot) plus the injected RPC handle.
 */
export function VerifierActivityChip({ session, rpc }: { session?: { sessionId?: unknown; running?: unknown } | null; rpc?: any }) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const raw = session?.sessionId
  const sessionId = raw === undefined || raw === null || String(raw) === '' ? undefined : String(raw)
  const running = session?.running === true
  const [view, setView] = useState<ActivityChipView | null>(null)
  const rendered = verifierActivityText(view, t)
  // Keyed on whether anything is RENDERED rather than on whether a read answered: an empty view has
  // to stop the polling too, or a conversation that once ran a cycle would poll forever.
  const showing = rendered !== null
  useEffect(() => {
    if (sessionId === undefined) { setView(null); return }
    if (!running && !showing) { setView(null); return }
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      const value = await readVerifierActivity(rpc, sessionId, controller.signal)
      if (!cancelled) setView(value)
    }
    void load()
    const timer = setInterval(() => { void load() }, VERIFIER_ACTIVITY_POLL_MS)
    return () => { cancelled = true; clearInterval(timer); controller.abort() }
  }, [sessionId, running, showing, rpc])
  if (rendered === null) return null
  const dotState: StateDotState = rendered.tone === 'busy' ? 'ongoing' : rendered.tone === 'ok' ? 'done' : 'error'
  return (
    <div style={activityCard} role="status" aria-live="polite">
      <StateDot state={dotState} size={8} />
      <span style={activityTextStyle}>{rendered.text}</span>
    </div>
  )
}

/**
 * Marker the blank-composer takeover elects with; the value itself is never read.
 *
 * Any non-null selector result elects the entry, so a shared frozen object keeps the selector pure
 * and allocation-free.
 */
const BLANK_COMPOSER = Object.freeze({ blank: true })

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as any
  const remote = ctx.remote
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
  const blankComposerSeat = (): (() => void) => {
    try {
      const dispose = ctx.slots.register({
        name: 'conversation.composer' as never,
        id: 'llm-verifier-blank',
        priority: 1000,
        select: () => BLANK_COMPOSER,
      } as never, (() => null) as never)
      return typeof dispose === 'function' ? dispose : () => {}
    } catch (error) {
      console.warn('[llm-verifier] composer takeover registration failed:', error)
      return () => {}
    }
  }
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
    inject: () => ({ rpc: connection.rpc, blankComposerSeat }),
  }, StatisticsPage as never))
  // P06 buffers the main reply (the chat looks frozen) and the routed/final stages hold the turn
  // open with nothing to show. The dock sits directly above the composer — where the user is already
  // looking — and disappears on its own.
  ctx.slots.inject('conversation.input.dock' as never, () => ctx.slots.register({
    name: 'conversation.input.dock' as never,
    id: 'llm-verifier-activity',
    order: 30,
    inject: () => ({ rpc: connection.rpc }),
  } as never, VerifierActivityChip as never))

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
          // The host keys each guide cell by this id and hands it to the owner as `entryId`, so an
          // entry without one renders as `undefined` — a stable literal keeps the cell identified.
          id: VERIFIER_TAB_ID,
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
