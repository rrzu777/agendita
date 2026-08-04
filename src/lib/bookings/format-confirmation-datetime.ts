/**
 * Formatea el inicio de una reserva en la zona horaria del NEGOCIO, no la del
 * server. Sin `timeZone`, en Vercel (server UTC) las reservas caídas ≥20:00 hora
 * local se renderizaban con el día y la hora equivocados (ej. "lunes 20, 12:30
 * a.m." en vez de "domingo 19, 8:30 p.m."). Devuelve el formato largo es-CL que
 * usa la pantalla de confirmación (12h con "p. m.").
 */
export function formatConfirmationDateTime(
  startDateTime: Date,
  timezone: string,
): { date: string; time: string } {
  return {
    date: startDateTime.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    }),
    time: startDateTime.toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }),
  }
}
