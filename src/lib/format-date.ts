/**
 * Fecha corta localizada (p. ej. "05 jul") para vencimientos en la UI. Centraliza
 * el formato usado en la tarjeta pública y el panel de paquetes.
 */
export function formatShortDate(date: Date | string): string {
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(date))
}

/** Fecha media localizada es-CL (p. ej. "5 jul 2026"), con año. */
export function formatMediumDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })
}
