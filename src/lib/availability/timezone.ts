/**
 * Convierte una fecha UTC a un "local-equivalent" Date
 * cuyos componentes (año, mes, día, hora, minuto, segundo)
 * reflejan la hora local en el timezone del negocio.
 *
 * Esto permite usar date-fns sobre fechas que conceptualmente
 * viven en otro timezone sin agregar dependencias.
 */
export function toBusinessLocalDate(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10)

  // month is 1-based in Intl, 0-based in Date constructor
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}
