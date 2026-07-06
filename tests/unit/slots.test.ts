import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'

describe('generateSlots slotStepMinutes', () => {
  const timezone = 'America/Santiago'
  const baseDate = new Date('2026-05-11T04:00:00Z')
  const testNow = new Date('2026-05-10T04:00:00Z')
  const rules = [
    { dayOfWeek: 1, startTime: '08:00', endTime: '13:00', isActive: true },
  ]

  it('offers candidate starts every slotStepMinutes within each free interval', () => {
    // 08:00-13:00 Santiago, servicio 90 min, paso 30: 08:00..11:30
    const slots = generateSlots(baseDate, 90, rules, [], [], { timezone, now: testNow, slotStepMinutes: 30 })
    const starts = slots.map((s) => s.start.toISOString())
    expect(starts).toEqual([
      '2026-05-11T12:00:00.000Z', // 08:00
      '2026-05-11T12:30:00.000Z', // 08:30
      '2026-05-11T13:00:00.000Z', // 09:00
      '2026-05-11T13:30:00.000Z', // 09:30
      '2026-05-11T14:00:00.000Z', // 10:00
      '2026-05-11T14:30:00.000Z', // 10:30
      '2026-05-11T15:00:00.000Z', // 11:00
      '2026-05-11T15:30:00.000Z', // 11:30 (11:30+90 = 13:00, justo cabe)
    ])
  })

  it('re-anchors the step grid at the edge of an existing booking', () => {
    // Reserva 09:00-10:30 Santiago (13:00-14:30 UTC): el hueco 08:00-09:00 no
    // aguanta 90 min, y después de la cita la grilla parte pegada a las 10:30.
    const bookings = [
      { startDateTime: new Date('2026-05-11T13:00:00Z'), endDateTime: new Date('2026-05-11T14:30:00Z'), status: 'confirmed' },
    ]
    const slots = generateSlots(baseDate, 90, rules, [], bookings, { timezone, now: testNow, slotStepMinutes: 30 })
    const starts = slots.map((s) => s.start.toISOString())
    expect(starts).toEqual([
      '2026-05-11T14:30:00.000Z', // 10:30 (re-anclado al borde de la cita)
      '2026-05-11T15:00:00.000Z', // 11:00
      '2026-05-11T15:30:00.000Z', // 11:30
    ])
  })

  it('falls back to the service duration as step when slotStepMinutes is null', () => {
    const withNull = generateSlots(baseDate, 90, rules, [], [], { timezone, now: testNow, slotStepMinutes: null })
    const withoutOption = generateSlots(baseDate, 90, rules, [], [], { timezone, now: testNow })
    expect(withNull.map((s) => s.start.toISOString())).toEqual(withoutOption.map((s) => s.start.toISOString()))
    expect(withNull.map((s) => s.start.toISOString())).toEqual([
      '2026-05-11T12:00:00.000Z', // 08:00
      '2026-05-11T13:30:00.000Z', // 09:30
      '2026-05-11T15:00:00.000Z', // 11:00
    ])
  })
})

