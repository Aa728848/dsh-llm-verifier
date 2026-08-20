import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RunStats } from './engine.ts'

export const VERIFIER_TOOL_NAMES = ['verifier_route_classify', 'verifier_compare', 'verifier_select', 'verifier_track', 'verifier_current_session'] as const
export type VerifierToolName = typeof VERIFIER_TOOL_NAMES[number]

export interface InvocationRecord {
  id: string
  toolName: VerifierToolName
  sessionId?: string
  startedAt: number
  finishedAt: number
  durationMs: number
  success: boolean
  errorName?: string
  errorMessage?: string
  provider: string
  model: string
  stats: RunStats
}

interface StatisticsDocument {
  version: 1
  records: InvocationRecord[]
}

export interface DailyStatistics {
  date: string
  invocations: number
  successes: number
  failures: number
  calls: number
  tokens: number
  estimatedCostUsd: number
  byTool: Record<string, number>
}

export interface ToolStatistics {
  toolName: VerifierToolName
  invocations: number
  successes: number
  failures: number
  successRate: number
  averageDurationMs: number
  calls: number
  tokens: number
  cacheHits: number
  cacheMisses: number
  estimatedCostUsd: number
}

export interface ModelStatistics {
  provider: string
  model: string
  invocations: number
  calls: number
  tokens: number
  estimatedCostUsd: number
}

export interface StatisticsTotals {
  invocations: number
  successes: number
  failures: number
  successRate: number
  averageDurationMs: number
  calls: number
  attempts: number
  retries: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokens: number
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number
  estimatedCostUsd: number
  topLogprobScores: number
  explicitTagScores: number
}

export interface StatisticsOverview {
  generatedAt: number
  fromMs: number
  toMs: number
  sessionId?: string
  totals: StatisticsTotals
  daily: DailyStatistics[]
  tools: ToolStatistics[]
  models: ModelStatistics[]
  recent: InvocationRecord[]
}

export interface StatisticsQuery {
  fromMs: number
  toMs: number
  timezoneOffsetMinutes?: number
  sessionId?: string
  recentLimit?: number
}

export interface InvocationInput {
  toolName: VerifierToolName
  sessionId?: string
  startedAt: number
  finishedAt?: number
  success: boolean
  errorName?: string
  errorMessage?: string
  provider: string
  model: string
  stats: RunStats
}

function finite(value: number): number { return Number.isFinite(value) ? value : 0 }
function ratio(numerator: number, denominator: number): number { return denominator > 0 ? numerator / denominator : 0 }
function tokens(stats: RunStats): number { return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens }
function cleanError(value: string | undefined): string | undefined { return value === undefined ? undefined : value.slice(0, 500) }

