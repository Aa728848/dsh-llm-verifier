import { tFormat } from './client-i18n.ts'

/**
 * Locally declared copy of the client's status tones.
 *
 * The view model cannot import the tone type from `client.tsx`: the component imports THIS module,
 * so the dependency only points one way.
 */
export type ProcessCycleTone = 'pass' | 'warn' | 'error' | 'neutral'

/** Which rung of the request pipeline a chip describes. */
export type ProcessCycleStage = 'purchase' | 'generate' | 'augment' | 'judge' | 'replay' | 'canceled' | 'skip'

/** One chip of the rendered pipeline: a localized label plus the tone it paints in. */
export interface ProcessCycleStageView {
  stage: ProcessCycleStage
  tone: ProcessCycleTone
  /** Localized label, interpolated with the numbers read from the observations. */
  text: string
}

/**
 * Grouped view of one P06 process-selection cycle, as the dashboard renders it.
 *
 * Every number is the cycle's own, never a sum over rows: the same reservation can produce more than
 * one statistics row (a skip row carries the reason, the purchase row carries the spend), and adding
 * them up would double-count the calls the cycle actually bought.
 */
export interface ProcessCycleView {
  /** Reservation id shared by every row of the cycle. */
  cycleId: string
  /** Newest row of the group, used both as the link target and as the timestamp. */
  recordId?: string
  /** Newest `startedAt` in the group (0 when no row carried one). */
  startedAt: number
  /** How many statistics rows the group folded together. */
  rows: number
  /** The cycle reached a reservation, so it spent (or could have spent) real calls. */
  purchased: boolean
  attempt?: number
  reservedCalls?: number
  generatedCalls: number
  judgeCalls: number
  /** The alternative pool, split on the commas one model list is persisted with. */
  alternativeModels: string[]
  alternativeAugmented: boolean
  sameCandidate: boolean
  canceled: boolean
  skipReason?: string
  replayed: 'original' | 'candidate' | 'none'
  /** Ordered chips: purchase → generation → judging → replay. */
  stages: ProcessCycleStageView[]
}

/**
 * The subset of a statistics row the process-cycle grouping reads.
 *
 * Structural on purpose: `InvocationRecord` satisfies it as-is, so the dashboard passes its recent
 * list straight in and the pure function stays testable with plain objects.
 */
export interface ProcessCycleRouteInput {
  cycleId?: string
  destination?: string
  attempt?: number
  reservedCalls?: number
  skipReason?: string
  canceled?: boolean
  replayed?: string
  generatedCalls?: number
  judgeCalls?: number
  sameCandidate?: boolean
  alternativeAugmented?: boolean
  alternativeModel?: string
}

export interface ProcessCycleRowInput {
  id?: string
  startedAt?: number
  route?: ProcessCycleRouteInput | null
}

/**
 * Fold the recent statistics rows into the process-selection cycles they describe.
 *
 * Only rows whose route destination is `process` take part — every other destination belongs to
 * the routing/final pipeline and is already covered by the recent list itself. Rows sharing a
 * {@link ProcessCycleRowInput.route.cycleId} form one cycle; cycles are returned newest first.
 *
 * The stage chips are built here (not in the component) because the interesting part is the
 * DECISION TREE — purchased vs skipped, judged vs short-circuited by an identical candidate,
 * replayed candidate vs original — and that tree is what the unit test pins. Labels come from the
 * passed dictionary so both languages render from the same function.
 * @param rows - recent invocation rows, in any order.
 * @param t - the active language dictionary (zh or en).
 * @returns One view model per process cycle, newest first.
 */
