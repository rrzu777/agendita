import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, addMonths, addWeeks, parseISO } from 'date-fns'
import { getLocalDateStr, startOfLocalDay } from '@/lib/availability/timezone'

export interface SeriesLike {
  id: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason: string | null
  anchorDate: Date
  until: Date | null
  /** Minutos que una cita puede invadir por cada borde de cada ocurrencia. */
  overlapToleranceMinutes?: number
  /** De quién es la serie. `null` = del negocio, cierra para todos. Obligatorio a
   *  propósito: es un dato que se pierde callado si se puede omitir. */
  professionalId: string | null
}

export interface ExceptionLike {
  occurrenceDate: Date
  isSkipped: boolean
  startDateTime: Date | null
  endDateTime: Date | null
  reason: string | null
}

export interface EffectiveBlock {
  id: string
  startDateTime: Date
  endDateTime: Date
  reason: string | null
  seriesId?: string
  occurrenceDate?: Date
  /** Minutos que una cita puede invadir por cada borde del bloqueo. */
  overlapToleranceMinutes?: number
  /**
   * De quién es el bloqueo. `null` = del negocio, cierra para todos.
   *
   * `EffectiveBlock` es un tipo PROYECTADO y se construye en dos lugares: el
   * `.map` de los bloqueos sueltos (`effective-blocks.ts`) y acá abajo. Filtrar
   * la query sin proyectar el campo deja los recurrentes sin dueño aguas abajo, y
   * el calendario no puede distinguir el feriado del salón de las vacaciones de
   * una persona.
   */
  professionalId: string | null
}

/** Tope de días que expande una serie de una sola pasada (evita rangos patológicos). */
export const MAX_EXPANSION_DAYS = 366

/** Día de la semana (0=dom…6=sáb) de una fecha local yyyy-MM-dd. */
function dayOfWeekOfLocalDate(dateStr: string): number {
  // Anclamos a mediodía UTC y leemos el día ISO (1=lun…7=dom) también en UTC,
  // de modo que el cálculo no dependa de la zona horaria de la máquina.
  return Number(formatInTimeZone(parseISO(`${dateStr}T12:00:00Z`), 'UTC', 'i')) % 7
}

/** Siguiente fecha local yyyy-MM-dd (aritmética segura a mediodía UTC). */
function nextLocalDate(dateStr: string): string {
  return formatInTimeZone(addDays(parseISO(`${dateStr}T12:00:00Z`), 1), 'UTC', 'yyyy-MM-dd')
}

export function expandSeries(
  series: SeriesLike,
  exceptions: ExceptionLike[],
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): EffectiveBlock[] {
  const anchorStr = getLocalDateStr(series.anchorDate, timezone)
  const untilStr = series.until ? getLocalDateStr(series.until, timezone) : null

  const exceptionByDate = new Map<string, ExceptionLike>()
  for (const exc of exceptions) {
    exceptionByDate.set(getLocalDateStr(exc.occurrenceDate, timezone), exc)
  }

  const startStr = getLocalDateStr(rangeStart, timezone)
  const endStr = getLocalDateStr(rangeEnd, timezone)

  const result: EffectiveBlock[] = []
  let cursor = startStr
  let guard = 0

  while (cursor <= endStr && guard < MAX_EXPANSION_DAYS) {
    guard++
    const dow = dayOfWeekOfLocalDate(cursor)
    const inRule =
      series.daysOfWeek.includes(dow) &&
      cursor >= anchorStr &&
      (untilStr === null || cursor <= untilStr)

    if (inRule) {
      const exc = exceptionByDate.get(cursor)
      if (!exc?.isSkipped) {
        const start = exc?.startDateTime ?? fromZonedTime(`${cursor} ${series.startTime}`, timezone)
        const end = exc?.endDateTime ?? fromZonedTime(`${cursor} ${series.endTime}`, timezone)
        const reason = exc ? exc.reason : series.reason
        result.push({
          id: `${series.id}:${cursor}`,
          startDateTime: start,
          endDateTime: end,
          reason,
          seriesId: series.id,
          // `startOfLocalDay` y no `fromZonedTime` a mano: en el gap de DST la
          // medianoche local no existe y caería al día anterior, con lo que la clave
          // de búsqueda de excepciones (línea de arriba) dejaría de matchear.
          occurrenceDate: startOfLocalDay(cursor, timezone),
          // Los override de excepción cambian hora/motivo; la tolerancia es de la serie
          overlapToleranceMinutes: series.overlapToleranceMinutes ?? 0,
          // Y el dueño también es de la serie: una excepción edita el día, no de
          // quién es el bloqueo.
          professionalId: series.professionalId,
        })
      }
    }
    cursor = nextLocalDate(cursor)
  }

  return result
}

export type SeriesEndMode = 'forever' | 'month' | 'weeks'

/**
 * Calcula el instante `until` (último día incluido, 00:00 local) a partir del
 * modo de fin. `forever` -> null. `weeks` usa `weeks` (>=1).
 */
export function computeSeriesUntil(
  anchorDate: Date,
  mode: SeriesEndMode,
  weeks: number | null,
  timezone: string,
): Date | null {
  if (mode === 'forever') return null
  const anchorStr = formatInTimeZone(anchorDate, timezone, 'yyyy-MM-dd')
  const anchorNoon = parseISO(`${anchorStr}T12:00:00Z`)
  const lastNoon = mode === 'month' ? addMonths(anchorNoon, 1) : addWeeks(anchorNoon, Math.max(1, weeks ?? 1))
  const lastStr = formatInTimeZone(lastNoon, 'UTC', 'yyyy-MM-dd')
  // Mismo motivo que en expandSeries: si el último día cae en el gap de DST, armar
  // la medianoche a mano acorta la serie un día.
  return startOfLocalDay(lastStr, timezone)
}
