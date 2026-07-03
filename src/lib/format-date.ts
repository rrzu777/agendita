/**
 * Fecha corta localizada (p. ej. "05 jul") para vencimientos en la UI. Centraliza
 * el formato usado en la tarjeta pública y el panel de paquetes.
 */
export function formatShortDate(date: Date | string): string {
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(date))
}
