import { describe, it, expect } from 'vitest'
import { expandSeries, computeSeriesUntil, type ExceptionLike, type SeriesLike } from '@/lib/calendar/expand-series'
import { getLocalDateStr } from '@/lib/availability/timezone'

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
  professionalId: null,
}

function range(startLocal: string, endLocal: string) {
  return {
    start: new Date(`${startLocal}T00:00:00-04:00`),
    end: new Date(`${endLocal}T23:59:59-04:00`),
  }
}

describe('expandSeries', () => {
  it('propaga overlapToleranceMinutes de la serie a cada ocurrencia', () => {
    const { start, end } = range('2026-06-01', '2026-06-07')
    const occ = expandSeries({ ...base, overlapToleranceMinutes: 30 }, [], start, end, TZ)
    expect(occ.length).toBeGreaterThan(0)
    for (const o of occ) {
      expect(o.overlapToleranceMinutes).toBe(30)
    }
  })

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

  // Chile pasa a horario de verano el 1er domingo de septiembre: el reloj salta de
  // 23:59:59 del sábado a 01:00 del domingo, así que las 00:00 del 2026-09-06 NO
  // existen. `fromZonedTime` resuelve esa medianoche inexistente cayendo al día
  // anterior, y el occurrenceDate es la CLAVE con que se buscan las excepciones.
  describe('gap de DST: el domingo en que la medianoche no existe', () => {
    // Almuerzo dominical, para que la serie caiga justo en el día del salto.
    const sunday: SeriesLike = { ...base, daysOfWeek: [0] }
    // El 2026-09-06 completo. `range()` no sirve acá: tiene el -04:00 fijo y en
    // septiembre Chile ya está en UTC-3. Arranca a las 01:00, el primer instante
    // que existe ese día.
    const gapDayStart = new Date('2026-09-06T01:00:00-03:00')
    const gapDayEnd = new Date('2026-09-06T23:59:59-03:00')

    it('el occurrenceDate cae en ESE día local, no en el anterior', () => {
      const [occ] = expandSeries(sunday, [], gapDayStart, gapDayEnd, TZ)
      expect(occ.id).toBe('series-1:2026-09-06')
      // Es la clave real: así se indexan las excepciones en expandSeries.
      expect(getLocalDateStr(occ.occurrenceDate!, TZ)).toBe('2026-09-06')
      expect(occ.occurrenceDate?.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    })

    // El bug tal como lo vive la dueña: la UI toma el occurrenceDate que produjo
    // expandSeries y lo manda de vuelta a skipSeriesOccurrence, así que la fila se
    // guarda con ESE valor. Si está corrido un día, la excepción se guarda bien pero
    // expandSeries no la encuentra nunca: saltás el almuerzo de ese domingo y el
    // bloqueo sigue apareciendo.
    it('saltear ese domingo con el occurrenceDate que devuelve la propia expansión funciona', () => {
      const [occ] = expandSeries(sunday, [], gapDayStart, gapDayEnd, TZ)
      const conExcepcion = expandSeries(
        sunday,
        [{ occurrenceDate: occ.occurrenceDate!, isSkipped: true, startDateTime: null, endDateTime: null, reason: null }],
        gapDayStart, gapDayEnd, TZ,
      )
      expect(conExcepcion).toEqual([])
    })

    // El mismo gap, pero en la HORA de la serie y no en la clave: componer una
    // hora local que no existe la manda al día anterior. Un bloqueo "toda la
    // madrugada" arrancaba a las 23:00 del sábado, tapando una hora que la dueña
    // no bloqueó.
    it('una serie que arranca en la hora que el reloj se saltea no se corre al día anterior', () => {
      const madrugada: SeriesLike = { ...sunday, startTime: '00:00', endTime: '10:00' }
      const [occ] = expandSeries(madrugada, [], gapDayStart, gapDayEnd, TZ)
      expect(getLocalDateStr(occ.startDateTime, TZ)).toBe('2026-09-06')
      expect(occ.startDateTime.toISOString()).toBe('2026-09-06T04:00:00.000Z') // 01:00 local
      expect(occ.endDateTime.toISOString()).toBe('2026-09-06T13:00:00.000Z') // 10:00 local (UTC-3)
    })
  })

  // La dueña abre el bloqueo de un día y le cambia la FECHA: el diálogo guarda la
  // excepción con el día ORIGINAL como clave y el horario nuevo adentro. El barrido
  // sólo visita los días que dicta la regla dentro del rango, así que preguntar por
  // el día nuevo no la encontraba: un bloqueo real que el chequeo de disponibilidad
  // no veía, y encima se podía reservar.
  describe('una excepción que mueve la ocurrencia a otro día', () => {
    const lunes: SeriesLike = { ...base, daysOfWeek: [1] }
    const movidaAlMartes: ExceptionLike = {
      occurrenceDate: new Date('2026-06-01T04:00:00.000Z'), // lunes 1, la clave
      isSkipped: false,
      startDateTime: new Date('2026-06-02T19:00:00.000Z'), // martes 2, 15:00 local
      endDateTime: new Date('2026-06-02T20:00:00.000Z'),
      reason: 'Movido al martes',
    }

    it('aparece cuando se pregunta por el día NUEVO', () => {
      const { start, end } = range('2026-06-02', '2026-06-02')
      const occ = expandSeries(lunes, [movidaAlMartes], start, end, TZ)
      expect(occ).toHaveLength(1)
      expect(occ[0].startDateTime.toISOString()).toBe('2026-06-02T19:00:00.000Z')
      expect(occ[0].reason).toBe('Movido al martes')
      // Sigue siendo la ocurrencia del lunes: es la clave con que la UI edita o saltea.
      expect(occ[0].id).toBe('series-1:2026-06-01')
      expect(occ[0].occurrenceDate?.toISOString()).toBe('2026-06-01T04:00:00.000Z')
    })

    it('ya no aparece en el día del que se fue', () => {
      const { start, end } = range('2026-06-01', '2026-06-01')
      expect(expandSeries(lunes, [movidaAlMartes], start, end, TZ)).toEqual([])
    })

    it('con los dos días en el rango aparece una sola vez', () => {
      const { start, end } = range('2026-06-01', '2026-06-02')
      const occ = expandSeries(lunes, [movidaAlMartes], start, end, TZ)
      expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-01'])
    })

    it('una excepción de un día que la serie ya no dicta no revive', () => {
      // La serie pasó a ser sólo de martes; la excepción del lunes quedó huérfana.
      const martes: SeriesLike = { ...base, daysOfWeek: [2] }
      const { start, end } = range('2026-06-02', '2026-06-02')
      const occ = expandSeries(martes, [movidaAlMartes], start, end, TZ)
      // Sólo la ocurrencia propia del martes (13:00), no la huérfana movida.
      expect(occ.map((o) => o.id)).toEqual(['series-1:2026-06-02'])
      expect(occ[0].startDateTime.toISOString()).toBe('2026-06-02T17:00:00.000Z')
    })
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

  it('un until que aterriza en el gap de DST no se corre un día para atrás', () => {
    // 2026-08-06 + 1 mes = 2026-09-06, el domingo cuya medianoche no existe.
    const anchorAugust = new Date('2026-08-06T04:00:00.000Z')
    const until = computeSeriesUntil(anchorAugust, 'month', null, 'America/Santiago')
    expect(formatUntil(until)).toBe('2026-09-06')
  })
})

function formatUntil(d: Date | null): string {
  if (!d) return 'null'
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
