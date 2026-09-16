import { describe, expect, it } from 'vitest'
import { en, zh } from './client-i18n.ts'
import { buildProcessCycles, type ProcessCycleRowInput } from './client-process-cycles.ts'

const zhT = zh as unknown as Record<string, string>
const enT = en as unknown as Record<string, string>

/** One recent statistics row: an id, its timestamp and the route observation it carries. */
const row = (id: string, startedAt: number, route: ProcessCycleRowInput['route']): ProcessCycleRowInput => ({ id, startedAt, route })

/** The chips of one cycle as `stage:tone:text` strings, so an assertion reads as the pipeline. */
const chips = (cycles: ReturnType<typeof buildProcessCycles>, index = 0): string[] =>
  cycles[index].stages.map(stage => stage.stage + ':' + stage.tone + ':' + stage.text)

describe('process cycle pipeline view model', () => {
  it('returns nothing for an empty, null or undefined recent list', () => {
    expect(buildProcessCycles([], zhT)).toEqual([])
    expect(buildProcessCycles(null, zhT)).toEqual([])
    expect(buildProcessCycles(undefined, zhT)).toEqual([])
    // A recent list that exists but holds only non-process rows contributes no cycle either: the
    // routing and final destinations belong to the recent list, not to this pipeline.
    expect(buildProcessCycles([
      row('r1', 1, { cycleId: 'c1', destination: 'compare', stage: 'execution' }),
      row('r2', 2, { cycleId: 'c2', destination: 'final', stage: 'final' }),
      row('r3', 3, undefined),
      row('r4', 4, { destination: 'process', stage: 'process' }),
    ], zhT)).toEqual([])
  })

  it('renders a skip row as an unbought cycle whose replay was never reached', () => {
    const cycles = buildProcessCycles([row('r1', 100, {
      cycleId: 'cycle-skip',
      trigger: 'llm-stream',
      stage: 'skipped',
      destination: 'process',
      skipReason: 'no-process-budget',
      replayed: 'none',
      generatedCalls: 0,
      judgeCalls: 0,
      sameCandidate: false,
    })], zhT)
    expect(cycles).toHaveLength(1)
    expect(cycles[0].purchased).toBe(false)
    expect(cycles[0].replayed).toBe('none')
    expect(cycles[0].skipReason).toBe('no-process-budget')
    expect(chips(cycles)).toEqual([
      'purchase:warn:未购买',
      'generate:neutral:未生成备选',
      'judge:neutral:未评判',
      'replay:neutral:未到达回放',
      'skip:warn:跳过 no-process-budget',
    ])
  })

  it('marks a canceled skip row with the error chip and the pre-purchase cancel label', () => {
    const cycles = buildProcessCycles([row('r1', 100, {
      cycleId: 'cycle-canceled', destination: 'process', stage: 'skipped', canceled: true, skipReason: 'canceled', replayed: 'none',
    })], zhT)
    expect(cycles[0].canceled).toBe(true)
    expect(chips(cycles)).toContain('purchase:warn:购买前已取消')
    expect(chips(cycles)).toContain('canceled:error:已取消')
  })

  it('renders a purchased cycle that replayed the alternative through all four stages', () => {
    const cycles = buildProcessCycles([row('r1', 500, {
      cycleId: 'cycle-win',
      trigger: 'llm-stream',
      stage: 'process',
      destination: 'process',
      attempt: 1,
      reservedCalls: 3,
      replayed: 'candidate',
      generatedCalls: 1,
      judgeCalls: 2,
      sameCandidate: false,
      alternativeAugmented: true,
      alternativeModel: 'deepseek-official/deepseek-chat, deepseek-official/deepseek-reasoner',
    })], zhT)
    expect(cycles).toHaveLength(1)
    const cycle = cycles[0]
    expect(cycle.purchased).toBe(true)
    expect(cycle.alternativeModels).toEqual(['deepseek-official/deepseek-chat', 'deepseek-official/deepseek-reasoner'])
    expect(cycle.rows).toBe(1)
    expect(chips(cycles)).toEqual([
      'purchase:pass:已购买 · 第 1 次 · 预留 3',
      'generate:pass:生成备选 1 · deepseek-official/deepseek-chat / deepseek-official/deepseek-reasoner',
      'augment:warn:备选附带失败证据',
      'judge:pass:评判 2 次',
      'replay:pass:回放备选',
    ])
  })

  it('says the judge was skipped when the two candidates were identical', () => {
    const cycles = buildProcessCycles([row('r1', 500, {
      cycleId: 'cycle-same', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 3,
      replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true, alternativeModel: '',
    })], zhT)
    expect(chips(cycles)).toContain('judge:warn:候选相同 · 未评判')
    expect(chips(cycles)).toContain('replay:neutral:回放原回复')
  })

  it('folds the rows of one cycle into a single view without double-counting them', () => {
    const cycles = buildProcessCycles([
      row('skip-row', 90, { cycleId: 'cycle-1', destination: 'process', stage: 'skipped', skipReason: 'no-process-budget', replayed: 'none', generatedCalls: 0, judgeCalls: 0 }),
      row('buy-row', 100, { cycleId: 'cycle-1', destination: 'process', stage: 'process', attempt: 2, reservedCalls: 4, replayed: 'original', generatedCalls: 1, judgeCalls: 3 }),
      row('other', 200, { cycleId: 'cycle-2', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 2, replayed: 'candidate', generatedCalls: 1, judgeCalls: 2 }),
    ], zhT)
    expect(cycles.map(cycle => cycle.cycleId)).toEqual(['cycle-2', 'cycle-1'])
    const first = cycles[1]
    expect(first.rows).toBe(2)
    expect(first.purchased).toBe(true)
    // Per-row maxima, never sums: the reservation was 4 calls, not 8.
    expect(first.reservedCalls).toBe(4)
    expect(first.judgeCalls).toBe(3)
    expect(first.skipReason).toBe('no-process-budget')
    expect(chips(cycles, 1)).toContain('purchase:pass:已购买 · 第 2 次 · 预留 4')
    expect(chips(cycles, 1)).toContain('replay:neutral:回放原回复')
  })

  it('orders cycles newest first, whatever order the rows arrive in', () => {
    const rows = [
      row('old', 100, { cycleId: 'old', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 1, replayed: 'original' }),
      row('new', 900, { cycleId: 'new', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 1, replayed: 'candidate' }),
      row('middle', 500, { cycleId: 'middle', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 1, replayed: 'original' }),
    ]
    expect(buildProcessCycles(rows, zhT).map(cycle => cycle.cycleId)).toEqual(['new', 'middle', 'old'])
    expect(buildProcessCycles([...rows].reverse(), zhT).map(cycle => cycle.cycleId)).toEqual(['new', 'middle', 'old'])
  })

  it('keeps a cycle whose rows carry no timestamp, and still exposes the cycle id', () => {
    const cycles = buildProcessCycles([{ route: { cycleId: 'untimed', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 1, replayed: 'original' } }], zhT)
    expect(cycles).toHaveLength(1)
    expect(cycles[0].cycleId).toBe('untimed')
    expect(cycles[0].startedAt).toBe(0)
    expect(cycles[0].recordId).toBeUndefined()
  })

  it('localizes every chip from the passed dictionary, at the same stage order', () => {
    const input = [row('r1', 100, {
      cycleId: 'cycle-en', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 2,
      replayed: 'candidate', generatedCalls: 1, judgeCalls: 2, alternativeAugmented: true,
      alternativeModel: 'p/deepseek-chat',
    })]
    expect(chips(buildProcessCycles(input, enT))).toEqual([
      'purchase:pass:purchased · try 1 · reserved 2',
      'generate:pass:generated 1 alternative(s) · p/deepseek-chat',
      'augment:warn:alternative carried the failure evidence',
      'judge:pass:judged 2 time(s)',
      'replay:pass:replayed the alternative',
    ])
  })

  it('resolves every chip it can render in both dictionaries, so no key is left as a typo', () => {
    // One input per chip-bearing branch: augmented generation, the identical-candidate short
    // circuit, the canceled skip and the plain skip reason.
    const inputs: ProcessCycleRowInput[] = [
      row('a', 10, { cycleId: 'c1', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 2, replayed: 'candidate', generatedCalls: 1, judgeCalls: 2, alternativeAugmented: true, alternativeModel: 'p/x' }),
      row('b', 9, { cycleId: 'c2', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 2, replayed: 'original', generatedCalls: 1, judgeCalls: 0, sameCandidate: true }),
      row('c', 8, { cycleId: 'c3', destination: 'process', stage: 'skipped', canceled: true, skipReason: 'canceled', replayed: 'none' }),
      row('d', 7, { cycleId: 'c4', destination: 'process', stage: 'skipped', skipReason: 'no-process-budget', replayed: 'none' }),
    ]
    for (const dictionary of [zhT, enT]) {
      for (const cycle of buildProcessCycles(inputs, dictionary)) {
        for (const stage of cycle.stages) expect(stage.text).not.toContain('processCycles.')
      }
      // The four header strings are read by the section itself, not by the view model.
      for (const key of ['processCycles.title', 'processCycles.note', 'processCycles.cycle', 'processCycles.rows']) {
        expect(dictionary[key], key).toBeTruthy()
      }
    }
  })

  it('falls back to the key itself when a dictionary is missing an entry', () => {
    const cycles = buildProcessCycles([row('r1', 1, { cycleId: 'c', destination: 'process', stage: 'process', attempt: 1, reservedCalls: 1, replayed: 'candidate', generatedCalls: 1, judgeCalls: 1 })], {})
    expect(cycles[0].stages[0].text).toBe('processCycles.stage.cpPurchased')
  })
})
