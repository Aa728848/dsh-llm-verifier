/**
 * DSH 0.2.3+ Session panel contributions: live verifier activity & session records section,
 * read-only heading summary, and panel toggle attention/running indicator.
 *
 * Uses the host's `data-session-panel-row` markup contract and probes optional primitives
 * (`HoverCard`, `HoverCardGroup`) at runtime so one client bundle stays safe across 0.2.x hosts.
 */
import { Fragment, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { dictionaries, tFormat, useLanguage, verifierActivityText } from '../model/client-i18n.ts'
import {
  SESSION_PANEL_FOLD_LIMIT,
  SESSION_PANEL_FOLD_MIN_HIDDEN,
  hasSessionPanelContent,
  sessionPanelActionSummary,
  sessionPanelIndicatorState,
  sessionPanelRecordPresentation,
  type SessionVerifierRecordView,
  type SessionVerifierSnapshot,
  type VerifierSessionMonitor,
} from '../model/client-session-store.ts'

const hostPrimitives = uiPrimitives as unknown as {
  HoverCard?: ComponentType<{
    grouped?: boolean
    disabled?: boolean
    anchor: ReactNode
    content: ReactNode
  }>
  HoverCardGroup?: ComponentType<{ children?: ReactNode }>
}

const HostHoverCard = hostPrimitives.HoverCard
const HostHoverCardGroup = hostPrimitives.HoverCardGroup

type SessionStatusReader = (selector: (state: unknown) => boolean) => boolean

/**
 * Read whether `sessionId` is currently running from the host's root `useSessionStatus` hook.
 * Accepts both the 0.2.3 `ReadonlyMap<SessionId, SessionStatus>` snapshot and plain-object shapes.
 */
function readRunningFromStatusMap(state: unknown, sessionId: string): boolean {
  if (state instanceof Map) {
    return (state.get(sessionId) as { running?: unknown } | undefined)?.running === true
  }
  if (typeof state === 'object' && state !== null) {
    return ((state as Record<string, { running?: unknown } | undefined>)[sessionId])?.running === true
  }
  return false
}

function useWatchedSession(
  monitor: VerifierSessionMonitor,
  sessionId: string | undefined,
  running: boolean,
  includeSummary: boolean,
): SessionVerifierSnapshot {
  const snapshot = useSyncExternalStore(
    listener => sessionId ? monitor.subscribe(sessionId, listener) : () => {},
    () => sessionId ? monitor.getSnapshot(sessionId) : monitor.getSnapshot(''),
  )
  useEffect(() => {
    if (!sessionId) return undefined
    return monitor.watch(sessionId, { running, includeSummary })
  }, [monitor, sessionId, running, includeSummary])
  return snapshot
}

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const listResetStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
}

const trailingSummaryStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export interface VerifierSessionPanelSectionProps {
  sessionId?: unknown
  dismissOverlay?: () => void
  useSessionStatus?: SessionStatusReader
  renderFactorySlot?: (name: string, props: unknown) => ReactNode
  monitor: VerifierSessionMonitor
  openDashboard?: () => void
}

function VerifierSessionRow({
  record,
  lang,
  renderFactorySlot,
  onOpen,
}: {
  record: SessionVerifierRecordView
  lang: 'zh' | 'en'
  renderFactorySlot?: (name: string, props: unknown) => ReactNode
  onOpen?: () => void
}) {
  const t = dictionaries[lang]
  const view = sessionPanelRecordPresentation(record, lang, t)
  const content = (
    <>
      <span data-row-part="icon" aria-hidden="true">
        <StateDot state={view.dotState as StateDotState} size={8} />
      </span>
      <span data-row-part="lines">
        <span data-row-part="content">{view.title}</span>
        <span data-row-part="detail">{view.detail}</span>
      </span>
    </>
  )
  const rowNode = (
    <div data-session-panel-row="" data-verifier-record={record.id}>
      {onOpen ? (
        <button
          type="button"
          data-row-part="body"
          aria-label={`${view.title} — ${t['sessionPanel.openDashboard']}`}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div data-row-part="body" title={`${view.title} · ${view.detail}`}>
          {content}
        </div>
      )}
      <span data-row-part="trailing" style={trailingSummaryStyle}>{view.trailing}</span>
    </div>
  )

  if (HostHoverCard && typeof renderFactorySlot === 'function') {
    const hoverContent = renderFactorySlot('conversation.session.panel.details', {
      title: view.hoverTitle,
      lines: view.hoverLines,
      status: { state: view.dotState as StateDotState, label: view.statusLabel },
      ...(view.hoverFacts.length > 0 ? { facts: view.hoverFacts } : {}),
    })
    if (hoverContent !== null && hoverContent !== undefined) {
      return (
        <li>
          <HostHoverCard grouped anchor={rowNode} content={hoverContent} />
        </li>
      )
    }
  }
  return <li>{rowNode}</li>
}

/**
 * Session panel section body (`conversation.session.panel.section`, id: `'llm-verifier'`).
 * Renders nothing when the session has neither live activity nor recorded verifier calls,
 * which hides the section heading automatically per the host panel contract.
 */