function blankTotals(): StatisticsTotals {
  return { invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, cacheHitRate: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
}

function addRecord(target: StatisticsTotals, record: InvocationRecord): void {
  const stats = record.stats
  target.invocations += 1
  record.success ? target.successes += 1 : target.failures += 1
  target.averageDurationMs += record.durationMs
  target.calls += stats.calls
  target.attempts += stats.attempts
  target.retries += stats.retries
  target.inputTokens += stats.inputTokens
  target.cachedInputTokens += stats.cachedInputTokens
  target.outputTokens += stats.outputTokens
  target.reasoningTokens += stats.reasoningTokens
  target.tokens += tokens(stats)
  target.cacheHits += stats.cacheHits
  target.cacheMisses += stats.cacheMisses
  target.estimatedCostUsd += stats.estimatedCostUsd
  target.topLogprobScores += stats.topLogprobScores
  target.explicitTagScores += stats.explicitTagScores
}

function finishTotals(target: StatisticsTotals): StatisticsTotals {
  target.averageDurationMs = target.invocations > 0 ? target.averageDurationMs / target.invocations : 0
  target.successRate = ratio(target.successes, target.invocations)
  target.cacheHitRate = ratio(target.cacheHits, target.cacheHits + target.cacheMisses)
  return target
}

function localDate(time: number, timezoneOffsetMinutes: number): string {
  return new Date(time - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is InvocationRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<InvocationRecord>
  return typeof row.id === 'string' && VERIFIER_TOOL_NAMES.includes(row.toolName as VerifierToolName) && typeof row.startedAt === 'number' && typeof row.finishedAt === 'number' && typeof row.durationMs === 'number' && typeof row.success === 'boolean' && typeof row.provider === 'string' && typeof row.model === 'string' && typeof row.stats === 'object' && row.stats !== null
}

export function resolveStatisticsFile(cacheFile: string): string {
  return join(dirname(cacheFile), 'statistics-v1.json')
}

/** Combine independently persisted topic summaries for the all-topics dashboard. */
export function mergeStatisticsOverviews(overviews: readonly StatisticsOverview[], query: StatisticsQuery): StatisticsOverview {
  const totals = blankTotals()
  const daily = new Map<string, DailyStatistics>()
  const tools = new Map<VerifierToolName, ToolStatistics>()
  const models = new Map<string, ModelStatistics>()
  let weightedDuration = 0
  for (const overview of overviews) {
    const source = overview.totals
    weightedDuration += source.averageDurationMs * source.invocations
    for (const key of ['invocations', 'successes', 'failures', 'calls', 'attempts', 'retries', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd', 'topLogprobScores', 'explicitTagScores'] as const) totals[key] += source[key]
    for (const row of overview.daily) {
      const target = daily.get(row.date) ?? { date: row.date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} }
      for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'estimatedCostUsd'] as const) target[key] += row[key]
      for (const [tool, count] of Object.entries(row.byTool)) target.byTool[tool] = (target.byTool[tool] ?? 0) + count
      daily.set(row.date, target)
    }
    for (const row of overview.tools) {
      const target = tools.get(row.toolName) ?? { toolName: row.toolName, invocations: 0, successes: 0, failures: 0, successRate: 0, averageDurationMs: 0, calls: 0, tokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0 }
      target.averageDurationMs = (target.averageDurationMs * target.invocations + row.averageDurationMs * row.invocations) / (target.invocations + row.invocations || 1)
      for (const key of ['invocations', 'successes', 'failures', 'calls', 'tokens', 'cacheHits', 'cacheMisses', 'estimatedCostUsd'] as const) target[key] += row[key]
      target.successRate = ratio(target.successes, target.invocations)
      tools.set(row.toolName, target)
    }
    for (const row of overview.models) {
      const key = row.provider + '\u0000' + row.model
      const target = models.get(key) ?? { provider: row.provider, model: row.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 }
      for (const field of ['invocations', 'calls', 'tokens', 'estimatedCostUsd'] as const) target[field] += row[field]
      models.set(key, target)
    }
  }
  totals.averageDurationMs = ratio(weightedDuration, totals.invocations)
  totals.successRate = ratio(totals.successes, totals.invocations)
  totals.cacheHitRate = ratio(totals.cacheHits, totals.cacheHits + totals.cacheMisses)
  const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)))
  return {
    generatedAt: Date.now(), fromMs: query.fromMs, toMs: query.toMs,
    ...(query.sessionId ? { sessionId: query.sessionId } : {}), totals,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tools: [...tools.values()].sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName)),
    models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    recent: overviews.flatMap(value => value.recent).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
  }
}

export class StatisticsStore {
  private loaded = false
  private records: InvocationRecord[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string, private readonly maxEntries = 50_000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error('llm-verifier: statistics maxEntries must be a positive integer')
  }

