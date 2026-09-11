import { addUsage, callVerifier, emptyUsage, predictScoringChannel, type ScoringMode, type UsageStats, type VerifierClientConfig, type VerifierImage } from './caller.ts'
import { ScoreCache, SingleFlight, stableHash, type CachedPairScore } from './cache.ts'
import {
  DEFAULT_CRITERIA, DEFAULT_GROUND_TRUTH_NOTE, accumulatePairs, buildPairwisePrompt, buildProgressPrompt,
  extractProgressScore, extractScore, pivotRoundPairs, rankScores, ringCycle, topPivots, type Criterion,
} from './core.ts'

export interface CompareOptions { problem: string; candidateA: string; candidateB: string; criteria?: readonly Criterion[]; groundTruthNote?: string; repeats?: number; images?: readonly VerifierImage[] }
export interface CriterionResult { id: string; name: string; scoreA: number; scoreB: number }
export interface RunStats extends UsageStats { cacheHits: number; cacheMisses: number; estimatedCostUsd: number; topLogprobScores: number; explicitTagScores: number }

export interface JudgeScore {
  provider: string
  model: string
  label: string
  ok: boolean
  calls: number
  error?: string
  scoreA?: number
  scoreB?: number
  winner?: 'A' | 'B' | 'tie'
  scores?: number[]
  ranking?: number[]
}

export interface CompareResult {
  scoreA: number
  scoreB: number
  winner: 'A' | 'B' | 'tie'
  criteria: CriterionResult[]
  calls: number
  stats: RunStats
  judges: JudgeScore[]
  agreement: number
}

export interface SelectOptions { problem: string; candidates: readonly string[]; criteria?: readonly Criterion[]; groundTruthNote?: string; repeats?: number; pivots?: number; seed?: number; images?: readonly VerifierImage[] }

export interface SelectResult {
  index: number
  best: string
  scores: number[]
  ranking: number[]
  pivots: number[]
  comparisons: number
  calls: number
  stats: RunStats
  judges: JudgeScore[]
}

function average(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / (values.length || 1) }

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function blankStats(): RunStats { return { ...emptyUsage(), cacheHits: 0, cacheMisses: 0, estimatedCostUsd: 0, topLogprobScores: 0, explicitTagScores: 0 } }
function unorderedPair(a: number, b: number): string { return a < b ? a + ',' + b : b + ',' + a }

function judgeLabel(client: VerifierClientConfig): string {
  return client.label?.trim() || client.provider + '/' + client.model
}

export class VerifierEngine {
  readonly client: VerifierClientConfig
  readonly clients: readonly VerifierClientConfig[]
  readonly maxConcurrency: number
  readonly cache: ScoreCache | undefined
  readonly inputPrice: number
  readonly outputPrice: number
  private readonly flights: SingleFlight<{ value: CachedPairScore; hit: boolean }>

  constructor(
    client: VerifierClientConfig | readonly VerifierClientConfig[],
    maxConcurrency = 8,
    cache?: ScoreCache,
    prices: { input: number; output: number } = { input: 0, output: 0 },
    flights: SingleFlight<{ value: CachedPairScore; hit: boolean }> = new SingleFlight(),
  ) {
    const list = Array.isArray(client) ? client : [client]
    if (!list.length) throw new Error('llm-verifier: at least one verifier client is required')
    this.clients = list
    this.client = list[0]!
    this.maxConcurrency = maxConcurrency
    this.cache = cache
    this.inputPrice = prices.input
    this.outputPrice = prices.output
    this.flights = flights
  }

  private finishStats(stats: RunStats): RunStats {
    stats.estimatedCostUsd = ((stats.inputTokens + stats.cachedInputTokens) * this.inputPrice + stats.outputTokens * this.outputPrice) / 1_000_000
    return stats
  }

