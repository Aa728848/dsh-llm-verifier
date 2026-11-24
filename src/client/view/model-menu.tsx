/**
 * Composer model-menu quick controls for LLM Verifier (`conversation.input.model.options` and
 * `conversation.input.model.pane`, DSH 0.2.2-rc.4+).
 *
 * Follows the host ModelSelect keyboard and accessibility contract: the root option is a
 * `button[role="menuitem"][data-model-menu-pane="llm-verifier"]` so Arrow keys, Tab, and Escape
 * focus return stay intact; the detail pane places initial focus on its primary toggle.
 */
import { useEffect, useId, useSyncExternalStore, type ComponentType } from 'react'
import * as uiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { IOT_THINKING_MODES, type AutoVerifyMode, type IotThinkingMode } from '../../config/config.ts'
import { dictionaries, tFormat, useLanguage, type I18nDict } from '../model/client-i18n.ts'
import { formatModelMenuSummary, type VerifierSettingsStore } from '../model/client-settings-store.ts'

export const VERIFIER_MODEL_MENU_PANE_KEY = 'llm-verifier'

const hostPrimitives = uiPrimitives as unknown as {
  Switch?: ComponentType<{
    checked: boolean
    disabled?: boolean
    label: string
    onChange: (checked: boolean) => void
    autoFocus?: boolean
    describedBy?: string
  }>
  IconChevronRightOutlineRegular?: ComponentType<{ size?: number; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' }>
}

const HostSwitch = hostPrimitives.Switch
const HostChevronRight = hostPrimitives.IconChevronRightOutlineRegular

const summaryButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxSizing: 'border-box',
  width: '100%',
  height: 34,
  padding: '0 8px',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: '20px',
  textAlign: 'start',
  cursor: 'pointer',
}

const summaryLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
}

const summaryStateStyle: React.CSSProperties = {
  flex: 'none',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
  maxWidth: 112,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  padding: '6px 8px 8px',
  color: 'var(--dsw-alias-label-primary)',
}

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 30,
  fontSize: 13,
  lineHeight: '20px',
}

const groupLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  marginBottom: 4,
}

const segmentGroupStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: 2,
  borderRadius: 8,
  background: 'var(--dsw-specific-input-major)',
}

const metaLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  overflowWrap: 'anywhere',
}

const warnLineStyle: React.CSSProperties = {
  ...metaLineStyle,
  color: 'var(--dsw-alias-state-warn-label)',
}

const AUTO_MODES: readonly AutoVerifyMode[] = ['manual', 'smart', 'strict']

function FallbackChevron() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FallbackSwitch({
  checked,
  disabled,
  label,
  onChange,
  autoFocus,
  describedBy,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
  autoFocus?: boolean
  describedBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={() => { onChange(!checked) }}
      style={{
        position: 'relative',
        flex: 'none',
        width: 34,
        height: 20,
        padding: 0,
        border: 0,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-specific-input-major)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'var(--dsw-static-neutral-00, #fff)',
        }}
      />
    </button>
  )
}

