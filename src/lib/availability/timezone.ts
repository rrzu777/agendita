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

/**
 * Construye el instante UTC del inicio del día local (00:00:00.000) para una
 * fecha local `yyyy-MM-dd` en el timezone del negocio.
 */
export function startOfLocalDay(localDateStr: string, timezone: string): Date {
  return fromZonedTime(`${localDateStr}T00:00:00.000`, timezone)
}

/**
 * Construye el instante UTC del fin del día local (23:59:59.999) para una
 * fecha local `yyyy-MM-dd` en el timezone del negocio.
 */
export function endOfLocalDay(localDateStr: string, timezone: string): Date {
  return fromZonedTime(`${localDateStr}T23:59:59.999`, timezone)
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
