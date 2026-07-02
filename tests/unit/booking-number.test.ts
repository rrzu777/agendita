import { describe, it, expect, vi } from 'vitest'
import { assignBookingNumber, formatBookingNumber, randomBookingNumberBase } from '@/lib/bookings/number'

describe('formatBookingNumber', () => {
  it('renders #<number> when present', () => {
    expect(formatBookingNumber(4738, 'clabc12345')).toBe('#4738')
  })
  it('falls back to the cuid slice when null', () => {
    expect(formatBookingNumber(null, 'clabc12345')).toBe('#clabc123')
  })
  it('falls back when undefined', () => {
    expect(formatBookingNumber(undefined, 'clabc12345')).toBe('#clabc123')
  })
})

describe('randomBookingNumberBase', () => {
  it('is within [1000, 9999]', () => {
    for (let i = 0; i < 100; i++) {
      const b = randomBookingNumberBase()
      expect(b).toBeGreaterThanOrEqual(1000)
      expect(b).toBeLessThanOrEqual(9999)
    }
  })
})

describe('assignBookingNumber', () => {
  it('atomically increments seq by a step in [2,9] and returns the new value', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1042 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const result = await assignBookingNumber(tx, 'biz1')
    expect(result).toBe(1042)
    const arg = update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'biz1' })
    expect(arg.select).toEqual({ bookingNumberSeq: true })
    const step = arg.data.bookingNumberSeq.increment
    expect(step).toBeGreaterThanOrEqual(2)
    expect(step).toBeLessThanOrEqual(9)
  })
  it('uses a variety of steps across many calls', async () => {
    const update = vi.fn().mockResolvedValue({ bookingNumberSeq: 1 })
    const tx = { business: { update } } as unknown as Parameters<typeof assignBookingNumber>[0]
    const steps = new Set<number>()
    for (let i = 0; i < 50; i++) {
      await assignBookingNumber(tx, 'b')
      steps.add(update.mock.calls[i][0].data.bookingNumberSeq.increment)
    }
    expect(steps.size).toBeGreaterThan(1)
  })
})
