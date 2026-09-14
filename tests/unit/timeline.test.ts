import { describe, it, expect } from 'vitest'
import {
  localMinutesFromMidnight,
  localDayKey,
  computeHourRange,
  packLanes,
  buildTimelineAxis,
  packSegmentLanes,
  segmentItemsByLocalDays,
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

  it('conserva la duración real de citas de cinco minutos', () => {
    const packed = packLanes([b('2026-07-01T13:00:00Z', '2026-07-01T13:05:00Z')], TZ, 8)
    expect(packed[0].heightMin).toBe(5)
  })

  it('no inventa un solape entre 11:30–11:50 y 12:00–13:30', () => {
    const packed = packLanes([
      b('2026-07-01T15:30:00Z', '2026-07-01T15:50:00Z'),
      b('2026-07-01T16:00:00Z', '2026-07-01T17:30:00Z'),
    ], TZ, 8)

    expect(packed.map(({ lane, lanes, heightMin }) => ({ lane, lanes, heightMin }))).toEqual([
      { lane: 0, lanes: 1, heightMin: 20 },
      { lane: 0, lanes: 1, heightMin: 90 },
    ])
  })

  it('mantiene dos lanes cuando los intervalos reales sí se cruzan', () => {
    const packed = packLanes([
      b('2026-07-01T15:30:00Z', '2026-07-01T16:15:00Z'),
      b('2026-07-01T16:00:00Z', '2026-07-01T17:30:00Z'),
    ], TZ, 8)

    expect(packed.map(({ lane, lanes }) => ({ lane, lanes }))).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ])
  })

  it('empaqueta bookings y bloqueos intercalados por sus intervalos reales hasta fin de día', () => {
    const packed = packLanes([
      { ...b('2026-07-02T03:30:00Z', '2026-07-02T03:35:00Z'), kind: 'booking' }, // 23:30–23:35
      { ...b('2026-07-02T03:35:00Z', '2026-07-02T03:55:00Z'), kind: 'block' },   // 23:35–23:55
      { ...b('2026-07-02T03:55:00Z', '2026-07-02T03:59:00Z'), kind: 'booking' }, // 23:55–23:59
    ], TZ, 8)

    expect(packed.map(({ lane, lanes, heightMin }) => ({ lane, lanes, heightMin }))).toEqual([
      { lane: 0, lanes: 1, heightMin: 5 },
      { lane: 0, lanes: 1, heightMin: 20 },
      { lane: 0, lanes: 1, heightMin: 4 },
    ])
  })
})

describe('segmentación real por día local', () => {
  it('divide un intervalo nocturno sin perder minutos y conserva el objeto original', () => {
    const original = { id: 'overnight', ...b('2026-06-30T23:55:00Z', '2026-07-01T00:10:00Z') }
    const segments = segmentItemsByLocalDays([original], ['2026-06-30', '2026-07-01'], 'UTC')

    expect(segments.map((segment) => ({
      dayKey: segment.dayKey,
      minutes: (segment.segmentEnd.getTime() - segment.segmentStart.getTime()) / 60_000,
      fromPrevious: segment.continuesFromPreviousDay,
      toNext: segment.continuesToNextDay,
    }))).toEqual([
      { dayKey: '2026-06-30', minutes: 5, fromPrevious: false, toNext: true },
      { dayKey: '2026-07-01', minutes: 10, fromPrevious: true, toNext: false },
    ])
    expect(segments[0].item).toBe(original)
    expect(segments[1].item).toBe(original)
    expect(segments.reduce((sum, segment) => sum + segment.segmentEnd.getTime() - segment.segmentStart.getTime(), 0)).toBe(15 * 60_000)
  })

  it('incluye todos los tramos visibles de un intervalo que comenzó antes de la vista', () => {
    const original = { id: 'vacaciones', ...b('2026-06-29T10:00:00Z', '2026-07-02T10:00:00Z') }
    const segments = segmentItemsByLocalDays([original], ['2026-06-30', '2026-07-01'], 'UTC')

    expect(segments.map((segment) => ({ dayKey: segment.dayKey, minutes: (segment.segmentEnd.getTime() - segment.segmentStart.getTime()) / 60_000 }))).toEqual([
      { dayKey: '2026-06-30', minutes: 1440 },
      { dayKey: '2026-07-01', minutes: 1440 },
    ])
  })

  it('usa intersecciones half-open: tocar un límite no crea un tramo', () => {
    const items = [
      { id: 'ends-at-start', ...b('2026-06-29T23:00:00Z', '2026-06-30T00:00:00Z') },
      { id: 'starts-at-end', ...b('2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z') },
    ]
    expect(segmentItemsByLocalDays(items, ['2026-06-30'], 'UTC')).toEqual([])
  })

  it('asigna lanes por instantes reales entre una continuación y una cita regular', () => {
    const segments = segmentItemsByLocalDays([
      { id: 'continua', ...b('2026-06-30T23:30:00Z', '2026-07-01T01:00:00Z') },
      { id: 'regular', ...b('2026-07-01T00:15:00Z', '2026-07-01T00:45:00Z') },
    ], ['2026-07-01'], 'UTC')
    const axis = buildTimelineAxis('2026-07-01', segments, 'UTC')
    const packed = packSegmentLanes(segments, axis.start)

    expect(packed.map(({ lane, lanes, heightMin }) => ({ lane, lanes, heightMin }))).toEqual([
      { lane: 0, lanes: 2, heightMin: 60 },
      { lane: 1, lanes: 2, heightMin: 30 },
    ])
  })
})

describe('eje por instantes reales y DST', () => {
  it('mantiene 08:00–20:00 en un día ordinario', () => {
    const axis = buildTimelineAxis('2026-07-01', [], TZ)
    expect(axis.durationMin).toBe(12 * 60)
    expect(axis.ticks.map((tick) => tick.label)).toEqual([
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
      '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
    ])
  })

  it('primavera: el día completo dura 23 horas y omite la hora inexistente', () => {
    const axis = buildTimelineAxis('2026-09-06', [], TZ, 0, 24)
    expect(axis.durationMin).toBe(23 * 60)
    expect(axis.ticks).toHaveLength(23)
    expect(axis.ticks[0].label).toBe('01:00')
    expect(axis.ticks.some((tick) => tick.label.startsWith('00:00'))).toBe(false)
  })

  it('otoño: conserva 25 horas, ordena los instantes y distingue la hora repetida por offset', () => {
    const axis = buildTimelineAxis('2026-04-04', [], TZ, 0, 24)
    const repeated = axis.ticks.filter((tick) => tick.label.startsWith('23:00'))
    expect(axis.durationMin).toBe(25 * 60)
    expect(axis.ticks).toHaveLength(25)
    expect(repeated.map((tick) => tick.label)).toEqual(['23:00 (-03:00)', '23:00 (-04:00)'])
    expect(repeated[0].instant.getTime()).toBeLessThan(repeated[1].instant.getTime())
  })

  it('mide 75 minutos reales aunque ambos extremos se lean dentro de la hora repetida', () => {
    const segments = segmentItemsByLocalDays([
      b('2026-04-05T02:30:00Z', '2026-04-05T03:45:00Z'),
    ], ['2026-04-04'], TZ)
    const axis = buildTimelineAxis('2026-04-04', segments, TZ)
    expect(packSegmentLanes(segments, axis.start)[0].heightMin).toBe(75)
  })
})