function MenuSegmentRow<T extends string>({
  label,
  options,
  value,
  disabled,
  onSelect,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  disabled: boolean
  onSelect: (next: T) => void
}) {
  return (
    <div>
      <div style={groupLabelStyle}>{label}</div>
      <div
        role="group"
        aria-label={label}
        style={{ ...segmentGroupStyle, gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map(option => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => { if (!active) onSelect(option.value) }}
              style={{
                appearance: 'none',
                border: 0,
                borderRadius: 6,
                padding: '4px 4px',
                font: 'inherit',
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                lineHeight: '16px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                background: active ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
                boxShadow: active ? '0 1px 2px var(--dsw-alias-bg-mask-2)' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface VerifierModelMenuOptionProps {
  locked?: boolean
  openPane?: (pane: { key: string; title: string }) => void
  settingsStore: VerifierSettingsStore
}

/**
 * Root menu row inside the composer's ModelSelect (`conversation.input.model.options`).
 * Stands down on pre-0.2.2-rc.4 hosts where `openPane` is not supplied.
 */
export function VerifierModelMenuOption({ locked = false, openPane, settingsStore }: VerifierModelMenuOptionProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const snapshot = useSyncExternalStore(
    listener => settingsStore.subscribe(listener),
    () => settingsStore.getSnapshot(),
  )
  useEffect(() => { void settingsStore.ensureLoaded() }, [settingsStore])

  if (typeof openPane !== 'function') return null
  if (snapshot.values === null) return null

  const stateText = formatModelMenuSummary(snapshot.values, t)
  return (
    <button
      type="button"
      role="menuitem"
      data-model-menu-pane={VERIFIER_MODEL_MENU_PANE_KEY}
      disabled={locked}
      style={{ ...summaryButtonStyle, opacity: locked ? 0.5 : 1, cursor: locked ? 'default' : 'pointer' }}
      onClick={() => { openPane({ key: VERIFIER_MODEL_MENU_PANE_KEY, title: t['modelMenu.title'] }) }}
    >
      <span style={summaryLabelStyle}>{t['modelMenu.title']}</span>
      <span style={summaryStateStyle}>{stateText}</span>
      {HostChevronRight
        ? <HostChevronRight size={12} aria-hidden="true" style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }} />
        : <FallbackChevron />}
    </button>
  )
}

export interface VerifierModelMenuPaneProps {
  locked?: boolean
  reportFailure?: (message: string) => void
  settingsStore: VerifierSettingsStore
}

/**
 * Drilled-in detail pane inside the composer's ModelSelect (`conversation.input.model.pane`).
 * Exposes quick toggles for verifier enablement, automatic policy, and auxiliary thinking level.
 */
export function VerifierModelMenuPane({ locked = false, reportFailure, settingsStore }: VerifierModelMenuPaneProps) {
  const lang = useLanguage()
  const t = dictionaries[lang]
  const descriptionId = useId()
  const snapshot = useSyncExternalStore(
    listener => settingsStore.subscribe(listener),
    () => settingsStore.getSnapshot(),
  )
  useEffect(() => { void settingsStore.ensureLoaded() }, [settingsStore])

  const values = snapshot.values
  if (values === null) {
    return (
      <div style={paneStyle}>
        <p style={metaLineStyle}>{snapshot.error ?? t['settings.loading']}</p>
      </div>
    )
  }

  const controlsDisabled = locked || snapshot.saving || !snapshot.writable
  const applyPatch = (changes: Partial<Pick<typeof values, 'enabled' | 'autoVerifyMode' | 'iotThinking'>>) => {
    void settingsStore.patch(changes).then(failure => {
      if (failure !== null) {
        reportFailure?.(tFormat(t['modelMenu.saveFailed'], { message: failure }))
      }
    })
  }

  const SwitchControl = HostSwitch ?? FallbackSwitch
  const modeOptions = AUTO_MODES.map(mode => ({
    value: mode,
    label: t[('field.autoVerifyMode.' + mode) as keyof I18nDict] as string,
  }))
  const iotOptions = IOT_THINKING_MODES.map((mode: IotThinkingMode) => ({
    value: mode,
    label: t[('field.iotThinking.' + mode) as keyof I18nDict] as string,
  }))

  return (
    <div style={paneStyle} data-verifier-model-pane="">
      <div style={toggleRowStyle}>
        <span>{t['modelMenu.enabledLabel']}</span>
        <SwitchControl
          checked={values.enabled}
          disabled={controlsDisabled}
          label={t['modelMenu.enabledLabel']}
          describedBy={descriptionId}
          autoFocus
          onChange={enabled => { applyPatch({ enabled }) }}
        />
      </div>

      <MenuSegmentRow
        label={t['modelMenu.modeLabel']}
        options={modeOptions}
        value={values.autoVerifyMode}
        disabled={controlsDisabled || !values.enabled}
        onSelect={autoVerifyMode => { applyPatch({ autoVerifyMode }) }}
      />

      <MenuSegmentRow
        label={t['modelMenu.iotLabel']}
        options={iotOptions}
        value={values.iotThinking}
        disabled={controlsDisabled}
        onSelect={iotThinking => { applyPatch({ iotThinking }) }}
      />

      {values.iotThinking !== 'off' && (
        values.iotThinkingTargets.length === 0
          ? <p style={warnLineStyle}>{t['modelMenu.targetsEmpty']}</p>
          : <p style={metaLineStyle}>{tFormat(t['modelMenu.targetsHint'], { count: values.iotThinkingTargets.length })}</p>
      )}

      <p style={metaLineStyle}>
        {tFormat(t['modelMenu.judgeLine'], { route: `${values.provider}/${values.model}` })}
      </p>

      {!snapshot.writable && <p style={warnLineStyle}>{t['modelMenu.readOnly']}</p>}
      <p id={descriptionId} style={metaLineStyle}>{t['modelMenu.description']}</p>
    </div>
  )
}
