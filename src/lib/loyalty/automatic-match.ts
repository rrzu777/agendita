import { formatInTimeZone } from 'date-fns-tz'

const DAY_MS = 86_400_000

/** mes/día (1-based) de una fecha en la zona horaria dada. */
function monthDay(date: Date, timeZone: string): { m: number; d: number } {
  const [m, d] = formatInTimeZone(date, timeZone, 'MM-dd').split('-').map(Number)
  return { m, d }
}

/** Distancia mínima en días entre dos (mes,día) ignorando el año (maneja el wrap dic↔ene).
 *  Usa un año no bisiesto de referencia; con windowDays ≤ 60 el error de borde es irrelevante. */
function monthDayDistance(a: { m: number; d: number }, b: { m: number; d: number }): number {
  const ref = (md: { m: number; d: number }) => Date.UTC(2001, md.m - 1, md.d)
  const yr = 365 * DAY_MS
  let diff = Math.abs(ref(a) - ref(b))
  diff = Math.min(diff, yr - diff)
  return Math.round(diff / DAY_MS)
}

export function matchesBirthday(birthDate: Date | null, now: Date, timeZone: string, windowDays: number): boolean {
  if (!birthDate) return false
  return monthDayDistance(monthDay(birthDate, 'UTC'), monthDay(now, timeZone)) <= windowDays
}

export function matchesAnniversary(firstCompletedAt: Date | null, now: Date, timeZone: string, windowDays: number): boolean {
  if (!firstCompletedAt) return false
  // No premiar el mismo año de la primera visita (aniversario = al menos ~1 año después).
  const elapsedDays = (now.getTime() - firstCompletedAt.getTime()) / DAY_MS
  if (elapsedDays < 365 - windowDays) return false
  return monthDayDistance(monthDay(firstCompletedAt, timeZone), monthDay(now, timeZone)) <= windowDays
}

export function isWinbackInactive(lastCompletedAt: Date | null, now: Date, inactivityDays: number): boolean {
  if (!lastCompletedAt) return false
  return now.getTime() - lastCompletedAt.getTime() >= inactivityDays * DAY_MS
}

export function occasionKey(customerId: string, now: Date, timeZone: string): string {
  return `${customerId}:${formatInTimeZone(now, timeZone, 'yyyy-MM-dd')}:auto-timed`
}
export function firstVisitKey(customerId: string): string { return `${customerId}:first_visit` }
export function reviewKey(customerId: string, bookingId: string): string { return `${customerId}:review:${bookingId}` }
export function referralKey(customerId: string): string { return `${customerId}:referral` }

export function sortByPriorityDesc<T extends { priority: number }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => b.priority - a.priority)
}
