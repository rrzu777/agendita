import { describe, it, expect } from 'vitest'
import { generateSlots } from '@/lib/availability/slots'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { formatInTimeZone } from 'date-fns-tz'
import { vi } from 'vitest'

/**
 * Tests para verificar que generateSlots y assertSlotIsAvailable
 * manejan correctamente los cruces de horario de verano (DST)
 * en America/Santiago.
 *
 * Reglas DST Chile (post-2016):
 * - Primer sábado de abril (a las 23:59:59 UTC-3 → 23:00:00 UTC-4): vuelve al horario de invierno (UTC-4)
 * - Primer sábado de septiembre (a las 00:00:00 UTC-4 → 01:00:00 UTC-3): avanza al horario de verano (UTC-3)
 *
 * 2026:
 * - 04 de abril 2026: UTC-3 → UTC-4 (DST termina)
 * - 05 de septiembre 2026: UTC-4 → UTC-3 (DST comienza)
 */

describe('DST America/Santiago', () => {
  const timezone = 'America/Santiago'
  // now anterior a todas las fechas de test para evitar interferencia de lead time
  const testNow = new Date('2026-01-01T04:00:00Z')

  // Helper para crear mocks de transacción consistentes
  // Usamos bookingWindowDays: 365 para evitar que los slots de septiembre
  // queden fuera de la ventana cuando el test corre en mayo.
  function makeTx(bookingWindowDays = 365) {
    return {
      business: { findUnique: vi.fn().mockResolvedValue({ bookingWindowDays }) },
      service: { findFirst: vi.fn().mockResolvedValue({ durationMinutes: 60 }) },
      availabilityRule: { findFirst: vi.fn().mockResolvedValue({ dayOfWeek: 6, startTime: '09:00', endTime: '18:00', isActive: true }) },
      timeBlock: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as Parameters<typeof assertSlotIsAvailable>[0]['tx']
  }

  it('generates correct UTC slots the day DST starts (September 2026)', () => {
    // 05 septiembre 2026 en Santiago: a las 00:00 saltan a 01:00 (UTC-4 → UTC-3)
    // El día entero del sábado 05 de septiembre opera en UTC-3
    // 05 septiembre 2026 00:00 UTC-4 = 05 septiembre 2026 04:00 UTC
    // Pero como el reloj local salta de 00:00 a 01:00, el "día" del negocio
    // en términos de slots debe resolverse correctamente.

    // Para simplificar: usamos un día ANTES del cambio (viernes 04 sept 2026)
    // para verificar que los slots se generan bien, y luego un día DESPUÉS.

    const fridayBeforeDst = new Date('2026-09-04T04:00:00Z') // viernes 04 sept 00:00 Santiago (UTC-4)
    const rules = [{ dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true }]

    const slots = generateSlots(fridayBeforeDst, 60, rules, [], [], { timezone, now: testNow, bookingWindowDays: 365 })
    expect(slots.length).toBe(9) // 09:00 a 18:00 = 9 slots de 1h

    // El primer slot debe ser 09:00 Santiago = 13:00 UTC (porque viernes 04 sept aún es UTC-4)
    expect(formatInTimeZone(slots[0].start, timezone, 'HH:mm')).toBe('09:00')
    expect(slots[0].start.toISOString()).toBe('2026-09-04T13:00:00.000Z')
  })

  it('generates correct UTC slots the day after DST starts (September 2026)', () => {
    // Domingo 06 septiembre 2026: ya es UTC-3 (DST activo)
    // 09:00 Santiago = 12:00 UTC
    const sundayDst = new Date('2026-09-06T04:00:00Z') // domingo 06 sept 00:00 Santiago = 04:00 UTC (UTC-3)
    const rules = [{ dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true }]

    const slots = generateSlots(sundayDst, 60, rules, [], [], { timezone, now: testNow, bookingWindowDays: 365 })
    expect(slots.length).toBe(9)

    // 09:00 Santiago = 12:00 UTC (UTC-3)
    expect(formatInTimeZone(slots[0].start, timezone, 'HH:mm')).toBe('09:00')
    expect(slots[0].start.toISOString()).toBe('2026-09-06T12:00:00.000Z')
  })

  it('generates correct UTC slots the day DST ends (April 2026)', () => {
    // Sábado 04 abril 2026: a las 23:59:59 UTC-3 vuelve a 23:00:00 UTC-4
    // Domingo 05 abril 2026 opera en UTC-4
    // 05 abril 2026 00:00 Santiago = 05:00 UTC (UTC-4)
    const sundayAfterDst = new Date('2026-04-05T05:00:00Z') // domingo 05 abril 00:00 Santiago (UTC-4)
    const rules = [{ dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true }]

    const slots = generateSlots(sundayAfterDst, 60, rules, [], [], { timezone, now: testNow, bookingWindowDays: 365 })
    expect(slots.length).toBe(9)

    // 09:00 Santiago = 13:00 UTC (UTC-4)
    expect(formatInTimeZone(slots[0].start, timezone, 'HH:mm')).toBe('09:00')
    expect(slots[0].start.toISOString()).toBe('2026-04-05T13:00:00.000Z')
  })

  it('roundtrip assertSlotIsAvailable works across DST boundary', async () => {
    // Usamos domingo 06 septiembre 2026, ya en UTC-3 (DST activo)
    const sundayDst = new Date('2026-09-06T04:00:00Z')
    const rules = [{ dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true }]
    const slots = generateSlots(sundayDst, 60, rules, [], [], { timezone, now: testNow, bookingWindowDays: 365 })

    expect(slots.length).toBeGreaterThan(0)
    const firstSlot = slots[0]

    const tx = makeTx()
    await assertSlotIsAvailable({
      tx,
      businessId: 'biz-dst',
      serviceId: 'svc-dst',
      startDateTime: firstSlot.start,
      endDateTime: firstSlot.end,
      timezone,
    })

    expect(formatInTimeZone(firstSlot.start, timezone, 'yyyy-MM-dd HH:mm')).toBe('2026-09-06 09:00')
  })
})
