import { describe, expect, it } from 'vitest'
import {
  accumulatePairs,
  bradleyTerry,
  buildPairwisePrompt,
  buildProgressPrompt,
  extractProgressScore,
  extractScore,
  pivotRoundPairs,
  rankScores,
  ringCycle,
  topPivots,
} from './core.ts'

function completion(text: string, tokens: string[] = [], positions: Array<Array<{ token: string; logprob: number }>> = []) {
  return { text, tokens, positions }
}

describe('score extraction', () => {
  it('parses literal final tags', () => {
    expect(extractScore(completion('<score_A> A </score_A>'), '<score_A>')).toBe(1)
    expect(extractScore(completion('<score_A> T </score_A>'), '<score_A>')).toBe(0)
  })
  it('uses the final literal tag', () => {
    expect(extractScore(completion('<score_A> A </score_A> blah <score_A> T </score_A>'), '<score_A>')).toBe(0)
  })
  it('computes normalized top-logprob expectation', () => {
    const value = extractScore(completion('', ['<score_A>'], [[], [{ token: 'A', logprob: Math.log(0.75) }, { token: 'T', logprob: Math.log(0.25) }]]), '<score_A>')
    expect(value).toBeCloseTo(0.75)
  })
  it('fails closed when the required score tag is missing or invalid', () => {
    expect(() => extractScore(completion('no score'), '<score_A>')).toThrow('valid <score_A>')
    expect(() => extractScore(completion('<score_A> Z </score_A>'), '<score_A>')).toThrow('valid <score_A>')
  })
  it('reverses the progress scale', () => {
    expect(extractProgressScore(completion('<c1> T </c1>'), '<c1>')).toBe(1)
    expect(extractProgressScore(completion('<c1> A </c1>'), '<c1>')).toBe(0)
  })
})

describe('prompts', () => {
  it('puts criterion at the tail', () => {
    const prompt = buildPairwisePrompt('task', 'a', 'b', { id: 'x', name: 'Criterion X', description: 'tail marker' })
    expect(prompt.indexOf('**Trajectory B:**')).toBeLessThan(prompt.indexOf('tail marker'))
    expect(prompt).toContain('<score_A> LETTER_A_TO_T </score_A>')
  })
  it('emits exact progress tags', () => {
    expect(buildProgressPrompt('task', ['one', 'two'], [1, 2])).toContain('<c1>LETTER</c1>\n<c2>LETTER</c2>')
  })
})

describe('pivot tournament', () => {
  it('makes a Hamiltonian directed ring', () => {
    const pairs = ringCycle(5, 7)
    expect(pairs).toHaveLength(5)
    expect(new Set(pairs.map(pair => pair[0])).size).toBe(5)
    expect(new Set(pairs.map(pair => pair[1])).size).toBe(5)
  })
  it('generates linear pivot rounds', () => {
    expect(pivotRoundPairs(5, [1, 3])).toEqual([[0, 1], [0, 3], [2, 1], [2, 3], [4, 1], [4, 3], [1, 3]])
  })
  it('ranks soft wins', () => {
    expect(bradleyTerry(0.9, 0.1)).toBeGreaterThan(0.5)
    const rewards = new Map<string, readonly [number, number]>([['0,1', [1, 0]]])
    const wins = [0, 0]
    const counts = [0, 0]
    accumulatePairs([[0, 1]], rewards, wins, counts)
    expect(topPivots(wins, counts, 1)).toEqual([0])
    expect(rankScores(wins, counts)[0]?.index).toBe(0)
  })
})
