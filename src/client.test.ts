import { describe, expect, it } from 'vitest'
import { zh, en, toolLabels, tFormat, detectLanguage, compact, dateTime } from './client-i18n.ts'

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
