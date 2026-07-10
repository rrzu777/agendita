/**
 * Formatea un Date como `yyyy-MM-dd` usando sus componentes LOCALES, no UTC.
 *
 * Los helpers `nextBookableDate` validan el día de semana con `date.getDay()`
 * (hora local del runner, fijada a America/Santiago = tz del negocio en CI).
 * Usar `date.toISOString()` para extraer la fecha la convierte a UTC, que de
 * noche cae al día siguiente — un día de semana distinto al validado. Este
 * formateo local mantiene la fecha que el helper realmente eligió, sin depender
 * de la hora a la que corre la suite.
 */
export function toLocalDateStr(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
