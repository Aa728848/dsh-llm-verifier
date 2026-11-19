import { describe, expect, it } from 'vitest'
import { IOT_MAX_CHARS, IOT_MIN_CHARS, IOT_SEGMENT_CHARS, IoTSegmenter, ioTWasteRatio, isIoTWasteCandidate } from '../../src/iot/index.ts'

const repeated = 'I will inspect the parser and the failing fixture first; '.repeat(100)
const coherent = Array.from({ length: 100 }, (_, i) => 'Step ' + i + ' reads fixture-' + i + ' and records observation-' + i + '.').join(' ')

describe('waste detection', () => {
  it('marks highly repetitive text but not a coherent trace with distinct evidence', () => {
    expect(ioTWasteRatio(repeated)).toBeGreaterThanOrEqual(0.5)
    expect(isIoTWasteCandidate(repeated)).toBe(true)
    expect(ioTWasteRatio(coherent)).toBeLessThan(0.5)
    expect(isIoTWasteCandidate(coherent)).toBe(false)
  })

  it('keeps the minimum and prompt-cap boundaries explicit', () => {
    expect(isIoTWasteCandidate(repeated.slice(0, IOT_MIN_CHARS - 1))).toBe(false)
    expect(isIoTWasteCandidate(repeated.slice(0, IOT_MIN_CHARS))).toBe(true)
    expect(isIoTWasteCandidate(repeated.slice(0, IOT_MAX_CHARS))).toBe(true)
  })
})

describe('IoTSegmenter', () => {
  it('streams a complete normal segment before block-end and preserves exact offsets', () => {
    const first = coherent.slice(0, IOT_SEGMENT_CHARS)
    const second = repeated.slice(0, IOT_SEGMENT_CHARS)
    const segmenter = new IoTSegmenter()
    const ready = segmenter.push(first + second)
    expect(ready).toHaveLength(2)
    expect(ready[0]).toEqual({ start: 0, text: first, waste: false })
    expect(ready[1]).toEqual({ start: IOT_SEGMENT_CHARS, text: second, waste: true })
    expect(segmenter.pendingText).toBe('')
  })

  it('uses paragraph boundaries after the minimum and relays an unterminated remainder verbatim', () => {
    const segmenter = new IoTSegmenter()
    const paragraph = coherent.slice(0, IOT_MIN_CHARS) + '\n\n'
    expect(segmenter.push(paragraph + 'tail')[0]?.text).toBe(paragraph)
    expect(segmenter.takePending()).toBe('tail')
    expect(segmenter.finish()).toEqual([])
  })

  it('drains a short final segment only at block-end', () => {
    const segmenter = new IoTSegmenter()
    expect(segmenter.push(repeated.slice(0, IOT_MIN_CHARS))).toEqual([])
    expect(segmenter.finish()).toEqual([{ start: 0, text: repeated.slice(0, IOT_MIN_CHARS), waste: true }])
  })
})
