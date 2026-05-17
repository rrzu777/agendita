import { formatInTimeZone, toZonedTime } from 'date-fns-tz'
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
