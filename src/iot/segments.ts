/**
 * Split one reasoning block into ordered, byte-preserving segments and mark only highly repetitive
 * ones for compaction. Offsets refer to the original block so a replacement never rewrites the
 * untouched prefix or suffix.
 */
import { IOT_MAX_CHARS, IOT_MIN_CHARS } from './mode.ts'

/** Largest segment produced during streaming; the final segment may be shorter. */
export const IOT_SEGMENT_CHARS = 2_000
/** Maximum original text queued behind an in-flight replacement before it is abandoned. */
export const IOT_MAX_PENDING_CHARS = 24_000
/** Repetition required before a segment is worth an auxiliary call. */
export const IOT_WASTE_RATIO = 0.5

export interface IoTSegment {
  readonly start: number
  readonly text: string
  readonly waste: boolean
}

/** Exact repeated sentences and fixed-width shingles, both computed on a normalized copy only. */
export function ioTWasteRatio(text: string): number {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length < IOT_MIN_CHARS) return 0
  const units = normalized.split(/(?<=[.!?。！？;；])\s+/u).map(unit => unit.trim()).filter(unit => unit.length >= 24)
  const seenUnits = new Set<string>()
  let repeatedChars = 0
  for (const unit of units) {
    if (seenUnits.has(unit)) repeatedChars += unit.length
    else seenUnits.add(unit)
  }
  const unitRatio = repeatedChars / normalized.length
  const width = 96
  const step = 48
  if (normalized.length < width * 2) return unitRatio
  const seen = new Set<string>()
  let total = 0
  let repeated = 0
  for (let at = 0; at + width <= normalized.length; at += step) {
    const shingle = normalized.slice(at, at + width)
    total += 1
    if (seen.has(shingle)) repeated += 1
    else seen.add(shingle)
  }
  return Math.max(unitRatio, total === 0 ? 0 : repeated / total)
}

/** Whether this complete segment is a bounded, high-waste compaction candidate. */
export function isIoTWasteCandidate(text: string): boolean {
  return text.length >= IOT_MIN_CHARS && text.length <= IOT_MAX_CHARS && ioTWasteRatio(text) >= IOT_WASTE_RATIO
}

/** A small look-ahead buffer; normal paragraphs stream without waiting for the block to finish. */
export class IoTSegmenter {
  private pending = ''
  private offset = 0

  get pendingText(): string { return this.pending }

  push(text: string): IoTSegment[] {
    this.pending += text
    return this.drain(false)
  }

  finish(): IoTSegment[] { return this.drain(true) }

  /** Relay an unterminated block without classifying it or starting another call. */
  takePending(): string {
    const text = this.pending
    this.offset += text.length
    this.pending = ''
    return text
  }

  private drain(final: boolean): IoTSegment[] {
    const segments: IoTSegment[] = []
    while (this.pending.length > 0) {
      const cut = this.cut(final)
      if (cut === 0) break
      const text = this.pending.slice(0, cut)
      segments.push({ start: this.offset, text, waste: isIoTWasteCandidate(text) })
      this.offset += cut
      this.pending = this.pending.slice(cut)
    }
    return segments
  }

  private cut(final: boolean): number {
    const limit = Math.min(this.pending.length, IOT_SEGMENT_CHARS)
    let paragraph = 0
    for (let at = this.pending.indexOf('\n\n'); at >= 0 && at + 2 <= limit; at = this.pending.indexOf('\n\n', at + 2)) {
      if (at + 2 >= IOT_MIN_CHARS) paragraph = at + 2
    }
    if (paragraph > 0) return paragraph
    if (this.pending.length >= IOT_SEGMENT_CHARS) return IOT_SEGMENT_CHARS
    return final ? this.pending.length : 0
  }
}
