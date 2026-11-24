/**
 * Shared per-session activity and summary monitor for the chat chip and the DSH Session panel.
 *
 * Pure browser-safe state and view-model projections: reference-counted watchers prevent duplicate
 * polling when the dock chip, panel section, section title actions, and header indicator mount for
 * the same session simultaneously.
 */
import {
  compact,
  duration,
  formatVerdictDetails,
  money,
  tFormat,
  toolLabels,
  verifierActivityText,
  type ActivityChipView,
  type I18nDict,
  type VerdictSummary,
} from './client-i18n.ts'

/** Poll interval while a session is running or displaying a live/settling verifier activity. */
export const VERIFIER_ACTIVITY_POLL_MS = 1_000

/** Rows shown in the Session panel before the host fold control holds the rest back. */
export const SESSION_PANEL_FOLD_LIMIT = 5

/** Minimum trailing rows required to show the fold control (since the control occupies one row). */
export const SESSION_PANEL_FOLD_MIN_HIDDEN = 2

export interface VerifierRpcLike {
  call?(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
    ok?: boolean
    value?: unknown
    error?: { message?: string }
  }>
}

export interface SessionVerifierRecordView {
  id: string
  toolName: string
  startedAt: number
  durationMs: number
  success: boolean
  errorName?: string
  errorMessage?: string
  provider: string
  model: string
  stats: {
    calls: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheHits: number
    cacheMisses: number
    estimatedCostUsd: number
  }
  verdict?: VerdictSummary
}

export interface SessionVerifierSummaryView {
  invocations: number
  successes: number
  failures: number
  calls: number
  tokens: number
  estimatedCostUsd: number
  recent: readonly SessionVerifierRecordView[]
}

export interface SessionVerifierSnapshot {
  activity: ActivityChipView | null
  summary: SessionVerifierSummaryView | null
  loading: boolean
  error: string | null
}

export type SessionPanelDotState = 'idle' | 'ongoing' | 'done' | 'warning' | 'error'

export interface SessionPanelIndicatorState {
  kind: 'busy' | 'attention'
  color: string
  label: string
}

export interface SessionPanelRecordPresentation {
  dotState: SessionPanelDotState
  statusLabel: string
  title: string
  detail: string
  trailing: string
  hoverTitle: string
  hoverLines: string[]
  hoverFacts: Array<{ kind: 'tokens' | 'duration'; label: string }>
}

const EMPTY_SNAPSHOT: SessionVerifierSnapshot = Object.freeze({
  activity: null,
  summary: null,
  loading: false,
  error: null,
})

function activitySignature(view: ActivityChipView | null): string {
  if (view === null) return ''
  return JSON.stringify([
    view.active?.stage ?? null,
    view.active?.phase ?? null,
    view.active?.destination ?? null,
    view.active?.candidates ?? null,
    view.active?.expectedCalls ?? null,
    view.settled?.stage ?? null,
    view.settled?.outcome ?? null,
    view.thinking?.startedAt ?? null,
  ])
}

function hasLiveActivity(view: ActivityChipView | null): boolean {
  if (view === null) return false
  return view.active !== undefined || view.thinking !== undefined
}

function hasAnyActivity(view: ActivityChipView | null): boolean {
  if (view === null) return false
  return view.active !== undefined || view.thinking !== undefined || view.settled !== undefined
}

/** Query the verifier's `/api/llm-verifier/statistics` endpoint with the host transport priority. */
export async function queryVerifierEndpoint(
  rpc: VerifierRpcLike | undefined,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  options: { legacyEndpoint?: 'statistics' | 'process' } = {},
): Promise<unknown> {
  if (rpc && typeof rpc.call === 'function') {
    try {
      const result = await rpc.call('/api', 'llm-verifier/statistics', payload, signal)
      if (result && result.ok === true) return result.value
      if (result && result.ok === false) return null
    } catch {
      if (signal.aborted) return null
    }
  }
  try {
    const response = await fetch('/api/llm-verifier/statistics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    if (response.ok) {
      const body = await response.json().catch(() => undefined) as { ok?: boolean; value?: unknown; result?: { ok?: boolean; value?: unknown } } | undefined
      const value = body?.ok === true ? body.value : body?.result?.ok === true ? body.result.value : undefined
      if (value !== undefined && value !== null) return value
    }
  } catch {
    if (signal.aborted) return null
  }
  if (options.legacyEndpoint && rpc && typeof rpc.call === 'function') {
    try {
      const legacy = await rpc.call('/llm-verifier', options.legacyEndpoint, payload, signal)
      if (legacy && legacy.ok === true) return legacy.value
    } catch {
      return null
    }
  }
  return null
}

