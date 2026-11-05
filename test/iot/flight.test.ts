import { describe, expect, it } from 'vitest'
import { IOT_MAX_SESSIONS, IOT_THINKING_TTL_MS, IoTFlights } from '../../src/iot/index.ts'

describe('IoTFlights', () => {
  it('reports the hold start until it is ended', () => {
    const flights = new IoTFlights()
    expect(flights.held('s-1', 1_000)).toBeUndefined()
    flights.begin('s-1', 1_000)
    expect(flights.held('s-1', 1_000)).toBe(1_000)
    expect(flights.held('s-1', 5_000)).toBe(1_000)
    flights.end('s-1')
    expect(flights.held('s-1', 5_001)).toBeUndefined()
    expect(flights.size).toBe(0)
  })

  it('ends idempotently, so every release path can call it unconditionally', () => {
    const flights = new IoTFlights()
    flights.begin('s-1', 10)
    flights.end('s-1')
    flights.end('s-1')
    expect(flights.held('s-1', 11)).toBeUndefined()
    expect(flights.size).toBe(0)
  })

  it('treats a record past the leak bound as gone, on the boundary itself', () => {
    const flights = new IoTFlights()
    flights.begin('s-1', 1_000)
    // The bound is exclusive: exactly TTL is still a live hold, one millisecond more is a leak.
    expect(flights.held('s-1', 1_000 + IOT_THINKING_TTL_MS)).toBe(1_000)
    expect(flights.held('s-1', 1_001 + IOT_THINKING_TTL_MS)).toBeUndefined()
    // The leak is forgotten, not merely hidden: a later read cannot resurrect it.
    expect(flights.held('s-1', 1_002)).toBeUndefined()
    expect(flights.size).toBe(0)
  })

  it('bounds the table and evicts the least recently started session', () => {
    const flights = new IoTFlights(2)
    flights.begin('s-1', 10)
    flights.begin('s-2', 20)
    // A fresh hold on s-1 makes s-2 the oldest.
    flights.begin('s-1', 30)
    flights.begin('s-3', 40)
    expect(flights.size).toBe(2)
    expect(flights.held('s-2', 41)).toBeUndefined()
    expect(flights.held('s-1', 41)).toBe(30)
    expect(flights.held('s-3', 41)).toBe(40)
  })

  it('retains the default number of sessions and no more', () => {
    const flights = new IoTFlights()
    for (let at = 0; at < IOT_MAX_SESSIONS; at += 1) flights.begin('s-' + at, at)
    expect(flights.size).toBe(IOT_MAX_SESSIONS)
    flights.begin('s-extra', 999)
    expect(flights.size).toBe(IOT_MAX_SESSIONS)
    expect(flights.held('s-0', 1_000)).toBeUndefined()
    expect(flights.held('s-extra', 1_000)).toBe(999)
  })

  it('clears one session entirely', () => {
    const flights = new IoTFlights()
    flights.begin('s-1', 10)
    flights.begin('s-2', 10)
    flights.clear('s-1')
    expect(flights.held('s-1', 11)).toBeUndefined()
    expect(flights.held('s-2', 11)).toBe(10)
    expect(flights.size).toBe(1)
  })

  it('refuses a non-positive limit', () => {
    expect(() => new IoTFlights(0)).toThrow(/positive integer/)
    expect(() => new IoTFlights(1.5)).toThrow(/positive integer/)
  })
})