  private async scoreOne(client: VerifierClientConfig, options: CompareOptions, candidateA: string, candidateB: string, criterion: Criterion, repeat: number, signal?: AbortSignal): Promise<{ scores: readonly [number, number]; usage: UsageStats; scoringMode: 'top-logprobs' | 'explicit-tag'; hit: boolean }> {
    const ground = options.groundTruthNote ?? DEFAULT_GROUND_TRUTH_NOTE
    const prompt = buildPairwisePrompt(options.problem, candidateA, candidateB, criterion, ground)
    const imageKey = options.images?.map(image => stableHash([image.mediaType, Buffer.from(image.data).toString('base64')]))
    // Cache identity pins the scoring channel, but the channel is only predictable
    // before the call when the capability cache already knows the answer. Lookups use
    // the predicted channel while entries are always stored under the ACTUAL
    // completion mode, so a first-call downgrade lands under explicit-tag keys and is
    // found by later explicit-tag calls instead of being misread as a top-logprobs
    // expectation. The channel stays OUT of the in-flight dedup key below.
    const identity = { version: 5, provider: client.provider, model: client.model, effort: client.reasoningEffort, maxTokens: client.maxTokens, repeat, promptHash: stableHash(prompt), imageKey }
    const keyForMode = (scoringMode: ScoringMode) => stableHash({ ...identity, scoringMode })
    const create = async () => {
      const completion = await callVerifier(client, prompt, signal, options.images)
      return { scoreA: extractScore(completion, '<score_A>'), scoreB: extractScore(completion, '<score_B>'), usage: completion.usage, scoringMode: completion.scoringMode, createdAt: Date.now() }
    }
    const cache = this.cache
    if (cache === undefined) { const value = await create(); return { scores: [value.scoreA, value.scoreB], usage: value.usage, scoringMode: value.scoringMode, hit: false } }
    // Registration happens in the synchronous segment before any await, so a request
    // that arrives while the first one is still resolving its channel prediction
    // still merges instead of duplicating the model call. The flight table is shared
    // per topic, so concurrent tool calls through separate engine instances merge too.
    const dedupeKey = stableHash(identity)
    const outcome = await this.flights.run(dedupeKey, async () => cache.getOrCreate(keyForMode(await predictScoringChannel(client)), create, value => keyForMode(value.scoringMode)))
    const landed = outcome.value
    const reused = outcome.joined || landed.hit
    return { scores: [landed.value.scoreA, landed.value.scoreB], usage: reused ? emptyUsage() : landed.value.usage, scoringMode: landed.value.scoringMode, hit: reused }
  }

