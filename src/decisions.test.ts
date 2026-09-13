import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DecisionStore, boundDecisionCalls, resolveDecisionsFile } from './decisions.ts'

const call = (overrides: Partial<{ label: string; channel: string; prompt: string; output: string; score?: number }> = {}) => ({
  label: 'Specification Adherence repeat 1',
  channel: 'explicit-tag',
  prompt: 'score this',
  output: '<score_A> K </score_A>',
  ...overrides,
})

describe('boundDecisionCalls', () => {
  it('keeps a small capture intact', () => {
    const bounded = boundDecisionCalls([call({ score: 0.5263 })])
    expect(bounded).toHaveLength(1)
    expect(bounded[0]!.score).toBe(0.5263)
    expect(bounded[0]!.channel).toBe('explicit-tag')
  })

  it('redacts and truncates every captured field', () => {
    const bounded = boundDecisionCalls([call({ prompt: 'Authorization: Bearer abcdefghijklmnop ' + 'p'.repeat(20000), output: 'o'.repeat(9000) })])
    expect(bounded[0]!.prompt).not.toContain('abcdefghijklmnop')
    expect(bounded[0]!.prompt.length).toBeLessThanOrEqual(8000)
    expect(bounded[0]!.output.length).toBeLessThanOrEqual(4000)
  })

  it('bounds a record by call count and by the per-record character budget', () => {
    // 40 calls are capped at MAX_CALLS = 12, and the equal per-call share keeps every one of
    // them inside the character budget rather than dropping the tail.
    const many = Array.from({ length: 40 }, (_, index) => call({ label: 'c' + index, prompt: 'p'.repeat(6000), output: 'o'.repeat(3000) }))
    const bounded = boundDecisionCalls(many)
    expect(bounded).toHaveLength(12)
    const total = bounded.reduce((sum, value) => sum + value.prompt.length + value.output.length + value.label.length + value.channel.length, 0)
    expect(total).toBeLessThanOrEqual(30000)
    // The first call is always kept, so a snapshot never comes back empty.
    expect(bounded[0]!.label).toBe('c0')
  })

  it('keeps every call of a six-call session acceptance instead of the first three', () => {
    // Regression: a fixed 8000-char prompt window meant 30000 / 8000 drove the loop to break
    // after three calls, and only the calls that finished first were stored — the acceptance
    // path, the plugin's most expensive decision, lost half its criteria.
    const acceptance = Array.from({ length: 6 }, (_, index) => call({
      label: 'criterion ' + Math.floor(index / 2) + ' repeat ' + (index % 2 + 1),
      prompt: 'HEAD\n' + 'p'.repeat(120000) + '\nTAIL',
      output: '<score_A> K </score_A>\n' + 'o'.repeat(900),
    }))
    const bounded = boundDecisionCalls(acceptance)
    expect(bounded).toHaveLength(6)
    expect(new Set(bounded.map(value => value.label)).size).toBe(6)
    // Both ends of the (much shorter) window still survive.
    expect(bounded[0]!.prompt.startsWith('HEAD')).toBe(true)
    expect(bounded[0]!.prompt.endsWith('TAIL')).toBe(true)
    const total = bounded.reduce((sum, value) => sum + value.prompt.length + value.output.length + value.label.length + value.channel.length, 0)
    expect(total).toBeLessThanOrEqual(30000)
  })

  it('ignores a non-finite score instead of persisting NaN', () => {
    const bounded = boundDecisionCalls([call({ score: Number.NaN })])
    expect(bounded[0]!.score).toBeUndefined()
  })
})

describe('boundCaptureText', () => {
  it('keeps both ends of an over-long prompt instead of only the head', () => {
    // A session-acceptance prompt runs past 100k characters: head-only truncation saved
    // the instructions and dropped the trajectory tail, i.e. the part the judge graded.
    const prompt = 'HEAD-MARKER\n' + 'x'.repeat(30000) + '\nTAIL-MARKER'
    const kept = boundDecisionCalls([call({ prompt })])[0]!.prompt
    expect(kept.length).toBeLessThanOrEqual(8000)
    expect(kept.startsWith('HEAD-MARKER')).toBe(true)
    expect(kept.endsWith('TAIL-MARKER')).toBe(true)
    expect(kept).toContain('characters omitted')
  })

  it('leaves a prompt that already fits untouched', () => {
    const kept = boundDecisionCalls([call({ prompt: 'short prompt' })])[0]!.prompt
    expect(kept).toBe('short prompt')
    expect(kept).not.toContain('omitted')
  })
})

describe('DecisionStore', () => {
  it('stores a snapshot and finds it again from a fresh instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-decisions-'))
    const file = join(root, 'decisions.json')
    const store = new DecisionStore(file)
    const record = await store.record({ toolName: 'verifier_track', phase: 'track', startedAt: 1, provider: 'p', model: 'm', calls: [call()] })
    expect(record?.calls).toHaveLength(1)
    // Survives a restart: the second store loads the same file.
    const reopened = new DecisionStore(file)
    expect(await reopened.find(record!.id)).toMatchObject({ toolName: 'verifier_track', phase: 'track' })
    const document = JSON.parse(await readFile(file, 'utf8'))
    expect(document.version).toBe(1)
    expect(document.records).toHaveLength(1)
  })

  it('writes nothing when no call was captured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-decisions-'))
    const file = join(root, 'decisions.json')
    const store = new DecisionStore(file)
    expect(await store.record({ toolName: 'verifier_track', phase: 'track', startedAt: 1, provider: 'p', model: 'm', calls: [] })).toBeUndefined()
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps only the newest records and returns undefined for a pruned id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-decisions-'))
    const file = join(root, 'decisions.json')
    const store = new DecisionStore(file, 2)
    const first = await store.record({ toolName: 'a', phase: 'explicit', startedAt: 1, provider: 'p', model: 'm', calls: [call()] })
    const second = await store.record({ toolName: 'b', phase: 'explicit', startedAt: 2, provider: 'p', model: 'm', calls: [call()] })
    const third = await store.record({ toolName: 'c', phase: 'explicit', startedAt: 3, provider: 'p', model: 'm', calls: [call()] })
    expect(await store.find(first!.id)).toBeUndefined()
    expect(await store.find(second!.id)).toMatchObject({ toolName: 'b' })
    expect(await store.find(third!.id)).toMatchObject({ toolName: 'c' })
    const document = JSON.parse(await readFile(file, 'utf8'))
    expect(document.records.map((row: { toolName: string }) => row.toolName)).toEqual(['b', 'c'])
  })

  it('skips a corrupt document instead of failing the invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-decisions-'))
    const file = join(root, 'decisions.json')
    await writeFile(file, JSON.stringify({ version: 1, records: [{ id: 5 }, { id: 'ok', toolName: 'a', startedAt: 1, calls: [] }] }), 'utf8')
    const store = new DecisionStore(file)
    await store.load()
    expect(await store.find('ok')).toMatchObject({ toolName: 'a' })
  })

  it('resolves the snapshot file beside the statistics of the same topic', () => {
    expect(resolveDecisionsFile(join('topic', 'verifier', 'scores-v1.json'))).toBe(join('topic', 'verifier', 'decisions-v1.json'))
  })
})
