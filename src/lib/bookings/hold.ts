/** Cuánto se le guarda el horario a una reserva que todavía no pagó.
 *
 *  Es el default del funnel (pago online): la clienta tiene esta ventana para
 *  volver del checkout antes de que el horario se libere. La transferencia
 *  bancaria NO usa esto — pasa su propia ventana larga (holdHours * 60), que la
 *  dueña configura en su cuenta.
 */
export const DEFAULT_HOLD_MINUTES = 15

/** El hold de una reserva creada desde el panel. Es más largo a propósito: la
 *  dueña la anotó a mano y el cobro lo coordina ella, así que el plazo no es el
 *  de un checkout abierto. Vive acá al lado del otro para que se lea como una
 *  política distinta y no como un número que alguien se olvidó de nombrar. */
export const DASHBOARD_HOLD_MINUTES = 60

/** Marcador de `Booking.paymentMethod` para el camino donde el negocio coordina
 *  el abono a mano: el servicio pide abono pero no hay checkout online ni
 *  transferencia configurados, así que la clienta no PUEDE pagar dentro de la
 *  ventana del funnel. Lo escribe createBooking (la decisión es del servidor,
 *  no del navegador) y lo leen el cron —para avisarle a la clienta si la
 *  ventana se vence— y la pantalla de confirmación —para no pedirle que
 *  "complete el pago" que no existe. La ventana la configura la dueña en
 *  `Business.manualHoldHours`. */
export const MANUAL_COORDINATION_METHOD = 'manual'
