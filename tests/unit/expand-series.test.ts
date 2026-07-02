import { describe, it, expect } from 'vitest'
import { expandSeries, computeSeriesUntil, type SeriesLike } from '@/lib/calendar/expand-series'

const TZ = 'America/Santiago'

// Almuerzo 13:00-14:00, Lun(1)-Jue(4), ancla lunes 2026-06-01, forever.
const base: SeriesLike = {
  id: 'series-1',
  daysOfWeek: [1, 2, 3, 4],
  startTime: '13:00',
  endTime: '14:00',
  reason: 'Almuerzo',
  anchorDate: new Date('2026-06-01T04:00:00.000Z'), // 2026-06-01 00:00 local
  until: null,
}

function range(startLocal: string, endLocal: string) {
  return {
    start: new Date(`${startLocal}T00:00:00-04:00`),
    end: new Date(`${endLocal}T23:59:59-04:00`),
  }
}

describe('expandSeries', () => {
  it('genera una ocurrencia por cada día de la semana en daysOfWeek dentro del rango', () => {
    const { start, end } = range('2026-06-01', '2026-06-07')
    const occ = expandSeries(base, [], start, end, TZ)
    expect(occ).toHaveLength(4)
    expect(occ[0].id).toBe('series-1:2026-06-01')
    expect(occ[0].reason).toBe('Almuerzo')
  })

  it('compone las horas en el timezone del negocio (13:00 local = 17:00Z)', () => {
    const { start, end } = range('2026-06-01', '2026-06-01')
    const [occ] = expandSeries(base, [], start, end, TZ)
    expect(occ.startDateTime.toISOString()).toBe('2026-06-01T17:00:00.000Z')
    expect(occ.endDateTime.toISOString()).toBe('2026-06-01T18:00:00.000Z')
  })

  it('excluye días anteriores al anchorDate', () => {
    const { start, end } = range('2026-05-25', '2026-06-02')
    const occ = expandSeries(base, [], start, end, TZ)
    expect(occ.every((o) => o.id >= 'series-1:2026-06-01')).toBe(true)
    expect(occ.find((o) => o.id === 'series-1:2026-05-26')).toBeUndefined()
  })

  it('respeta until (excluye días estrictamente posteriores)', () => {
    const withUntil: SeriesLike = { ...base, until: new Date('2026-06-02T04:00:00.000Z') }
    const { start, end } = range('2026-06-01', '2026-06-30')
    const occ = expandSeries(withUntil, [], start, end, TZ)
    expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-01', 'series-1:2026-06-02'])
  })

  it('omite una ocurrencia con excepción isSkipped', () => {
    const { start, end } = range('2026-06-01', '2026-06-04')
    const occ = expandSeries(
      base,
      [{ occurrenceDate: new Date('2026-06-02T04:00:00.000Z'), isSkipped: true, startDateTime: null, endDateTime: null, reason: null }],
      start, end, TZ,
    )
    expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-01', 'series-1:2026-06-03', 'series-1:2026-06-04'])
  })

  it('aplica un override de hora/motivo a la ocurrencia', () => {
    const { start, end } = range('2026-06-01', '2026-06-01')
    const [occ] = expandSeries(
      base,
      [{
        occurrenceDate: new Date('2026-06-01T04:00:00.000Z'),
        isSkipped: false,
        startDateTime: new Date('2026-06-01T18:00:00.000Z'),
        endDateTime: new Date('2026-06-01T19:00:00.000Z'),
        reason: 'Almuerzo tardío',
      }],
      start, end, TZ,
    )
    expect(occ.startDateTime.toISOString()).toBe('2026-06-01T18:00:00.000Z')
    expect(occ.reason).toBe('Almuerzo tardío')
  })

  it('acota la expansión a MAX_EXPANSION_DAYS aunque el rango sea enorme', () => {
    const { start } = range('2026-06-01', '2026-06-01')
    const end = new Date('2035-01-01T00:00:00.000Z')
    const occ = expandSeries(base, [], start, end, TZ)
    expect(occ.length).toBeLessThan(365)
  })

  it('las ocurrencias exponen seriesId y occurrenceDate para ruteo en UI', () => {
    const { start, end } = range('2026-06-01', '2026-06-01')
    const [occ] = expandSeries(base, [], start, end, 'America/Santiago')
    expect(occ.seriesId).toBe('series-1')
    expect(occ.occurrenceDate?.toISOString()).toBe('2026-06-01T04:00:00.000Z')
  })

  it('compone la hora correctamente cruzando la transición DST de Chile', () => {
    // Chile pasa a horario de verano (UTC-3) en septiembre. Lunes 2026-09-07 ya es DST
    // -> 13:00 local = 16:00Z (en junio, UTC-4, sería 17:00Z).
    const start = new Date('2026-09-07T00:00:00-03:00')
    const end = new Date('2026-09-07T23:59:59-03:00')
    const [occ] = expandSeries(base, [], start, end, TZ)
    expect(occ.startDateTime.toISOString()).toBe('2026-09-07T16:00:00.000Z')
    expect(occ.endDateTime.toISOString()).toBe('2026-09-07T17:00:00.000Z')
  })
})

describe('computeSeriesUntil', () => {
  const anchor = new Date('2026-06-01T04:00:00.000Z') // 2026-06-01 local America/Santiago

  it('forever -> null', () => {
    expect(computeSeriesUntil(anchor, 'forever', null, 'America/Santiago')).toBeNull()
  })

  it('month -> mismo día un mes después (local)', () => {
    const until = computeSeriesUntil(anchor, 'month', null, 'America/Santiago')
    expect(formatUntil(until)).toBe('2026-07-01')
  })

  it('weeks -> anchor + N semanas (local)', () => {
    const until = computeSeriesUntil(anchor, 'weeks', 3, 'America/Santiago')
    expect(formatUntil(until)).toBe('2026-06-22')
  })
})

function formatUntil(d: Date | null): string {
  if (!d) return 'null'
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
