import { describe, expect, it } from 'vitest'
import { normalizeServiceSelection, resolveSelectedServices } from '@/lib/bookings/selection'
import { allocateLineDiscount, bookingServiceName, bookingDurationMinutes, snapshotServiceLines } from '@/lib/bookings/service-lines'

const services = [
  { id: 'cut', businessId: 'salon', isActive: true, name: 'Corte', price: 15000, depositAmount: 5000, durationMinutes: 45, modalities: ['on_site' as const] },
  { id: 'nose', businessId: 'salon', isActive: true, name: 'Depilación nasal', price: 4000, depositAmount: 1000, durationMinutes: 20, modalities: ['on_site' as const, 'at_home' as const] },
]

describe('bounded service selection', () => {
  it('accepts legacy input and preserves explicit service order', () => {
    expect(normalizeServiceSelection({ serviceId: 'cut' })).toEqual(['cut'])
    expect(normalizeServiceSelection({ serviceIds: ['nose', 'cut'] })).toEqual(['nose', 'cut'])
    expect(normalizeServiceSelection({ serviceId: 'nose', serviceIds: ['nose', 'cut'] })).toEqual(['nose', 'cut'])
  })
  it.each([
    {}, { serviceIds: [] }, { serviceIds: ['cut', 'cut'] },
    { serviceId: 'cut', serviceIds: ['nose', 'cut'] },
    { serviceIds: Array.from({ length: 11 }, (_, i) => `s${i}`) },
    { serviceIds: [' '] }, { serviceIds: ['x'.repeat(129)] },
  ])('rejects invalid or contradictory payload %j', (input) => {
    expect(() => normalizeServiceSelection(input)).toThrow()
  })
  it('resolves authoritative ordered services, common modality and totals', () => {
    const result = resolveSelectedServices('salon', ['cut', 'nose'], [...services].reverse())
    expect(result.services.map(s => s.id)).toEqual(['cut', 'nose'])
    expect(result).toMatchObject({ durationMinutes: 65, totalPrice: 19000, depositRequired: 6000, modalities: ['on_site'] })
  })
  it('accepts the PostgreSQL Int boundary but rejects aggregate overflow', () => {
    expect(resolveSelectedServices('salon', ['cut'], [{ ...services[0], price: 2147483647 }]).totalPrice).toBe(2147483647)
    expect(() => resolveSelectedServices('salon', ['cut', 'nose'], [{ ...services[0], price: 2147483647 }, services[1]])).toThrow()
  })
  it.each([
    [services[0]],
    [services[0], { ...services[1], businessId: 'other' }],
    [services[0], { ...services[1], isActive: false }],
    [services[0], { ...services[1], modalities: ['online' as const] }],
  ])('rejects unavailable services and incompatible modalities', (...rows) => {
    expect(() => resolveSelectedServices('salon', ['cut', 'nose'], rows)).toThrow()
  })
})

describe('immutable service line amounts', () => {
  it('snapshots independent names and sums integer amounts', () => {
    const lines = snapshotServiceLines(services)
    expect(lines.map(l => l.position)).toEqual([0, 1])
    expect(lines.reduce((sum, l) => sum + l.finalAmount, 0)).toBe(19000)
    expect(lines.reduce((sum, l) => sum + l.durationMinutes, 0)).toBe(65)
    expect(lines[0]).toMatchObject({ serviceId: 'cut', name: 'Corte', price: 15000, discountAmount: 0, finalAmount: 15000 })
  })
  it('allocates only across eligible lines, with deterministic integer remainder', () => {
    const lines = snapshotServiceLines(services)
    const result = allocateLineDiscount(lines, 999, ['nose'])
    expect(result.map(l => l.discountAmount)).toEqual([0, 999])
    const split = allocateLineDiscount(lines, 1, ['cut', 'nose'])
    expect(split.map(l => l.discountAmount)).toEqual([1, 0])
    expect(split.reduce((sum, l) => sum + l.finalAmount, 0)).toBe(18999)
    expect(lines.every(l => l.discountAmount === 0)).toBe(true)
  })
  it('caps each deposit to that line remaining amount, never another service', () => {
    const result = allocateLineDiscount(snapshotServiceLines(services), 15000, ['cut'])
    expect(result.map(l => l.depositAmount)).toEqual([0, 1000])
    expect(result.reduce((sum, l) => sum + l.finalAmount, 0)).toBe(4000)
  })
  it.each([-1, 0.5, 19001, Number.NaN])('rejects invalid discounts %s', amount => {
    expect(() => allocateLineDiscount(snapshotServiceLines(services), amount, ['cut', 'nose'])).toThrow()
  })
  it('rejects a discount larger than the eligible base', () => {
    expect(() => allocateLineDiscount(snapshotServiceLines(services), 4001, ['nose'])).toThrow()
  })
  it('breaks remainder ties by line order and never allocates to a free line', () => {
    const lines = snapshotServiceLines([
      { ...services[0], price: 10, depositAmount: 0 },
      { ...services[1], price: 10, depositAmount: 0 },
      { ...services[1], id: 'free', price: 0, depositAmount: 0 },
    ])
    expect(allocateLineDiscount(lines, 1, ['cut', 'nose', 'free']).map(l => l.discountAmount)).toEqual([1, 0, 0])
    expect(allocateLineDiscount(lines, 0, ['free']).map(l => l.discountAmount)).toEqual([0, 0, 0])
  })
  it('preserves exact integer allocations when the weighted product exceeds safe Number range', () => {
    const lines = snapshotServiceLines([
      { ...services[0], price: 1073741824, depositAmount: 0 },
      { ...services[1], price: 1073741823, depositAmount: 0 },
    ])
    const split = allocateLineDiscount(lines, 2147483646, ['cut', 'nose'])
    expect(split.map(l => l.discountAmount)).toEqual([1073741823, 1073741823])
    expect(split.reduce((sum, l) => sum + l.finalAmount, 0)).toBe(1)
  })
  it('uses snapshot names when present and legacy name otherwise', () => {
    expect(bookingServiceName({ service: { name: 'Renamed' }, serviceLines: snapshotServiceLines(services).reverse() })).toBe('Corte + Depilación nasal')
    expect(bookingServiceName({ service: { name: 'Legacy' } })).toBe('Legacy')
    expect(bookingServiceName({ service: { name: 'Legacy' }, serviceLines: [] })).toBe('Legacy')
  })
  it('reschedules the persisted interval, not the current catalogue duration', () => {
    expect(bookingDurationMinutes({ startDateTime: new Date('2026-09-14T13:00:00Z'), endDateTime: new Date('2026-09-14T14:05:00Z') })).toBe(65)
  })
})
