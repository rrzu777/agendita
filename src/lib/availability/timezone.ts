import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
import { getISODay } from 'date-fns'

/**
 * Obtiene la fecha local (como string yyyy-MM-dd) de un instante UTC
 * en el timezone del negocio.
 */
export function getLocalDateStr(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}

/**
 * Obtiene el día de la semana local (0=domingo...6=sábado) de un instante UTC
 * en el timezone del negocio.
 */
export function getLocalDayOfWeek(date: Date, timezone: string): number {
  const zoned = toZonedTime(date, timezone)
  return getISODay(zoned) % 7
}

/**
 * Obtiene la hora local (como string HH:mm) de un instante UTC
 * en el timezone del negocio.
 */
export function getLocalTimeStr(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'HH:mm')
}

/** Suma `n` días a una fecha local `yyyy-MM-dd` (aritmética de calendario pura, sin TZ). */
function addLocalDays(localDateStr: string, n: number): string {
  const [y, m, d] = localDateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n)) // Date.UTC normaliza el desborde de mes/año
  return formatInTimeZone(dt, 'UTC', 'yyyy-MM-dd')
}

/**
 * Construye el instante UTC del inicio del día local (00:00:00.000) para una
 * fecha local `yyyy-MM-dd` en el timezone del negocio.
 *
 * En el "gap" del cambio de hora de primavera (ej. Santiago: la medianoche del
 * 1er domingo de sep no existe, el reloj salta de 00:00 a 01:00) `fromZonedTime`
 * resuelve el 00:00 inexistente cayendo al día anterior (23:00). En ese caso el
 * inicio real del día es el primer instante que sí existe: reintentamos con 01:00.
 */
export function startOfLocalDay(localDateStr: string, timezone: string): Date {
  const midnight = fromZonedTime(`${localDateStr}T00:00:00.000`, timezone)
  if (getLocalDateStr(midnight, timezone) === localDateStr) return midnight
  return fromZonedTime(`${localDateStr}T01:00:00.000`, timezone)
}

/**
 * Construye el instante UTC del fin del día local para una fecha local
 * `yyyy-MM-dd` en el timezone del negocio: el último milisegundo antes del
 * inicio del día siguiente. Definirlo así (y no como un `23:59:59.999` literal)
 * hace que los días sean una partición exacta de la línea de tiempo incluso en
 * el cambio de hora de otoño, donde la hora 23:xx ocurre dos veces y un
 * `23:59:59.999` literal dejaría fuera la segunda ocurrencia.
 */
export function endOfLocalDay(localDateStr: string, timezone: string): Date {
  return new Date(startOfLocalDay(addLocalDays(localDateStr, 1), timezone).getTime() - 1)
}

/**
 * Construye el instante UTC del inicio del mes local (día 1, 00:00:00.000) que
 * contiene a `date`, en el timezone del negocio. Usa el mes LOCAL, no el UTC:
 * cerca de medianoche del día 1 el mes local puede diferir del mes UTC.
 */
export function startOfLocalMonth(date: Date, timezone: string): Date {
  const localFirstOfMonth = formatInTimeZone(date, timezone, 'yyyy-MM-01')
  return startOfLocalDay(localFirstOfMonth, timezone)
}

/**
 * Devuelve los instantes UTC reales que delimitan un día local del negocio.
 *
 * Ejemplo: para timezone America/Santiago y fecha 2026-05-20T04:00:00Z
 * (que es 00:00 local del 20), devuelve:
 *   dayStart: 2026-05-20T04:00:00.000Z
 *   dayEnd:   2026-05-21T03:59:59.999Z
 */
export function getBusinessDayRange(date: Date, timezone: string): { dayStart: Date; dayEnd: Date } {
  const localDateStr = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
  return { dayStart: startOfLocalDay(localDateStr, timezone), dayEnd: endOfLocalDay(localDateStr, timezone) }
}
