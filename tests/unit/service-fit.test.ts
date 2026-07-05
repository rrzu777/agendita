import { describe, it, expect } from 'vitest'
import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { computeServiceFit } from '@/lib/availability/service-fit'
import type { AvailabilityRuleLike } from '@/lib/availability/slots'

const TZ = 'America/Santiago'

// Configuración real del caso reportado: mar 14:00-17:30 + jue/vie/sáb 09:00-14:30
const rules: AvailabilityRuleLike[] = [
  { dayOfWeek: 2, startTime: '14:00', endTime: '17:30', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '14:30', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '14:30', isActive: true },
  { dayOfWeek: 6, startTime: '09:00', endTime: '14:30', isActive: true },
]

// Lunes 2026-07-06 12:00 local
const now = fromZonedTime('2026-07-06 12:00:00', TZ)

// Bloqueo diario 12:00-14:00 ("Almuercito") sobre la semana simulada
function dailyLunchBlocks() {
  const blocks: { startDateTime: Date; endDateTime: Date }[] = []
  for (let i = 0; i <= 8; i++) {
    const dayStr = formatInTimeZone(addDays(now, i), TZ, 'yyyy-MM-dd')
    blocks.push({
      startDateTime: fromZonedTime(`${dayStr} 12:00:00`, TZ),
      endDateTime: fromZonedTime(`${dayStr} 14:00:00`, TZ),
    })
  }
  return blocks
}

const services = [
  { id: 'svc-225', name: 'MANICURA RUSA HIGH LEVEL', durationMinutes: 225, isActive: true },
  { id: 'svc-90', name: 'ESMALTADO', durationMinutes: 90, isActive: true },
]

describe('computeServiceFit', () => {
  it('detecta el servicio de 225 min que no cabe en ningún día (caso real)', () => {
    const result = computeServiceFit(services, rules, dailyLunchBlocks(), TZ, now)

    const manicura = result.find((r) => r.serviceId === 'svc-225')
    expect(manicura).toBeDefined()
    // Martes: ventana de 210 min < 225. Jue/vie/sáb: 09:00-12:00 (180) y
    // 14:00-14:30 (30) tras el almuerzo. No cabe en ninguna parte.
    expect(manicura?.fitsNowhere).toBe(true)
    expect(manicura?.daysWithSlots).toEqual([])
  })

  it('el servicio de 90 min sí cabe (fitsNowhere false, con días concretos)', () => {
    const result = computeServiceFit(services, rules, dailyLunchBlocks(), TZ, now)

    const esmaltado = result.find((r) => r.serviceId === 'svc-90')
    expect(esmaltado?.fitsNowhere).toBe(false)
    // Semana simulada: mar 7, jue 9, vie 10, sáb 11 de julio
    expect(esmaltado?.daysWithSlots).toEqual(['2026-07-07', '2026-07-09', '2026-07-10', '2026-07-11'])
  })

  it('sin bloqueos, el de 225 solo cabe jue/vie/sáb (martes dura 210 min)', () => {
    const result = computeServiceFit(services, rules, [], TZ, now)

    const manicura = result.find((r) => r.serviceId === 'svc-225')
    expect(manicura?.fitsNowhere).toBe(false)
    expect(manicura?.daysWithSlots).toEqual(['2026-07-09', '2026-07-10', '2026-07-11'])
  })

  it('ignora servicios inactivos', () => {
    const result = computeServiceFit(
      [{ id: 'svc-off', name: 'Inactivo', durationMinutes: 30, isActive: false }],
      rules,
      [],
      TZ,
      now,
    )
    expect(result).toEqual([])
  })

  it('expone nombre y duración para armar el copy del aviso', () => {
    const result = computeServiceFit(services, rules, dailyLunchBlocks(), TZ, now)
    const manicura = result.find((r) => r.serviceId === 'svc-225')
    expect(manicura?.serviceName).toBe('MANICURA RUSA HIGH LEVEL')
    expect(manicura?.durationMinutes).toBe(225)
  })
})
