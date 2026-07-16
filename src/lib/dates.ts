export const DAY_MS = 86_400_000

/** Valida un string de fecha de nacimiento YYYY-MM-DD: formato, fecha de calendario
 *  real (round-trip UTC, rechaza fechas "rodadas"), año >= 1900 y no futura.
 *  Misma semántica que el validador de birthDate de customers. */
export function isValidBirthDateString(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false
  return d.getUTCFullYear() >= 1900 && d.getTime() <= Date.now()
}

/** Ancla un YYYY-MM-DD a medianoche UTC (convención de Customer.birthDate). */
export function birthDateToUtcDate(v?: string | null): Date | null {
  return v ? new Date(`${v}T00:00:00Z`) : null
}

/**
 * Valida que un string YYYY-MM-DD sea una fecha de calendario real. Rechaza
 * meses/días fuera de rango que el constructor de Date "rueda" al período
 * siguiente (ej. 2020-13-45 o 1990-02-30). Asume formato ya validado por regex.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}
