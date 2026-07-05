import { formatInTimeZone } from 'date-fns-tz'
import { getLocalTimeStr } from '@/lib/availability/timezone'

/** Fecha local del negocio en formato chileno dd-MM-yyyy. */
export function formatBookingDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'dd-MM-yyyy')
}

/** Hora local del negocio HH:mm. */
export function formatBookingTime(date: Date, timezone: string): string {
  return getLocalTimeStr(date, timezone)
}

/** Fecha y hora locales del negocio. */
export function formatBookingDateTime(date: Date, timezone: string): string {
  return `${formatBookingDate(date, timezone)} ${formatBookingTime(date, timezone)}`
}