export function buildProcessCycles(
  rows: readonly ProcessCycleRowInput[] | null | undefined,
  t: Record<string, string>,
): ProcessCycleView[] {
  const copy = (key: string): string => t[key] ?? key
  const fill = (key: string, params: Record<string, string | number>): string => tFormat(copy(key), params)
  const groups = new Map<string, ProcessCycleRowInput[]>()
  for (const row of rows ?? []) {
    const route = row?.route
    if (!route || route.destination !== 'process') continue
    const cycleId = typeof route.cycleId === 'string' ? route.cycleId : ''
    if (cycleId === '') continue
    const group = groups.get(cycleId)
    if (group === undefined) groups.set(cycleId, [row])
    else group.push(row)
  }
  const cycles: ProcessCycleView[] = []
  for (const [cycleId, group] of groups) {
    let startedAt = 0
    let recordId: string | undefined
    let attempt: number | undefined
    let reservedCalls: number | undefined
    let generatedCalls = 0
    let judgeCalls = 0
    let alternativeModel = ''
    let alternativeAugmented = false
    let sameCandidate = false
    let canceled = false
    let skipReason: string | undefined
    let replayed: 'original' | 'candidate' | 'none' = 'none'
    // A cycle is a purchase as soon as it holds a reservation (attempt/reservedCalls), whatever it
    // later did with it; the skip rows of the every-step arm carry neither and stay unbought.
    let purchased = false
    for (const row of group) {
      const route = row.route as ProcessCycleRouteInput
      if (typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) && row.startedAt >= startedAt) {
        startedAt = row.startedAt
        if (typeof row.id === 'string') recordId = row.id
      } else if (recordId === undefined && typeof row.id === 'string') recordId = row.id
      if (attempt === undefined && typeof route.attempt === 'number') attempt = route.attempt
      if (reservedCalls === undefined && typeof route.reservedCalls === 'number') reservedCalls = route.reservedCalls
      if (typeof route.generatedCalls === 'number') generatedCalls = Math.max(generatedCalls, route.generatedCalls)
      if (typeof route.judgeCalls === 'number') judgeCalls = Math.max(judgeCalls, route.judgeCalls)
      if (typeof route.alternativeModel === 'string' && route.alternativeModel !== '') alternativeModel = route.alternativeModel
      if (route.alternativeAugmented === true) alternativeAugmented = true
      if (route.sameCandidate === true) sameCandidate = true
      if (route.canceled === true) canceled = true
      if (typeof route.skipReason === 'string' && route.skipReason !== '') skipReason = route.skipReason
      if (route.replayed === 'candidate') replayed = 'candidate'
      else if (route.replayed === 'original' && replayed !== 'candidate') replayed = 'original'
      if (route.replayed === 'original' || route.replayed === 'candidate' || typeof route.attempt === 'number' || typeof route.reservedCalls === 'number') purchased = true
    }
    const alternativeModels: string[] = []
    for (const entry of alternativeModel.split(',')) {
      const model = entry.trim()
      if (model !== '' && !alternativeModels.includes(model)) alternativeModels.push(model)
    }
    const stages: ProcessCycleStageView[] = []
    // 1. Purchase: a cycle with no reservation never bought anything.
    if (canceled) stages.push({ stage: 'purchase', tone: 'warn', text: copy('processCycles.stage.cpCanceled') })
    else if (!purchased) stages.push({ stage: 'purchase', tone: skipReason === undefined ? 'neutral' : 'warn', text: copy('processCycles.stage.cpNotPurchased') })
    else if (typeof attempt === 'number' && typeof reservedCalls === 'number') stages.push({ stage: 'purchase', tone: 'pass', text: fill('processCycles.stage.cpPurchased', { attempt, reserved: reservedCalls }) })
    else stages.push({ stage: 'purchase', tone: 'pass', text: copy('processCycles.stage.cpPurchasedPlain') })
    // 2. Generation: what the cycle bought before any judging happened.
    if (generatedCalls > 0) stages.push({ stage: 'generate', tone: 'pass', text: alternativeModels.length === 0 ? fill('processCycles.stage.generate', { count: generatedCalls }) : fill('processCycles.stage.generateWithModels', { count: generatedCalls, models: alternativeModels.join(' / ') }) })
    else stages.push({ stage: 'generate', tone: 'neutral', text: copy('processCycles.stage.generateNone') })
    if (alternativeAugmented) stages.push({ stage: 'augment', tone: 'warn', text: copy('processCycles.stage.augmented') })
    // 3. Judging: an identical candidate short-circuits the judge, and saying "0 judges" there would
    // read as a failed judge instead of the short-circuit it is.
    if (sameCandidate) stages.push({ stage: 'judge', tone: 'warn', text: copy('processCycles.stage.judgeSame') })
    else if (judgeCalls > 0) stages.push({ stage: 'judge', tone: 'pass', text: fill('processCycles.stage.judge', { count: judgeCalls }) })
    else stages.push({ stage: 'judge', tone: 'neutral', text: copy('processCycles.stage.judgeNone') })
    // 4. Replay: what the host actually received. `none` is only a warning when a purchase raised
    // the expectation; a cycle that was never bought has simply not arrived there yet.
    if (replayed === 'candidate') stages.push({ stage: 'replay', tone: 'pass', text: copy('processCycles.stage.replayCandidate') })
    else if (replayed === 'original') stages.push({ stage: 'replay', tone: 'neutral', text: copy('processCycles.stage.replayOriginal') })
    else stages.push({ stage: 'replay', tone: purchased ? 'warn' : 'neutral', text: copy('processCycles.stage.replayNone') })
    if (canceled) stages.push({ stage: 'canceled', tone: 'error', text: copy('processCycles.stage.canceled') })
    if (skipReason !== undefined) stages.push({ stage: 'skip', tone: 'warn', text: fill('processCycles.stage.skip', { reason: skipReason }) })
    cycles.push({ cycleId, ...(recordId === undefined ? {} : { recordId }), startedAt, rows: group.length, purchased, ...(attempt === undefined ? {} : { attempt }), ...(reservedCalls === undefined ? {} : { reservedCalls }), generatedCalls, judgeCalls, alternativeModels, alternativeAugmented, sameCandidate, canceled, ...(skipReason === undefined ? {} : { skipReason }), replayed, stages })
  }
  // Newest first; the sort is stable, so two cycles stamped in the same millisecond keep the order
  // the recent list already gave them.
  return cycles.sort((a, b) => b.startedAt - a.startedAt)
}
