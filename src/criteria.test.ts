import { describe, expect, it } from 'vitest'
import { CRITERIA_PRESETS, DEFAULT_CRITERIA } from './core.ts'
import { CriteriaResolver } from './criteria.ts'

const FILE = ['# Rubric', '## Ground Truth Note', '', 'Trust raw output only.', '', '## Criteria', '', '### Alpha', '', 'Judge alpha carefully.', '', '### Beta {#b2}', '', 'Judge beta carefully.', ''].join('\n')

describe('CriteriaResolver', () => {
  it('returns the bundled preset by reference, so switching presets changes the rubric', async () => {
    const resolver = new CriteriaResolver()
    const coding = await resolver.resolve('coding', undefined)
    expect(coding.criteria).toBe(DEFAULT_CRITERIA)
    expect(coding.source).toBe('coding')
    const research = await resolver.resolve('research', undefined)
    expect(research.criteria).toBe(CRITERIA_PRESETS.research)
    expect(research.error).toBeUndefined()
  })

  it('reads a custom markdown file and carries its ground-truth note', async () => {
    const resolver = new CriteriaResolver(async () => FILE)
    const resolved = await resolver.resolve('custom', 'rubric.md')
    expect(resolved.source).toBe('custom')
    expect(resolved.groundTruthNote).toBe('Trust raw output only.')
    expect(resolved.criteria.map(criterion => criterion.id)).toEqual(['alpha', 'b2'])
  })

  it('falls back to the coding rubric instead of failing the gate when the file is unusable', async () => {
    const missing = new CriteriaResolver(async () => { throw new Error('ENOENT: no such file') })
    const resolved = await missing.resolve('custom', 'nope.md')
    expect(resolved.source).toBe('fallback')
    expect(resolved.criteria).toBe(DEFAULT_CRITERIA)
    expect(resolved.error).toMatch(/ENOENT/u)
    expect(resolved.file).toBe('nope.md')

    const unparsable = new CriteriaResolver(async () => '# no criteria in here')
    const broken = await unparsable.resolve('custom', 'broken.md')
    expect(broken.source).toBe('fallback')
    expect(broken.error).toMatch(/no criteria/u)
  })

  it('reports a missing file path rather than reading an empty one', async () => {
    const resolver = new CriteriaResolver(async () => FILE)
    const resolved = await resolver.resolve('custom', '   ')
    expect(resolved.source).toBe('fallback')
    expect(resolved.error).toMatch(/no criteria file configured/u)
  })

  it('re-reads an edited file, and caches an unchanged one', async () => {
    let text = FILE
    let reads = 0
    const resolver = new CriteriaResolver(async () => { reads += 1; return text })
    const first = await resolver.resolve('custom', 'rubric.md')
    expect(first.criteria.map(criterion => criterion.id)).toEqual(['alpha', 'b2'])
    // Same content: the parse is reused, but the file is re-read so an edit is never missed.
    await resolver.resolve('custom', 'rubric.md')
    expect(reads).toBe(2)
    text = FILE.replace('### Alpha', '### Gamma')
    const third = await resolver.resolve('custom', 'rubric.md')
    expect(third.criteria.map(criterion => criterion.id)).toEqual(['gamma', 'b2'])
  })
})