export function VerifierSessionPanelSection({
  sessionId: rawSessionId,
  dismissOverlay,
  useSessionStatus,
  renderFactorySlot,
  monitor,
  openDashboard,
}: VerifierSessionPanelSectionProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const sessionId = rawSessionId !== undefined && rawSessionId !== null && String(rawSessionId) !== ''
    ? String(rawSessionId)
    : undefined
  const running = typeof useSessionStatus === 'function'
    ? useSessionStatus(state => sessionId === undefined ? false : readRunningFromStatusMap(state, sessionId))
    : false
  const snapshot = useWatchedSession(monitor, sessionId, running, true)
  const [expanded, setExpanded] = useState(false)

  if (!sessionId || !hasSessionPanelContent(snapshot, t)) return null

  const activity = verifierActivityText(snapshot.activity, t)
  const records = snapshot.summary?.recent ?? []
  const foldable = records.length >= SESSION_PANEL_FOLD_LIMIT + SESSION_PANEL_FOLD_MIN_HIDDEN
  const visible = foldable && !expanded ? records.slice(0, SESSION_PANEL_FOLD_LIMIT) : records
  const foldLabel = expanded
    ? t['sessionPanel.foldLess']
    : tFormat(t['sessionPanel.foldMore'], { count: records.length - SESSION_PANEL_FOLD_LIMIT })
  const open = openDashboard
    ? () => {
        dismissOverlay?.()
        openDashboard()
      }
    : undefined

  const Group = HostHoverCardGroup ?? Fragment
  const activityDot: StateDotState = activity?.tone === 'busy' ? 'ongoing' : activity?.tone === 'ok' ? 'done' : 'error'

  return (
    <div data-verifier-session-panel="">
      <Group>
        <ul style={listResetStyle}>
          {activity !== null && (
            <li>
              <div data-session-panel-row="" data-verifier-panel-activity="">
                <div data-row-part="body">
                  <span data-row-part="icon" aria-hidden="true">
                    <StateDot state={activityDot} size={8} />
                  </span>
                  <span data-row-part="content">{activity.text}</span>
                </div>
              </div>
            </li>
          )}
          {visible.map(record => (
            <VerifierSessionRow
              key={record.id}
              record={record}
              lang={lang}
              renderFactorySlot={renderFactorySlot}
              onOpen={open}
            />
          ))}
        </ul>
      </Group>
      {foldable && typeof renderFactorySlot === 'function' && renderFactorySlot('conversation.session.panel.fold', {
        expanded,
        label: foldLabel,
        name: tFormat(t['sessionPanel.foldName'], { label: foldLabel }),
        onToggle: () => { setExpanded(current => !current) },
      })}
    </div>
  )
}

export interface VerifierSessionPanelActionsProps {
  sessionId?: unknown
  useSessionStatus?: SessionStatusReader
  monitor: VerifierSessionMonitor
}

/**
 * Trailing read-only count beside the Session panel section heading
 * (`conversation.session.panel.section.actions`, key: `'llm-verifier'`).
 */
export function VerifierSessionPanelActions({
  sessionId: rawSessionId,
  useSessionStatus,
  monitor,
}: VerifierSessionPanelActionsProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const sessionId = rawSessionId !== undefined && rawSessionId !== null && String(rawSessionId) !== ''
    ? String(rawSessionId)
    : undefined
  const running = typeof useSessionStatus === 'function'
    ? useSessionStatus(state => sessionId === undefined ? false : readRunningFromStatusMap(state, sessionId))
    : false
  const snapshot = useWatchedSession(monitor, sessionId, running, true)
  const label = sessionPanelActionSummary(snapshot, t)
  if (label === null) return null
  return <span style={trailingSummaryStyle}>{label}</span>
}

export interface VerifierSessionPanelIndicatorProps {
  sessionId?: unknown
  panelShown?: boolean
  useSessionStatus?: SessionStatusReader
  monitor: VerifierSessionMonitor
}

/**
 * Status dot on the Session panel toggle (`conversation.session.panel.indicator`).
 * Shown only while the panel is collapsed and the verifier is running or just rejected a turn.
 */
export function VerifierSessionPanelIndicator({
  sessionId: rawSessionId,
  panelShown = false,
  useSessionStatus,
  monitor,
}: VerifierSessionPanelIndicatorProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const sessionId = rawSessionId !== undefined && rawSessionId !== null && String(rawSessionId) !== ''
    ? String(rawSessionId)
    : undefined
  const running = typeof useSessionStatus === 'function'
    ? useSessionStatus(state => sessionId === undefined ? false : readRunningFromStatusMap(state, sessionId))
    : false
  const snapshot = useWatchedSession(monitor, sessionId, running, false)
  const indicator = sessionPanelIndicatorState(snapshot, panelShown, t)
  if (indicator === null) return null
  return (
    <span
      data-verifier-panel-indicator={indicator.kind}
      style={{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', background: indicator.color }}
    >
      <span style={visuallyHiddenStyle}>{indicator.label}</span>
    </span>
  )
}
