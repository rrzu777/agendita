import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, parseISO } from 'date-fns'

export interface SeriesLike {
  id: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason: string | null
  anchorDate: Date
  until: Date | null
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
}

/** Tope de días que expande una serie de una sola pasada (evita rangos patológicos). */
export const MAX_EXPANSION_DAYS = 366

function localDateStr(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}

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
  const anchorStr = localDateStr(series.anchorDate, timezone)
  const untilStr = series.until ? localDateStr(series.until, timezone) : null

  const exceptionByDate = new Map<string, ExceptionLike>()
  for (const exc of exceptions) {
    exceptionByDate.set(localDateStr(exc.occurrenceDate, timezone), exc)
  }

  const startStr = localDateStr(rangeStart, timezone)
  const endStr = localDateStr(rangeEnd, timezone)

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
          occurrenceDate: fromZonedTime(`${cursor} 00:00:00`, timezone),
        })
      }
    }
    cursor = nextLocalDate(cursor)
  }

  return result
}
