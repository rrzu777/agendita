import { describe, it, expect } from 'vitest'
import {
  localMinutesFromMidnight,
  localDayKey,
  computeHourRange,
  packLanes,
} from '@/lib/calendar/timeline'

const TZ = 'America/Santiago' // UTC-4 en julio (horario estándar de Chile)

function b(start: string, end: string) {
  return { startDateTime: start, endDateTime: end }
}

describe('localMinutesFromMidnight', () => {
  it('convierte un instante UTC a minutos desde medianoche local', () => {
    // 13:00Z == 09:00 local en Santiago (UTC-4)
    expect(localMinutesFromMidnight(new Date('2026-07-01T13:00:00Z'), TZ)).toBe(9 * 60)
  })
})

describe('localDayKey', () => {
  it('usa el día local del negocio', () => {
    // 02:00Z del 2 jul == 22:00 local del 1 jul
    expect(localDayKey(new Date('2026-07-02T02:00:00Z'), TZ)).toBe('2026-07-01')
  })
})

describe('computeHourRange', () => {
  it('mantiene el rango por defecto 8–20 cuando las citas caen dentro', () => {
    const r = computeHourRange([b('2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z')], TZ)
    expect(r).toEqual({ startHour: 8, endHour: 20 })
  })

  it('expande hacia atrás para una cita temprana', () => {
    // 10:00Z == 06:00 local
    const r = computeHourRange([b('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z')], TZ)
    expect(r.startHour).toBe(6)
  })

  it('expande hacia adelante para una cita tardía', () => {
    // 01:30Z (2 jul) == 21:30 local (1 jul) -> endHour 22
    const r = computeHourRange([b('2026-07-02T00:30:00Z', '2026-07-02T01:30:00Z')], TZ)
    expect(r.endHour).toBe(22)
  })
})

describe('packLanes', () => {
  it('asigna una sola columna a citas que no se solapan', () => {
    const items = [
      b('2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z'),
      b('2026-07-01T14:00:00Z', '2026-07-01T15:00:00Z'),
    ]
    const packed = packLanes(items, TZ, 8)
    expect(packed.every((p) => p.lanes === 1 && p.lane === 0)).toBe(true)
  })

  it('reparte en dos columnas citas que se solapan', () => {
    const items = [
      b('2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z'),
      b('2026-07-01T13:30:00Z', '2026-07-01T14:30:00Z'),
    ]
    const packed = packLanes(items, TZ, 8)
    expect(packed.every((p) => p.lanes === 2)).toBe(true)
    expect(packed.map((p) => p.lane).sort()).toEqual([0, 1])
  })

  it('posiciona top/height relativos al inicio del eje', () => {
    // 13:00Z == 09:00 local, eje arranca 08:00 -> top 60 min, dura 60 min
    const packed = packLanes([b('2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z')], TZ, 8)
    expect(packed[0].topMin).toBe(60)
    expect(packed[0].heightMin).toBe(60)
  })

  it('aplica una altura mínima de 30 minutos a citas muy cortas', () => {
    const packed = packLanes([b('2026-07-01T13:00:00Z', '2026-07-01T13:10:00Z')], TZ, 8)
    expect(packed[0].heightMin).toBe(30)
  })
})