function parseSummaryOverview(raw: unknown): SessionVerifierSummaryView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as {
    totals?: {
      invocations?: unknown
      successes?: unknown
      failures?: unknown
      calls?: unknown
      tokens?: unknown
      estimatedCostUsd?: unknown
    }
    recent?: unknown
  }
  const totals = row.totals
  if (typeof totals !== 'object' || totals === null) return null
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
  const recent = Array.isArray(row.recent) ? row.recent as SessionVerifierRecordView[] : []
  return {
    invocations: num(totals.invocations),
    successes: num(totals.successes),
    failures: num(totals.failures),
    calls: num(totals.calls),
    tokens: num(totals.tokens),
    estimatedCostUsd: num(totals.estimatedCostUsd),
    recent,
  }
}

export interface VerifierSessionMonitorDeps {
  readActivity?: (sessionId: string, signal: AbortSignal) => Promise<ActivityChipView | null>
  readSummary?: (sessionId: string, signal: AbortSignal) => Promise<SessionVerifierSummaryView | null>
  pollMs?: number
}

interface WatcherEntry {
  running: boolean
  includeSummary: boolean
}

interface SessionEntry {
  snapshot: SessionVerifierSnapshot
  listeners: Set<() => void>
  watchers: Set<WatcherEntry>
  timer: ReturnType<typeof setInterval> | null
  activityAbort: AbortController | null
  summaryAbort: AbortController | null
  wasRunning: boolean
  wasLiveActivity: boolean
  lastSettledKey: string
  summaryLoaded: boolean
}

/**
 * Reference-counted per-session verifier state store shared across the composer activity chip,
 * Session panel section, title actions, and toggle indicator.
 */
export class VerifierSessionMonitor {
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly readActivity: (sessionId: string, signal: AbortSignal) => Promise<ActivityChipView | null>
  private readonly readSummary: (sessionId: string, signal: AbortSignal) => Promise<SessionVerifierSummaryView | null>
  private readonly pollMs: number
  private disposed = false

  constructor(rpc?: VerifierRpcLike, deps: VerifierSessionMonitorDeps = {}) {
    this.pollMs = deps.pollMs ?? VERIFIER_ACTIVITY_POLL_MS
    this.readActivity = deps.readActivity ?? (async (sessionId, signal) => {
      const value = await queryVerifierEndpoint(rpc, { kind: 'process', sessionId }, signal, { legacyEndpoint: 'process' })
      return value !== null && typeof value === 'object' ? value as ActivityChipView : null
    })
    this.readSummary = deps.readSummary ?? (async (sessionId, signal) => {
      const value = await queryVerifierEndpoint(rpc, {
        fromMs: 0,
        toMs: Date.now() + 86_400_000,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        recentLimit: 20,
        sessionId,
      }, signal, { legacyEndpoint: 'statistics' })
      return parseSummaryOverview(value)
    })
  }

  getSnapshot(sessionId: string): SessionVerifierSnapshot {
    return this.sessions.get(sessionId)?.snapshot ?? EMPTY_SNAPSHOT
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    const entry = this.ensure(sessionId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      this.cleanupIfUnused(sessionId, entry)
    }
  }

  watch(sessionId: string, options: { running: boolean; includeSummary?: boolean }): () => void {
    if (this.disposed) return () => {}
    const entry = this.ensure(sessionId)
    const watcher: WatcherEntry = {
      running: options.running,
      includeSummary: options.includeSummary === true,
    }
    entry.watchers.add(watcher)
    this.reconcile(sessionId, entry)
    return () => {
      entry.watchers.delete(watcher)
      this.reconcile(sessionId, entry)
      this.cleanupIfUnused(sessionId, entry)
    }
  }