  private async mapLimited<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length); let cursor = 0
    const runners = Array.from({ length: Math.min(this.maxConcurrency, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; results[index] = await worker(items[index]!) } })
    await Promise.all(runners); return results
  }

  async compare(options: CompareOptions, signal?: AbortSignal): Promise<CompareResult> {
    const criteria = options.criteria?.length ? options.criteria : DEFAULT_CRITERIA
    const repeats = options.repeats ?? 2
    const jobs = criteria.flatMap(criterion => Array.from({ length: repeats }, (_, repeat) => ({ criterion, repeat })))
    // Prefix warm-up: one criterion/repeat runs first, then the shared-prefix fan-out.
    const warm = jobs.slice(0, 1); const rest = jobs.slice(1)
    const run = async (batch: typeof jobs) => this.mapLimited(batch, async ({ criterion, repeat }) => {
      const swapped = repeat % 2 === 1
      const candA = swapped ? options.candidateB : options.candidateA
      const candB = swapped ? options.candidateA : options.candidateB
      const judgeResults = await Promise.all(
        this.clients.map(async (client, k) => {
          try {
            const res = await this.scoreOne(client, options, candA, candB, criterion, repeat, signal)
            return {
              k,
              ok: true as const,
              scoreA: swapped ? res.scores[1] : res.scores[0],
              scoreB: swapped ? res.scores[0] : res.scores[1],
              usage: res.usage,
              scoringMode: res.scoringMode,
              hit: res.hit,
            }
          } catch (error) {
            return {
              k,
              ok: false as const,
              error,
            }
          }
        })
      )
      const successful = judgeResults.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      if (successful.length === 0) {
        const firstFail = judgeResults.find(r => !r.ok)! as Extract<typeof judgeResults[number], { ok: false }>
        throw firstFail.error
      }
      const leafScoreA = median(successful.map(r => r.scoreA))
      const leafScoreB = median(successful.map(r => r.scoreB))
      return { criterion, repeat, leafScoreA, leafScoreB, judgeResults }
    })

    const jobOutcomes = [...await run(warm), ...await run(rest)]
    const stats = blankStats()
    const judgeCalls = new Array<number>(this.clients.length).fill(0)
    const judgeOk = new Array<boolean>(this.clients.length).fill(true)
    const judgeErrors = new Array<string | undefined>(this.clients.length).fill(undefined)
    const judgeJobScores: Array<Array<{ criterionId: string; scoreA: number; scoreB: number }>> = Array.from(
      { length: this.clients.length },
      () => []
    )

    for (const outcome of jobOutcomes) {
      for (const r of outcome.judgeResults) {
        if (r.ok) {
          judgeCalls[r.k] += r.usage.calls
          judgeJobScores[r.k]!.push({ criterionId: outcome.criterion.id, scoreA: r.scoreA, scoreB: r.scoreB })
          addUsage(stats, r.usage)
          if (r.hit) stats.cacheHits++
          else stats.cacheMisses++
          if (r.scoringMode === 'top-logprobs') stats.topLogprobScores++
          else stats.explicitTagScores++
        } else {
          judgeOk[r.k] = false
          if (judgeErrors[r.k] === undefined) {
            judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error)
          }
        }
      }
    }

    const byCriterion = criteria.map(criterion => {
      const rows = jobOutcomes.filter(row => row.criterion.id === criterion.id)
      return {
        id: criterion.id,
        name: criterion.name,
        scoreA: average(rows.map(row => row.leafScoreA)),
        scoreB: average(rows.map(row => row.leafScoreB)),
      }
    })
    const scoreA = average(byCriterion.map(value => value.scoreA))
    const scoreB = average(byCriterion.map(value => value.scoreB))
    const winner: 'A' | 'B' | 'tie' = Math.abs(scoreA - scoreB) < 1e-12 ? 'tie' : scoreA > scoreB ? 'A' : 'B'

    const judges: JudgeScore[] = this.clients.map((client, k) => {
      const isOk = judgeOk[k]!
      if (!isOk) {
        return {
          provider: client.provider,
          model: client.model,
          label: judgeLabel(client),
          ok: false,
          calls: judgeCalls[k]!,
          ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
        }
      }
      const jByCriterion = criteria.map(criterion => {
        const rows = judgeJobScores[k]!.filter(row => row.criterionId === criterion.id)
        return {
          scoreA: average(rows.map(row => row.scoreA)),
          scoreB: average(rows.map(row => row.scoreB)),
        }
      })
      const jScoreA = average(jByCriterion.map(c => c.scoreA))
      const jScoreB = average(jByCriterion.map(c => c.scoreB))
      const jWinner: 'A' | 'B' | 'tie' = Math.abs(jScoreA - jScoreB) < 1e-12 ? 'tie' : jScoreA > jScoreB ? 'A' : 'B'
      return {
        provider: client.provider,
        model: client.model,
        label: judgeLabel(client),
        ok: true,
        calls: judgeCalls[k]!,
        scoreA: jScoreA,
        scoreB: jScoreB,
        winner: jWinner,
      }
    })

    const scoringJudges = judges.filter(j => j.ok && j.winner !== undefined)
    const agreement = scoringJudges.length === 0
      ? 0
      : scoringJudges.length === 1
        ? 1
        : scoringJudges.filter(j => j.winner === winner).length / scoringJudges.length

    return {
      scoreA,
      scoreB,
      winner,
      criteria: byCriterion,
      calls: stats.calls,
      stats: this.finishStats(stats),
      judges,
      agreement,
    }
  }

  private async scorePairs(options: SelectOptions, pairs: readonly [number, number][], signal?: AbortSignal): Promise<{
    rewards: Map<string, readonly [number, number]>
    judgeRewards: Array<Map<string, readonly [number, number]>>
    judgeOk: boolean[]
    judgeErrors: Array<string | undefined>
    judgeCalls: number[]
    stats: RunStats
  }> {
    const unique = [...new Map(pairs.map(pair => [pair[0] + ',' + pair[1], pair])).values()]
    const values = await this.mapLimited(unique, async ([a, b]) => ({
      a,
      b,
      result: await this.compare({
        problem: options.problem,
        candidateA: options.candidates[a]!,
        candidateB: options.candidates[b]!,
        criteria: options.criteria,
        groundTruthNote: options.groundTruthNote,
        repeats: options.repeats,
        images: options.images,
      }, signal),
    }))
    const rewards = new Map<string, readonly [number, number]>()
    const judgeRewards: Array<Map<string, readonly [number, number]>> = Array.from({ length: this.clients.length }, () => new Map())
    const judgeOk = new Array<boolean>(this.clients.length).fill(true)
    const judgeErrors = new Array<string | undefined>(this.clients.length).fill(undefined)
    const judgeCalls = new Array<number>(this.clients.length).fill(0)
    const stats = blankStats()

    for (const value of values) {
      const pairKey = value.a + ',' + value.b
      rewards.set(pairKey, [value.result.scoreA, value.result.scoreB])
      addUsage(stats, value.result.stats)
      stats.cacheHits += value.result.stats.cacheHits
      stats.cacheMisses += value.result.stats.cacheMisses
      stats.topLogprobScores += value.result.stats.topLogprobScores
      stats.explicitTagScores += value.result.stats.explicitTagScores

      for (let k = 0; k < this.clients.length; k++) {
        const js = value.result.judges[k]!
        judgeCalls[k] += js.calls
        if (js.ok && js.scoreA !== undefined && js.scoreB !== undefined) {
          judgeRewards[k]!.set(pairKey, [js.scoreA, js.scoreB])
        } else {
          judgeOk[k] = false
          if (judgeErrors[k] === undefined && js.error) {
            judgeErrors[k] = js.error
          }
        }
      }
    }
    return { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats: this.finishStats(stats) }
  }

  async track(problem: string, steps: readonly string[], checkpoints: readonly number[], repeats = 2, signal?: AbortSignal, images?: readonly VerifierImage[]): Promise<{ scores: number[]; perRepeat: number[][]; calls: number; stats: RunStats; judges: JudgeScore[] }> {
    if (!steps.length || !checkpoints.length) throw new Error('llm-verifier: steps and checkpoints must not be empty')
    for (const checkpoint of checkpoints) if (!Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > steps.length) throw new Error('llm-verifier: each checkpoint must be an integer between 1 and steps.length')
    const prompt = buildProgressPrompt(problem, steps, checkpoints)
    const stats = blankStats()
    const judgeCalls = new Array<number>(this.clients.length).fill(0)
    const judgeOk = new Array<boolean>(this.clients.length).fill(true)
    const judgeErrors = new Array<string | undefined>(this.clients.length).fill(undefined)
    const judgePerRepeatScores: Array<number[][]> = Array.from({ length: this.clients.length }, () => [])

    const repeatIndices = Array.from({ length: repeats }, (_, index) => index)
    const runs = await this.mapLimited(repeatIndices, async () => {
      const judgeResults = await Promise.all(
        this.clients.map(async (client, k) => {
          try {
            const completion = await callVerifier(client, prompt, signal, images)
            const scores = checkpoints.map((_, index) => extractProgressScore(completion, '<c' + (index + 1) + '>'))
            return {
              k,
              ok: true as const,
              completion,
              scores,
            }
          } catch (error) {
            return {
              k,
              ok: false as const,
              error,
            }
          }
        })
      )

      const successful = judgeResults.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      if (successful.length === 0) {
        const firstFail = judgeResults.find(r => !r.ok)! as Extract<typeof judgeResults[number], { ok: false }>
        throw firstFail.error
      }

      for (const r of judgeResults) {
        if (r.ok) {
          judgeCalls[r.k] += r.completion.usage.calls
          judgePerRepeatScores[r.k]!.push(r.scores)
          addUsage(stats, r.completion.usage)
          if (r.completion.scoringMode === 'top-logprobs') stats.topLogprobScores++
          else stats.explicitTagScores++
        } else {
          judgeOk[r.k] = false
          if (judgeErrors[r.k] === undefined) {
            judgeErrors[r.k] = r.error instanceof Error ? r.error.message : String(r.error)
          }
        }
      }

      return checkpoints.map((_, cIndex) => median(successful.map(r => r.scores[cIndex]!)))
    })

    const scores = checkpoints.map((_, index) => average(runs.map(run => run[index]!)))
    const judges: JudgeScore[] = this.clients.map((client, k) => {
      const isOk = judgeOk[k]!
      if (!isOk) {
        return {
          provider: client.provider,
          model: client.model,
          label: judgeLabel(client),
          ok: false,
          calls: judgeCalls[k]!,
          ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
        }
      }
      const jRuns = judgePerRepeatScores[k]!
      const jScores = checkpoints.map((_, index) => average(jRuns.map(run => run[index]!)))
      return {
        provider: client.provider,
        model: client.model,
        label: judgeLabel(client),
        ok: true,
        calls: judgeCalls[k]!,
        scores: jScores,
      }
    })

    return { scores, perRepeat: runs, calls: stats.calls, stats: this.finishStats(stats), judges }
  }

  async select(options: SelectOptions, signal?: AbortSignal): Promise<SelectResult> {
    if (!options.candidates.length) throw new Error('llm-verifier: candidates must not be empty')
    if (options.candidates.length === 1) {
      const judges: JudgeScore[] = this.clients.map(client => ({
        provider: client.provider,
        model: client.model,
        label: judgeLabel(client),
        ok: true,
        calls: 0,
        scores: [1],
        ranking: [0],
      }))
      return { index: 0, best: options.candidates[0]!, scores: [1], ranking: [0], pivots: [0], comparisons: 0, calls: 0, stats: blankStats(), judges }
    }
    if (options.candidates.length === 2) {
      // ringCycle(2) would judge the single unordered pair in both directions; play it once.
      const { rewards, judgeRewards, judgeOk, judgeErrors, judgeCalls, stats } = await this.scorePairs(options, [[0, 1]], signal)
      const wins = [0, 0]; const counts = [0, 0]
      accumulatePairs([[0, 1]], rewards, wins, counts)
      const ranked = rankScores(wins, counts); const index = ranked[0]!.index
      const judges: JudgeScore[] = this.clients.map((client, k) => {
        const isOk = judgeOk[k]!
        if (!isOk) {
          return {
            provider: client.provider,
            model: client.model,
            label: judgeLabel(client),
            ok: false,
            calls: judgeCalls[k]!,
            ...(judgeErrors[k] !== undefined ? { error: judgeErrors[k] } : {}),
          }
        }
        const jWins = [0, 0]; const jCounts = [0, 0]
        accumulatePairs([[0, 1]], judgeRewards[k]!, jWins, jCounts)
        const jRanked = rankScores(jWins, jCounts)
        return {
          provider: client.provider,
          model: client.model,
          label: judgeLabel(client),
          ok: true,
          calls: judgeCalls[k]!,
          scores: jWins.map((val, c) => val / (jCounts[c] || 1)),
          ranking: jRanked.map(v => v.index),
        }
      })
      return { index, best: options.candidates[index]!, scores: wins.map((value, candidate) => value / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots: [], comparisons: 1, calls: stats.calls, stats, judges }
    }
    const ring = ringCycle(options.candidates.length, options.seed ?? 0)
    const ringScores = await this.scorePairs(options, ring, signal)
    const firstWins = new Array<number>(options.candidates.length).fill(0)
    const firstCounts = new Array<number>(options.candidates.length).fill(0)
    accumulatePairs(ring, ringScores.rewards, firstWins, firstCounts)
    const pivots = topPivots(firstWins, firstCounts, options.pivots ?? 2)
    // pivotRoundPairs regenerates every ring edge that touches a pivot (reversed for
    // pivot→neighbour edges). Dropping those duplicates keeps each unordered pair to a
    // single match so wins/counts are not double-weighted and no pair is judged twice.
    const ringPairs = new Set(ring.map(pair => unorderedPair(pair[0], pair[1])))
    const rounds = pivotRoundPairs(options.candidates.length, pivots).filter(pair => !ringPairs.has(unorderedPair(pair[0], pair[1])))
    const roundScores = await this.scorePairs(options, rounds, signal)
    const allRewards = new Map([...ringScores.rewards, ...roundScores.rewards])
    const wins = new Array<number>(options.candidates.length).fill(0)
    const counts = new Array<number>(options.candidates.length).fill(0)
    accumulatePairs(ring, allRewards, wins, counts)
    accumulatePairs(rounds, allRewards, wins, counts)
    const ranked = rankScores(wins, counts)
    const index = ranked[0]!.index
    const stats = blankStats()
    for (const source of [ringScores.stats, roundScores.stats]) {
      addUsage(stats, source)
      stats.cacheHits += source.cacheHits
      stats.cacheMisses += source.cacheMisses
      stats.topLogprobScores += source.topLogprobScores
      stats.explicitTagScores += source.explicitTagScores
    }

    const judges: JudgeScore[] = this.clients.map((client, k) => {
      const isOk = ringScores.judgeOk[k]! && roundScores.judgeOk[k]!
      const totalCalls = ringScores.judgeCalls[k]! + roundScores.judgeCalls[k]!
      const firstError = ringScores.judgeErrors[k] ?? roundScores.judgeErrors[k]
      if (!isOk) {
        return {
          provider: client.provider,
          model: client.model,
          label: judgeLabel(client),
          ok: false,
          calls: totalCalls,
          ...(firstError !== undefined ? { error: firstError } : {}),
        }
      }
      const jAllRewards = new Map([...ringScores.judgeRewards[k]!, ...roundScores.judgeRewards[k]!])
      const jWins = new Array<number>(options.candidates.length).fill(0)
      const jCounts = new Array<number>(options.candidates.length).fill(0)
      accumulatePairs(ring, jAllRewards, jWins, jCounts)
      accumulatePairs(rounds, jAllRewards, jWins, jCounts)
      const jRanked = rankScores(jWins, jCounts)
      return {
        provider: client.provider,
        model: client.model,
        label: judgeLabel(client),
        ok: true,
        calls: totalCalls,
        scores: Array.from({ length: options.candidates.length }, (_, c) => jWins[c]! / (jCounts[c] || 1)),
        ranking: jRanked.map(v => v.index),
      }
    })

    return { index, best: options.candidates[index]!, scores: Array.from({ length: options.candidates.length }, (_, candidate) => wins[candidate]! / (counts[candidate] || 1)), ranking: ranked.map(value => value.index), pivots, comparisons: ring.length + rounds.length, calls: stats.calls, stats: this.finishStats(stats), judges }
  }
}

export function normalizeCriteria(input: unknown): Criterion[] {
  if (input === undefined) return DEFAULT_CRITERIA
  if (!Array.isArray(input) || !input.length) throw new Error('llm-verifier: criteria must be a non-empty array')
  return input.map((value, index) => { if (typeof value !== 'object' || value === null) throw new Error('llm-verifier: criteria[' + index + '] must be an object'); const row = value as Record<string, unknown>; for (const key of ['id', 'name', 'description']) if (typeof row[key] !== 'string' || row[key].trim().length === 0) throw new Error('llm-verifier: criteria[' + index + '].' + key + ' must be non-empty'); return { id: String(row.id), name: String(row.name), description: String(row.description) } })
}
export { DEFAULT_GROUND_TRUTH_NOTE }
