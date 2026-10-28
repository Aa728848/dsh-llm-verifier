export interface ExtraJudgeDraft {
  provider: string
  model: string
  reasoningEffort?: string
  label?: string
}

// Must stay equal to MAX_EXTRA_JUDGES in src/config.ts: importing it here would pull
// schemastery into the web-client bundle, so the cap is duplicated deliberately.
export const MAX_EXTRA_JUDGES = 4

export function normalizeExtraJudges(value: unknown): ExtraJudgeDraft[] {
  if (!Array.isArray(value)) return []
  const results: ExtraJudgeDraft[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.provider !== 'string' || typeof raw.model !== 'string') continue
    const provider = raw.provider.trim()
    const model = raw.model.trim()
    if (!provider || !model) continue

    const draft: ExtraJudgeDraft = { provider, model }
    if (typeof raw.reasoningEffort === 'string') {
      const effort = raw.reasoningEffort.trim()
      if (effort) draft.reasoningEffort = effort
    }
    if (typeof raw.label === 'string') {
      const label = raw.label.trim()
      if (label) draft.label = label
    }
    results.push(draft)
    if (results.length >= MAX_EXTRA_JUDGES) break
  }
  return results
}

export function judgeIdentity(provider: string, model: string): string {
  return `${provider.trim()}/${model.trim()}`
}

export function judgeConflict(
  primary: { provider: string; model: string },
  judges: readonly ExtraJudgeDraft[],
): { index: number; duplicateOf: 'primary' | number } | undefined {
  const primaryId = (primary.provider.trim() && primary.model.trim())
    ? judgeIdentity(primary.provider, primary.model)
    : undefined

  const seen = new Map<string, number>()
  for (let i = 0; i < judges.length; i++) {
    const judge = judges[i]
    const p = judge.provider.trim()
    const m = judge.model.trim()
    if (!p || !m) continue
    const id = judgeIdentity(p, m)
    if (primaryId !== undefined && id === primaryId) {
      return { index: i, duplicateOf: 'primary' }
    }
    const prev = seen.get(id)
    if (prev !== undefined) {
      return { index: i, duplicateOf: prev }
    }
    seen.set(id, i)
  }
  return undefined
}

export function addExtraJudge(
  judges: readonly ExtraJudgeDraft[],
  draft: ExtraJudgeDraft,
): ExtraJudgeDraft[] {
  if (judges.length >= MAX_EXTRA_JUDGES) {
    return [...judges]
  }
  const provider = draft.provider.trim()
  const model = draft.model.trim()
  const item: ExtraJudgeDraft = { provider, model }
  if (typeof draft.reasoningEffort === 'string') {
    const effort = draft.reasoningEffort.trim()
    if (effort) item.reasoningEffort = effort
  }
  if (typeof draft.label === 'string') {
    const label = draft.label.trim()
    if (label) item.label = label
  }
  return [...judges, item]
}

export function removeExtraJudge(
  judges: readonly ExtraJudgeDraft[],
  index: number,
): ExtraJudgeDraft[] {
  if (index < 0 || index >= judges.length) {
    return [...judges]
  }
  return judges.filter((_, i) => i !== index)
}

export function serializeExtraJudges(
  judges: readonly ExtraJudgeDraft[],
): Array<Record<string, string>> {
  const list = judges.slice(0, MAX_EXTRA_JUDGES)
  const result: Array<Record<string, string>> = []
  for (const judge of list) {
    const provider = judge.provider.trim()
    const model = judge.model.trim()
    if (!provider || !model) continue
    const entry: Record<string, string> = { provider, model }
    if (typeof judge.reasoningEffort === 'string') {
      const effort = judge.reasoningEffort.trim()
      if (effort) entry.reasoningEffort = effort
    }
    if (typeof judge.label === 'string') {
      const label = judge.label.trim()
      if (label) entry.label = label
    }
    result.push(entry)
  }
  return result
}