  refreshSummary(sessionId: string): void {
    if (this.disposed) return
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return
    void this.fetchSummary(sessionId, entry)
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.sessions.values()) {
      this.stopEntry(entry)
    }
    this.sessions.clear()
  }

  private ensure(sessionId: string): SessionEntry {
    let entry = this.sessions.get(sessionId)
    if (entry === undefined) {
      entry = {
        snapshot: EMPTY_SNAPSHOT,
        listeners: new Set(),
        watchers: new Set(),
        timer: null,
        activityAbort: null,
        summaryAbort: null,
        wasRunning: false,
        wasLiveActivity: false,
        lastSettledKey: '',
        summaryLoaded: false,
      }
      this.sessions.set(sessionId, entry)
    }
    return entry
  }

  private publish(entry: SessionEntry, next: SessionVerifierSnapshot): void {
    entry.snapshot = next
    for (const listener of entry.listeners) {
      try { listener() } catch { /* isolate throwing UI listeners */ }
    }
  }

  private stopEntry(entry: SessionEntry): void {
    if (entry.timer !== null) {
      clearInterval(entry.timer)
      entry.timer = null
    }
    entry.activityAbort?.abort()
    entry.activityAbort = null
    entry.summaryAbort?.abort()
    entry.summaryAbort = null
  }

  private cleanupIfUnused(sessionId: string, entry: SessionEntry): void {
    if (entry.listeners.size > 0 || entry.watchers.size > 0) return
    this.stopEntry(entry)
    this.sessions.delete(sessionId)
  }

  private reconcile(sessionId: string, entry: SessionEntry): void {
    if (this.disposed) return
    let anyRunning = false
    let anySummary = false
    for (const watcher of entry.watchers) {
      if (watcher.running) anyRunning = true
      if (watcher.includeSummary) anySummary = true
    }
    const stoppedRunning = entry.wasRunning && !anyRunning
    entry.wasRunning = anyRunning

    if (anySummary && (!entry.summaryLoaded || stoppedRunning)) {
      void this.fetchSummary(sessionId, entry)
    }

    const shouldPoll = entry.watchers.size > 0 && (anyRunning || hasAnyActivity(entry.snapshot.activity))
    if (shouldPoll) {
      if (entry.timer === null) {
        void this.fetchActivity(sessionId, entry)
        entry.timer = setInterval(() => {
          void this.fetchActivity(sessionId, entry)
        }, this.pollMs)
      }
    } else {
      if (entry.timer !== null) {
        clearInterval(entry.timer)
        entry.timer = null
      }
      entry.activityAbort?.abort()
      entry.activityAbort = null
      if (entry.snapshot.activity !== null && !anyRunning) {
        this.publish(entry, { ...entry.snapshot, activity: null })
      }
    }
  }

  private async fetchActivity(sessionId: string, entry: SessionEntry): Promise<void> {
    if (this.disposed || this.sessions.get(sessionId) !== entry) return
    entry.activityAbort?.abort()
    const controller = new AbortController()
    entry.activityAbort = controller
    try {
      const next = await this.readActivity(sessionId, controller.signal)
      if (controller.signal.aborted || this.disposed || this.sessions.get(sessionId) !== entry) return
      const normalized = next && hasAnyActivity(next) ? next : null
      const prevSig = activitySignature(entry.snapshot.activity)
      const nextSig = activitySignature(normalized)
      const prevLive = entry.wasLiveActivity
      const nextLive = hasLiveActivity(normalized)
      entry.wasLiveActivity = nextLive
      const settledKey = normalized?.settled ? `${String(normalized.settled.stage)}:${String(normalized.settled.outcome)}` : ''
      const settledChanged = settledKey !== '' && settledKey !== entry.lastSettledKey
      entry.lastSettledKey = settledKey

      if (prevSig !== nextSig) {
        this.publish(entry, { ...entry.snapshot, activity: normalized })
      }
      const needsSummaryRefresh = (prevLive && !nextLive) || settledChanged
      if (needsSummaryRefresh && [...entry.watchers].some(watcher => watcher.includeSummary)) {
        void this.fetchSummary(sessionId, entry)
      }
      this.reconcile(sessionId, entry)
    } catch {
      // Activity failures stay silent so the chat composer never shows error noise.
    }
  }

  private async fetchSummary(sessionId: string, entry: SessionEntry): Promise<void> {
    if (this.disposed || this.sessions.get(sessionId) !== entry) return
    entry.summaryAbort?.abort()
    const controller = new AbortController()
    entry.summaryAbort = controller
    entry.summaryLoaded = true
    if (!entry.snapshot.loading) {
      this.publish(entry, { ...entry.snapshot, loading: true, error: null })
    }
    try {
      const summary = await this.readSummary(sessionId, controller.signal)
      if (controller.signal.aborted || this.disposed || this.sessions.get(sessionId) !== entry) return
      this.publish(entry, {
        ...entry.snapshot,
        summary: summary ?? entry.snapshot.summary,
        loading: false,
        error: null,
      })
    } catch (error) {
      if (controller.signal.aborted || this.disposed || this.sessions.get(sessionId) !== entry) return
      this.publish(entry, {
        ...entry.snapshot,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Toggle indicator state for `conversation.session.panel.indicator`.
 *
 * Follows DSH's Session panel indicator contract: hides while the panel is already shown, renders
 * the running dot during active verification or auxiliary thinking, and renders an attention dot
 * briefly after a rejected/failed settlement.
 */
export function sessionPanelIndicatorState(
  snapshot: SessionVerifierSnapshot,
  panelShown: boolean,
  t: I18nDict,
): SessionPanelIndicatorState | null {
  if (panelShown) return null
  const activity = snapshot.activity
  if (activity?.active !== undefined || activity?.thinking !== undefined) {
    return {
      kind: 'busy',
      color: 'var(--dsw-alias-state-business-primary)',
      label: t['sessionPanel.indicatorBusy'],
    }
  }
  const outcome = activity?.settled?.outcome
  if (outcome === 'rejected' || outcome === 'failed') {
    return {
      kind: 'attention',
      color: 'var(--dsw-alias-state-error-primary)',
      label: t['sessionPanel.indicatorAttention'],
    }
  }
  return null
}

/** Read-only summary beside the Session panel section heading (`conversation.session.panel.section.actions`). */
export function sessionPanelActionSummary(
  snapshot: SessionVerifierSnapshot,
  t: I18nDict,
): string | null {
  if (snapshot.activity?.active !== undefined || snapshot.activity?.thinking !== undefined) {
    return t['sessionPanel.running']
  }
  const summary = snapshot.summary
  if (!summary || summary.invocations <= 0) return null
  const issues = summary.recent.filter(record => {
    if (!record.success) return true
    const details = record.verdict ? formatVerdictDetails(record.verdict, t) : undefined
    return details?.isFailed === true
  }).length + Math.max(0, summary.failures - summary.recent.filter(r => !r.success).length)
  if (issues > 0) {
    return tFormat(t['sessionPanel.countAlert'], { count: summary.invocations, issues })
  }
  return tFormat(t['sessionPanel.count'], { count: summary.invocations })
}

/** Map one session verifier record onto the Session panel row and HoverCard details contract. */
export function sessionPanelRecordPresentation(
  record: SessionVerifierRecordView,
  lang: 'zh' | 'en',
  t: I18nDict,
): SessionPanelRecordPresentation {
  const labels = toolLabels[lang]
  const toolTitle = labels[record.toolName] ?? record.toolName
  const verdictInfo = record.verdict ? formatVerdictDetails(record.verdict, t) : undefined
  const isError = !record.success
  const isFailedVerdict = verdictInfo?.isFailed === true
  const isTie = record.verdict?.outcome === 'tie'
  const dotState: SessionPanelDotState = isError ? 'error' : isFailedVerdict ? 'warning' : isTie ? 'warning' : 'done'
  const statusLabel = isError
    ? t['sessionPanel.status.error']
    : isFailedVerdict || isTie
      ? (verdictInfo?.outcomeText || t['sessionPanel.status.warn'])
      : (verdictInfo?.outcomeText || t['sessionPanel.status.ok'])

  const title = verdictInfo?.phaseText && record.verdict?.phase !== 'explicit'
    ? `${verdictInfo.phaseText} · ${toolTitle}`
    : toolTitle

  const detailParts: string[] = []
  if (isError) {
    detailParts.push(record.errorMessage ?? record.errorName ?? t['sessionPanel.status.error'])
  } else {
    if (verdictInfo?.outcomeText) detailParts.push(verdictInfo.outcomeText)
    if (verdictInfo?.scoreText) detailParts.push(verdictInfo.scoreText)
    else if (verdictInfo?.winnerText) detailParts.push(verdictInfo.winnerText)
    else if (verdictInfo?.checkpointsText) detailParts.push(verdictInfo.checkpointsText)
  }
  const detail = detailParts.join(' · ') || `${record.provider}/${record.model}`

  const scorePct = typeof record.verdict?.score === 'number' && Number.isFinite(record.verdict.score)
    ? `${Math.round(record.verdict.score * 100)}%`
    : undefined
  const trailing = scorePct ?? duration(record.durationMs)

  const totalTokens = (record.stats.inputTokens ?? 0) + (record.stats.cachedInputTokens ?? 0) + (record.stats.outputTokens ?? 0)
  const hoverLines = [
    tFormat(t['sessionPanel.hoverModel'], { route: `${record.provider}/${record.model}` }),
    ...(detailParts.length > 0 ? [tFormat(t['sessionPanel.hoverOutcome'], { outcome: detailParts.join(' · ') })] : []),
    ...(record.stats.estimatedCostUsd > 0 ? [tFormat(t['sessionPanel.hoverCost'], { cost: money(record.stats.estimatedCostUsd) })] : []),
  ]
  const hoverFacts: Array<{ kind: 'tokens' | 'duration'; label: string }> = []
  if (totalTokens > 0) {
    hoverFacts.push({ kind: 'tokens', label: tFormat(t['sessionPanel.tokens'], { tokens: compact(totalTokens, lang) }) })
  }
  if (record.durationMs > 0) {
    hoverFacts.push({ kind: 'duration', label: duration(record.durationMs) })
  }

  return {
    dotState,
    statusLabel,
    title,
    detail,
    trailing,
    hoverTitle: title,
    hoverLines,
    hoverFacts,
  }
}

/** Whether the Session panel section has anything to display (returning false lets the host hide its title). */
export function hasSessionPanelContent(snapshot: SessionVerifierSnapshot, t: I18nDict): boolean {
  if (verifierActivityText(snapshot.activity, t) !== null) return true
  return (snapshot.summary?.recent.length ?? 0) > 0
}