describe('generateSlots', () => {
  const timezone = 'America/Santiago'
  // 2026-05-11T04:00:00Z = 00:00 lunes en Santiago
  const baseDate = new Date('2026-05-11T04:00:00Z')
  // now anterior al día de test para no interferir con lead time
  const testNow = new Date('2026-05-10T04:00:00Z')

  const rules = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  ]

  it('generates slots for a normal day', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now: testNow })
    expect(slots.length).toBeGreaterThan(0)
    // 09:00 Santiago = 13:00 UTC
    expect(slots[0].start.toISOString()).toBe('2026-05-11T13:00:00.000Z')
  })

  it('respects availability rules', () => {
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now: testNow })
    const lastSlot = slots[slots.length - 1]
    // 17:00-18:00 Santiago = 21:00-22:00 UTC
    expect(lastSlot.end.toISOString()).toBe('2026-05-11T22:00:00.000Z')
  })

  it('excludes blocked time', () => {
    const blocks = [
      {
        // 12:00-13:00 Santiago = 16:00-17:00 UTC
        startDateTime: new Date('2026-05-11T16:00:00Z'),
        endDateTime: new Date('2026-05-11T17:00:00Z'),
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone, now: testNow })
    const hasSlotAt12 = slots.some((s) => s.start.toISOString() === '2026-05-11T16:00:00.000Z')
    expect(hasSlotAt12).toBe(false)
  })

  it('excludes existing bookings', () => {
    const bookings = [
      {
        // 10:00-11:00 Santiago = 14:00-15:00 UTC
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(false)
  })

  it('allows cancelled bookings to be rebooked', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'cancelled',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(true)
  })

  it('filters past slots when date is today', () => {
    // 2026-05-20T04:00:00Z = 00:00 miércoles en Santiago
    const today = new Date('2026-05-20T04:00:00Z')
    const now = new Date('2026-05-20T18:00:00Z') // 14:00 Santiago

    const localRules = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], { timezone, now })
    const hasMorningSlot = slots.some((s) => s.start.toISOString() < '2026-05-20T18:00:00.000Z')
    expect(hasMorningSlot).toBe(false)
    expect(slots.length).toBeGreaterThan(0)
  })

  it('respects timezone for dayOfWeek calculation', () => {
    // UTC Sunday 23:00 = Sunday 19:00 in America/Santiago
    const utcSundayLate = new Date('2026-05-10T23:00:00Z')
    const santiagoRules = [
      { dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true },
    ]
    const slots = generateSlots(utcSundayLate, 60, santiagoRules, [], [], { timezone: 'America/Santiago', now: testNow })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].start.toISOString()).toBe('2026-05-10T13:00:00.000Z') // 09:00 Santiago
  })

  it('uses step increment equal to durationMinutes', () => {
    const slots = generateSlots(baseDate, 90, rules, [], [], { timezone, now: testNow })
    expect(slots.length).toBe(6) // 09:00 to 16:30 = 6 slots of 90min
    expect(slots[0].start.toISOString()).toBe('2026-05-11T13:00:00.000Z')
    expect(slots[1].start.toISOString()).toBe('2026-05-11T14:30:00.000Z')
  })

  it('filters slots within leadTimeMinutes of now', () => {
    // Mismo día, now = 14:00 Santiago, leadTime = 120 min => cutoff 16:00 Santiago
    const today = new Date('2026-05-20T04:00:00Z')
    const now = new Date('2026-05-20T18:00:00Z') // 14:00 Santiago

    const localRules = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    ]

    const slots = generateSlots(today, 60, localRules, [], [], {
      timezone,
      now,
      leadTimeMinutes: 120,
    })

    // Solo 16:00 y 17:00 Santiago quedan (20:00Z y 21:00Z)
    expect(slots.length).toBe(2)
    expect(slots[0].start.toISOString()).toBe('2026-05-20T20:00:00.000Z')
    expect(slots[1].start.toISOString()).toBe('2026-05-20T21:00:00.000Z')
  })

  it('returns empty when date is outside bookingWindowDays', () => {
    const futureDate = new Date('2026-08-20T04:00:00Z') // 100+ días después de testNow
    const slots = generateSlots(futureDate, 60, rules, [], [], {
      timezone,
      now: testNow,
      bookingWindowDays: 30,
    })
    expect(slots.length).toBe(0)
  })

  it('re-anchors slots after an off-grid booking instead of losing the free space', () => {
    // Caso real (Jackeline): regla 09:00-14:30, servicio 90 min,
    // cita existente 09:45-11:15 (13:45Z-15:15Z).
    const localRules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '14:30', isActive: true },
    ]
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T13:45:00Z'),
        endDateTime: new Date('2026-05-11T15:15:00Z'),
        status: 'confirmed',
      },
    ]
    const slots = generateSlots(baseDate, 90, localRules, [], bookings, { timezone, now: testNow })
    // Antes: solo quedaba 12:00 (16:00Z). Ahora: 11:15 y 12:45, pegados a la cita.
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-05-11T15:15:00.000Z', // 11:15 Santiago
      '2026-05-11T16:45:00.000Z', // 12:45 Santiago
    ])
  })

  it('re-anchors slots after a time block', () => {
    // Regla 09:00-18:00, servicio 60, almuerzo 12:30-14:00 (16:30Z-18:00Z)
    const blocks = [
      { startDateTime: new Date('2026-05-11T16:30:00Z'), endDateTime: new Date('2026-05-11T18:00:00Z') },
    ]
    const slots = generateSlots(baseDate, 60, rules, blocks, [], { timezone, now: testNow })
    const starts = slots.map((s) => s.start.toISOString())
    // Mañana anclada a apertura: 09:00..11:00 (12:00-13:00 pisa el bloqueo)
    expect(starts).toContain('2026-05-11T13:00:00.000Z') // 09:00
    expect(starts).toContain('2026-05-11T15:00:00.000Z') // 11:00
    expect(starts).not.toContain('2026-05-11T16:00:00.000Z') // 12:00 pisa el bloqueo
    // Tarde re-anclada al fin del bloqueo: 14:00..17:00
    expect(starts).toContain('2026-05-11T18:00:00.000Z') // 14:00
    expect(starts).toContain('2026-05-11T21:00:00.000Z') // 17:00
  })

  it('excludes slots beyond bookingWindowDays even on the boundary day', () => {
    // now = domingo 10 mayo 14:00 Santiago (18:00Z); window 1 día
    // => maxStart = lunes 11 mayo 14:00 Santiago (18:00Z)
    const now = new Date('2026-05-10T18:00:00Z')
    const slots = generateSlots(baseDate, 60, rules, [], [], { timezone, now, bookingWindowDays: 1 })
    expect(slots.length).toBeGreaterThan(0)
    const lastStart = slots[slots.length - 1].start.toISOString()
    // Último slot ofrecible: 14:00 Santiago (18:00Z); antes se ofrecían hasta las 17:00
    expect(lastStart).toBe('2026-05-11T18:00:00.000Z')
  })

  it('lets a service eat into a tolerant block (caso MANICURA + almuerzo)', () => {
    // Regla 09:00-14:30, servicio 225 min, almuerzo 12:00-14:00 con tolerancia 45
    const localRules = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '14:30', isActive: true },
    ]
    const blocks = [
      {
        startDateTime: new Date('2026-05-11T16:00:00Z'), // 12:00 Santiago
        endDateTime: new Date('2026-05-11T18:00:00Z'),   // 14:00 Santiago
        overlapToleranceMinutes: 45,
      },
    ]
    // Sin tolerancia: 0 slots (09:00-12:45 pisa el almuerzo). Con 45: 09:00 existe.
    const strict = generateSlots(baseDate, 225, localRules, [{ ...blocks[0], overlapToleranceMinutes: 0 }], [], { timezone, now: testNow })
    expect(strict).toEqual([])
    const slots = generateSlots(baseDate, 225, localRules, blocks, [], { timezone, now: testNow })
    expect(slots.map((s) => s.start.toISOString())).toEqual(['2026-05-11T13:00:00.000Z'])
  })

  it('excludes expired bookings from slot generation', () => {
    const bookings = [
      {
        startDateTime: new Date('2026-05-11T14:00:00Z'),
        endDateTime: new Date('2026-05-11T15:00:00Z'),
        status: 'expired',
      },
    ]
    const slots = generateSlots(baseDate, 60, rules, [], bookings, { timezone, now: testNow })
    const hasSlotAt10 = slots.some((s) => s.start.toISOString() === '2026-05-11T14:00:00.000Z')
    expect(hasSlotAt10).toBe(true)
  })
})
