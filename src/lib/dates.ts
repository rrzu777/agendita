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
