import type { Prisma } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'

const DAY_MS = 86_400_000

/** Lee el discriminador `kind` del JSON conditions de una regla automática. */
export function conditionKind(conditions: Prisma.JsonValue | null): string | null {
  return (conditions as { kind?: string } | null)?.kind ?? null
}

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

/** Año de la instancia de (mes,día) más cercana a `now` en la TZ dada. Estable dentro de una
 *  ventana ±windowDays (con windowDays < ~180): todos los días de la ventana caen en el mismo
 *  año → misma occasionKey → una sola emisión por ocasión anual. Ignora bisiestos, mismo
 *  criterio pragmático que monthDayDistance (el borde con windowDays chico es irrelevante). */
function nearestOccurrenceYear(md: { m: number; d: number }, now: Date, timeZone: string): number {
  const [ny, nm, nd] = formatInTimeZone(now, timeZone, 'yyyy-MM-dd').split('-').map(Number)
  const nowRef = Date.UTC(ny, nm - 1, nd)
  let best = ny
  let bestDist = Infinity
  for (const y of [ny - 1, ny, ny + 1]) {
    const dist = Math.abs(Date.UTC(y, md.m - 1, md.d) - nowRef)
    if (dist < bestDist) { bestDist = dist; best = y }
  }
  return best
}

/** dedupeKey de la ocasión temporal que gatilla la regla ganadora.
 *  - cumpleaños/aniversario: por OCASIÓN-AÑO (`${id}:birthday:2026`). Con windowDays>0 todos los
 *    días de la ventana comparten la key ⇒ una sola emisión por año (antes se emitía cada día).
 *  - winback (y fallback): por (clienta, día local). La re-elegibilidad real de winback la controla
 *    R-WINBACK en el cron (excluye si ya emitió tras la última visita); esta key sólo da idempotencia
 *    intra-día entre las corridas horarias. */
export function occasionKey(
  rule: { conditions: Prisma.JsonValue },
  c: { id: string; birthDate: Date | null; firstCompletedAt: Date | null },
  now: Date,
  timeZone: string,
): string {
  const kind = conditionKind(rule.conditions)
  if (kind === 'birthday' && c.birthDate) {
    // birthDate se compara en UTC (igual que matchesBirthday).
    return `${c.id}:birthday:${nearestOccurrenceYear(monthDay(c.birthDate, 'UTC'), now, timeZone)}`
  }
  if (kind === 'anniversary' && c.firstCompletedAt) {
    // firstCompletedAt se compara en la TZ del negocio (igual que matchesAnniversary).
    return `${c.id}:anniversary:${nearestOccurrenceYear(monthDay(c.firstCompletedAt, timeZone), now, timeZone)}`
  }
  return `${c.id}:${formatInTimeZone(now, timeZone, 'yyyy-MM-dd')}:auto-timed`
}
export function firstVisitKey(customerId: string): string { return `${customerId}:first_visit` }
export function reviewKey(customerId: string, bookingId: string): string { return `${customerId}:review:${bookingId}` }
export function referralKey(customerId: string): string { return `${customerId}:referral` }

export function sortByPriorityDesc<T extends { priority: number }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => b.priority - a.priority)
}