  async record(input: InvocationInput): Promise<InvocationRecord> {
    const finishedAt = input.finishedAt ?? Date.now()
    const record: InvocationRecord = {
      id: randomUUID(),
      toolName: input.toolName,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      startedAt: input.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - input.startedAt),
      success: input.success,
      ...(input.errorName ? { errorName: cleanError(input.errorName) } : {}),
      ...(input.errorMessage ? { errorMessage: cleanError(input.errorMessage) } : {}),
      provider: input.provider,
      model: input.model,
      stats: { ...input.stats },
    }
    const operation = async () => {
      await this.load()
      this.records.push(record)
      if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries)
      await this.persist()
    }
    this.writing = this.writing.then(operation, operation)
    await this.writing
    return record
  }

  async overview(query: StatisticsQuery): Promise<StatisticsOverview> {
    if (!Number.isFinite(query.fromMs) || !Number.isFinite(query.toMs) || query.fromMs >= query.toMs) throw new Error('llm-verifier: statistics range must be finite and increasing')
    await this.writing.catch(() => {})
    await this.load()
    const offset = Number.isFinite(query.timezoneOffsetMinutes) ? Math.trunc(query.timezoneOffsetMinutes ?? 0) : 0
    const limit = Math.min(200, Math.max(1, Math.trunc(query.recentLimit ?? 40)))
    const selected = this.records.filter(record => record.startedAt >= query.fromMs && record.startedAt < query.toMs && (query.sessionId === undefined || record.sessionId === query.sessionId))
    const totals = blankTotals()
    const daily = new Map<string, DailyStatistics>()
    const tools = new Map<VerifierToolName, { totals: StatisticsTotals; duration: number }>()
    const models = new Map<string, ModelStatistics>()
    for (const record of selected) {
      addRecord(totals, record)
      const date = localDate(record.startedAt, offset)
      const day = daily.get(date) ?? { date, invocations: 0, successes: 0, failures: 0, calls: 0, tokens: 0, estimatedCostUsd: 0, byTool: {} }
      day.invocations += 1
      record.success ? day.successes += 1 : day.failures += 1
      day.calls += record.stats.calls
      day.tokens += tokens(record.stats)
      day.estimatedCostUsd += record.stats.estimatedCostUsd
      day.byTool[record.toolName] = (day.byTool[record.toolName] ?? 0) + 1
      daily.set(date, day)
      const tool = tools.get(record.toolName) ?? { totals: blankTotals(), duration: 0 }
      addRecord(tool.totals, record)
      tool.duration += record.durationMs
      tools.set(record.toolName, tool)
      const modelKey = record.provider + '\u0000' + record.model
      const model = models.get(modelKey) ?? { provider: record.provider, model: record.model, invocations: 0, calls: 0, tokens: 0, estimatedCostUsd: 0 }
      model.invocations += 1
      model.calls += record.stats.calls
      model.tokens += tokens(record.stats)
      model.estimatedCostUsd += record.stats.estimatedCostUsd
      models.set(modelKey, model)
    }
    finishTotals(totals)
    const toolRows = [...tools.entries()].map(([toolName, value]) => {
      const summary = finishTotals(value.totals)
      return { toolName, invocations: summary.invocations, successes: summary.successes, failures: summary.failures, successRate: summary.successRate, averageDurationMs: summary.averageDurationMs, calls: summary.calls, tokens: summary.tokens, cacheHits: summary.cacheHits, cacheMisses: summary.cacheMisses, estimatedCostUsd: summary.estimatedCostUsd }
    }).sort((a, b) => b.invocations - a.invocations || a.toolName.localeCompare(b.toolName))
    return {
      generatedAt: Date.now(),
      fromMs: query.fromMs,
      toMs: query.toMs,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      totals,
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      tools: toolRows,
      models: [...models.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
      recent: [...selected].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit),
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const document = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StatisticsDocument>
      if (document.version === 1 && Array.isArray(document.records)) this.records = document.records.filter(isRecord).slice(-this.maxEntries)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async persist(): Promise<void> {
    const snapshot: StatisticsDocument = { version: 1, records: this.records }
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = this.file + '.tmp-' + process.pid + '-' + randomUUID()
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
    try { await rename(temporary, this.file) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }
}

export function emptyRunStats(): RunStats {
  return { calls: 0, attempts: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 }
}

export function errorDetails(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) return { errorName: error.name || 'Error', errorMessage: error.message || String(error) }
  return { errorName: 'Error', errorMessage: String(error) }
}
