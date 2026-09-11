import { describe, expect, it } from 'vitest'
import { zh, en, toolLabels, tFormat, detectLanguage, compact, dateTime } from './client-i18n.ts'
import {
  type ExtraJudgeDraft,
  MAX_EXTRA_JUDGES,
  normalizeExtraJudges,
  judgeIdentity,
  judgeConflict,
  addExtraJudge,
  removeExtraJudge,
  serializeExtraJudges,
} from './client-judges.ts'

describe('client i18n dictionaries', () => {
  it('has identical keys for zh and en dictionaries', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(zhKeys).toEqual(enKeys)
    expect(zhKeys.length).toBeGreaterThan(30)
  })

  it('contains non-empty strings for all dictionary entries', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(typeof value, `zh key ${key}`).toBe('string')
      expect(value.trim().length, `zh key ${key}`).toBeGreaterThan(0)
    }
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, `en key ${key}`).toBe('string')
      expect(value.trim().length, `en key ${key}`).toBeGreaterThan(0)
    }
  })

  it('covers all core verifier tools in toolLabels for both zh and en', () => {
    const expectedTools = [
      'verifier_route_classify',
      'verifier_compare',
      'verifier_select',
      'verifier_track',
      'verifier_current_session',
    ]

    for (const tool of expectedTools) {
      expect(toolLabels.zh[tool], `zh label for ${tool}`).toBeDefined()
      expect(toolLabels.zh[tool]!.trim().length).toBeGreaterThan(0)
      expect(toolLabels.en[tool], `en label for ${tool}`).toBeDefined()
      expect(toolLabels.en[tool]!.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('client i18n helper functions', () => {
  it('tFormat interpolates parameters correctly', () => {
    const template = 'Updated at {time} · Found {count} items for {days} days'
    expect(tFormat(template, { time: '12:00', count: 5, days: 30 })).toBe('Updated at 12:00 · Found 5 items for 30 days')
    expect(tFormat('No placeholders', {})).toBe('No placeholders')
    expect(tFormat('No placeholders')).toBe('No placeholders')
  })

  it('detectLanguage respects document.documentElement.lang', () => {
    // In node/vitest environment where document is not defined by default or mocked
    if (typeof document !== 'undefined') {
      const originalLang = document.documentElement.lang
      try {
        document.documentElement.lang = 'zh-CN'
        expect(detectLanguage()).toBe('zh')
        document.documentElement.lang = 'zh'
        expect(detectLanguage()).toBe('zh')
        document.documentElement.lang = 'zh-TW'
        expect(detectLanguage()).toBe('zh')
        document.documentElement.lang = 'en'
        expect(detectLanguage()).toBe('en')
        document.documentElement.lang = 'en-US'
        expect(detectLanguage()).toBe('en')
        document.documentElement.lang = 'ja'
        expect(detectLanguage()).toBe('en')
        document.documentElement.lang = ''
        expect(detectLanguage()).toBe('en')
      } finally {
        document.documentElement.lang = originalLang
      }
    } else {
      expect(detectLanguage()).toBe('en')
    }
  })

  it('formats compact numbers localized by language', () => {
    expect(compact(500, 'zh')).toBe('500')
    expect(compact(500, 'en')).toBe('500')
    expect(compact(12345, 'zh')).toBe('1.2万')
    expect(compact(12345, 'en')).toBe('12.3K')
  })

  it('formats dateTime correctly for both languages', () => {
    const timestamp = new Date('2026-08-31T14:30:00Z').getTime()
    const formattedZh = dateTime(timestamp, 'zh')
    const formattedEn = dateTime(timestamp, 'en')
    expect(formattedZh).toBeTruthy()
    expect(formattedEn).toBeTruthy()
  })
})

describe('client-judges helpers', () => {
  describe('normalizeExtraJudges', () => {
    it('returns empty array for absent, null, or garbage input', () => {
      expect(normalizeExtraJudges(undefined)).toEqual([])
      expect(normalizeExtraJudges(null)).toEqual([])
      expect(normalizeExtraJudges('garbage')).toEqual([])
      expect(normalizeExtraJudges(123)).toEqual([])
      expect(normalizeExtraJudges({})).toEqual([])
      expect(normalizeExtraJudges([null, undefined, 42, 'string', true, {}])).toEqual([])
      expect(normalizeExtraJudges([{ provider: 'only-provider' }])).toEqual([])
      expect(normalizeExtraJudges([{ model: 'only-model' }])).toEqual([])
      expect(normalizeExtraJudges([{ provider: '', model: 'm' }])).toEqual([])
      expect(normalizeExtraJudges([{ provider: 'p', model: '  ' }])).toEqual([])
      expect(normalizeExtraJudges([{ provider: 123, model: 'm' }])).toEqual([])
      expect(normalizeExtraJudges([{ provider: 'p', model: {} }])).toEqual([])
    })

    it('caps entries at MAX_EXTRA_JUDGES (4)', () => {
      const input = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
        { provider: 'p4', model: 'm4' },
        { provider: 'p5', model: 'm5' },
        { provider: 'p6', model: 'm6' },
      ]
      const result = normalizeExtraJudges(input)
      expect(result).toHaveLength(MAX_EXTRA_JUDGES)
      expect(result.map(j => j.provider)).toEqual(['p1', 'p2', 'p3', 'p4'])
    })

    it('trims strings and omits empty or non-string optional fields', () => {
      const input = [
        {
          provider: '  openai  ',
          model: '  gpt-4o  ',
          reasoningEffort: '   ',
          label: '',
        },
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: ' high ',
          label: ' Backup Judge ',
        },
        {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          reasoningEffort: 123,
          label: null,
        },
      ]
      const result = normalizeExtraJudges(input)
      expect(result).toHaveLength(3)

      expect(result[0]).toEqual({
        provider: 'openai',
        model: 'gpt-4o',
      })
      expect('reasoningEffort' in result[0]).toBe(false)
      expect('label' in result[0]).toBe(false)

      expect(result[1]).toEqual({
        provider: 'deepseek',
        model: 'deepseek-chat',
        reasoningEffort: 'high',
        label: 'Backup Judge',
      })

      expect(result[2]).toEqual({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      })
      expect('reasoningEffort' in result[2]).toBe(false)
      expect('label' in result[2]).toBe(false)
    })
  })

  describe('judgeIdentity', () => {
    it('formats provider and model identity, trimming whitespace', () => {
      expect(judgeIdentity('openai', 'gpt-4o')).toBe('openai/gpt-4o')
      expect(judgeIdentity('  deepseek ', ' deepseek-reasoner ')).toBe('deepseek/deepseek-reasoner')
    })
  })

  describe('judgeConflict', () => {
    const primary = { provider: 'openai', model: 'gpt-4o' }

    it('detects duplicate of primary judge at index 0', () => {
      const judges: ExtraJudgeDraft[] = [
        { provider: 'openai', model: 'gpt-4o' },
      ]
      expect(judgeConflict(primary, judges)).toEqual({ index: 0, duplicateOf: 'primary' })
    })

    it('detects duplicate of primary judge with untrimmed strings', () => {
      const judges: ExtraJudgeDraft[] = [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: '  openai ', model: ' gpt-4o  ' },
      ]
      expect(judgeConflict(primary, judges)).toEqual({ index: 1, duplicateOf: 'primary' })
    })

    it('detects duplicate among extra judges (first duplicate wins)', () => {
      const judges: ExtraJudgeDraft[] = [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: 'anthropic', model: 'claude-3-5-sonnet' },
        { provider: 'deepseek', model: 'deepseek-chat' },
      ]
      expect(judgeConflict(primary, judges)).toEqual({ index: 2, duplicateOf: 0 })
    })

    it('prioritizes primary duplicate over subsequent duplicate', () => {
      const judges: ExtraJudgeDraft[] = [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'openai', model: 'gpt-4o' },
      ]
      expect(judgeConflict(primary, judges)).toEqual({ index: 0, duplicateOf: 'primary' })
    })

    it('returns undefined when there are no duplicates', () => {
      const judges: ExtraJudgeDraft[] = [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: 'anthropic', model: 'claude-3-5-sonnet' },
      ]
      expect(judgeConflict(primary, judges)).toBeUndefined()
      expect(judgeConflict(primary, [])).toBeUndefined()
    })
  })

  describe('addExtraJudge and removeExtraJudge', () => {
    it('adds a judge when below cap', () => {
      const initial: ExtraJudgeDraft[] = [{ provider: 'p1', model: 'm1' }]
      const next = addExtraJudge(initial, { provider: ' p2 ', model: ' m2 ', reasoningEffort: ' medium ' })
      expect(next).toHaveLength(2)
      expect(next[1]).toEqual({ provider: 'p2', model: 'm2', reasoningEffort: 'medium' })
    })

    it('is a no-op when adding past MAX_EXTRA_JUDGES (4)', () => {
      const initial: ExtraJudgeDraft[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
        { provider: 'p4', model: 'm4' },
      ]
      const next = addExtraJudge(initial, { provider: 'p5', model: 'm5' })
      expect(next).toHaveLength(MAX_EXTRA_JUDGES)
      expect(next).toEqual(initial)
    })

    it('removes judge by index', () => {
      const initial: ExtraJudgeDraft[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
      ]
      const removed = removeExtraJudge(initial, 1)
      expect(removed).toHaveLength(2)
      expect(removed.map(j => j.provider)).toEqual(['p1', 'p3'])
    })

    it('returns copy for invalid remove indices', () => {
      const initial: ExtraJudgeDraft[] = [{ provider: 'p1', model: 'm1' }]
      expect(removeExtraJudge(initial, -1)).toEqual(initial)
      expect(removeExtraJudge(initial, 5)).toEqual(initial)
    })
  })

  describe('serializeExtraJudges', () => {
    it('always includes provider and model, trimming whitespace', () => {
      const input: ExtraJudgeDraft[] = [
        { provider: '  openai ', model: ' gpt-4o ' },
      ]
      expect(serializeExtraJudges(input)).toEqual([
        { provider: 'openai', model: 'gpt-4o' },
      ])
    })

    it('omits empty optional keys and asserts reasoningEffort is not in entry', () => {
      const input: ExtraJudgeDraft[] = [
        { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: '', label: '' },
        { provider: 'openai', model: 'gpt-4o' },
      ]
      const serialized = serializeExtraJudges(input)
      expect(serialized).toHaveLength(2)

      expect(serialized[0]).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
      expect('reasoningEffort' in serialized[0]).toBe(false)
      expect('label' in serialized[0]).toBe(false)

      expect(serialized[1]).toEqual({ provider: 'openai', model: 'gpt-4o' })
      expect('reasoningEffort' in serialized[1]).toBe(false)
      expect('label' in serialized[1]).toBe(false)
    })

    it('includes non-empty optional keys and never produces undefined', () => {
      const input: ExtraJudgeDraft[] = [
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: ' high ',
          label: ' Panel 1 ',
        },
      ]
      const serialized = serializeExtraJudges(input)
      expect(serialized[0]).toEqual({
        provider: 'deepseek',
        model: 'deepseek-chat',
        reasoningEffort: 'high',
        label: 'Panel 1',
      })
      for (const val of Object.values(serialized[0])) {
        expect(val).toBeDefined()
        expect(typeof val).toBe('string')
      }
    })

    it('caps serialized output at MAX_EXTRA_JUDGES (4)', () => {
      const input: ExtraJudgeDraft[] = [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
        { provider: 'p4', model: 'm4' },
        { provider: 'p5', model: 'm5' },
      ]
      expect(serializeExtraJudges(input)).toHaveLength(MAX_EXTRA_JUDGES)
    })
  })
})

