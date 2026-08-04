import { getLocalDateStr } from '@/lib/availability/timezone'
import { formatConfirmationDateTime } from '@/lib/bookings/format-confirmation-datetime'

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

/**
 * Hasta cuándo se le puede prometer el horario a alguien, **sin mentirle**.
 *
 * `holdExpiresAt` se calcula siempre como "ahora + ventana" y no sabe nada del
 * turno, así que con una ventana larga (las `holdHours` de la transferencia, y
 * sobre todo las `manualHoldHours` de la coordinación a mano, 24 h por default)
 * y una cita cercana el plazo cae DESPUÉS de la cita. Decirle a alguien "te
 * guardamos el horario hasta mañana a las 14:00" cuando su cita es hoy a las
 * 16:00 no es un error de cálculo: es una frase sin sentido, y la clienta la lee
 * en la pantalla de confirmación y en el mail.
 *
 * El tope va acá, **al mostrar**, y no al escribir el hold. Escribirlo topado
 * destruye la ventana real y no sobrevive a que la cita se mueva: una reserva
 * creada para dentro de una hora quedaría con el plazo achicado para siempre, y
 * al reprogramarla a la semana siguiente moriría con la cita a siete días. Peor
 * todavía, truncaría el plazo de `declareBankTransfer`, que ya no mide cuánto le
 * guardamos el horario a alguien que no pagó sino cuánto tiene la dueña para
 * verificar plata declarada.
 *
 * Devuelve `null` cuando no hay nada que prometer, que son tres casos distintos
 * y ninguno se muestra igual:
 * - la reserva no tiene plazo (ya está firme),
 * - el plazo ya venció,
 * - **la cita ya pasó**: "te guardamos el horario" dejó de significar algo,
 *   aunque el hold siga vivo en la base.
 *
 * Si el valor devuelto es `endDateTime`, el techo es la cita y no la ventana —
 * el caller que quiera decirlo con palabras ("hasta tu cita") lo sabe
 * comparando.
 */
export function promisableHoldDeadline(
  booking: { holdExpiresAt: Date | null; endDateTime: Date },
  now: Date = new Date(),
): Date | null {
  if (booking.holdExpiresAt == null || booking.holdExpiresAt <= now) return null
  if (booking.endDateTime <= now) return null
  return booking.holdExpiresAt < booking.endDateTime ? booking.holdExpiresAt : booking.endDateTime
}

/**
 * El plazo prometido con **quién le puso el techo** adentro, para los casos en
 * que la promesa viaja lejos de la reserva.
 *
 * `promisableHoldDeadline` devuelve un `Date` y el caller que lo tenga a mano
 * puede comparar contra `endDateTime` para saber si el techo fue la cita. Las
 * plantillas de email no lo tienen a mano: reciben su data ya armada, y ahí un
 * `Date` pelado ya perdió el dato. Por eso el borde lleva esto y no una fecha.
 *
 * `'window'` es el plazo de verdad, con su fecha. `'appointment'` es "hasta la
 * cita" y **no lleva fecha a propósito**: esa fecha es el final del propio turno
 * que el mail ya está contando arriba, así que imprimirla es repetir un dato
 * cambiado de nombre. Cada superficie pone las palabras que le sirven — la
 * clienta lee "tu cita" y la dueña "la cita".
 */
export type HoldDeadlinePromise = { cap: 'window'; at: Date } | { cap: 'appointment' }

export function holdDeadlinePromise(
  booking: { holdExpiresAt: Date | null; endDateTime: Date },
  now: Date = new Date(),
): HoldDeadlinePromise | null {
  const deadline = promisableHoldDeadline(booking, now)
  if (!deadline) return null
  return deadline.getTime() === booking.endDateTime.getTime() ? { cap: 'appointment' } : { cap: 'window', at: deadline }
}

/**
 * El plazo YA DICHO en palabras **para una pantalla**, para meter en una frase:
 * "tu horario queda guardado hasta {esto}".
 *
 * Es `HoldDeadlinePromise` con las palabras de una pantalla puestas: "tu cita"
 * cuando el techo es la cita, y para el plazo de hoy la fecha sobra —alcanza la
 * hora—. **Ese atajo es lo que no comparte con el email**: un mail se lee
 * cuando el destinatario quiere, y "las 14:30" leído mañana miente. El mail
 * arma su propia frase desde la misma promesa (ver `fmtDeadlinePromise` en
 * `lib/notifications/templates.ts`).
 *
 * Devuelve `null` en los mismos tres casos que `promisableHoldDeadline`, así
 * que el caller muestra la frase o no muestra nada.
 *
 * El `now` se puede pasar, y la pantalla de confirmación lo hace: deriva el
 * estado y el plazo del MISMO instante, porque dos relojes con milisegundos
 * distintos pueden contradecirse.
 */
export function holdDeadlinePhrase(
  booking: { holdExpiresAt: Date | null; endDateTime: Date },
  timezone: string,
  now: Date = new Date(),
): string | null {
  const promise = holdDeadlinePromise(booking, now)
  if (!promise) return null
  if (promise.cap === 'appointment') return 'tu cita'
  const { date, time } = formatConfirmationDateTime(promise.at, timezone)
  const esHoy = getLocalDateStr(promise.at, timezone) === getLocalDateStr(now, timezone)
  return esHoy ? `las ${time}` : `el ${date} a las ${time}`
}

/** Marcador de `Booking.paymentMethod` para el camino donde el negocio coordina
 *  el abono a mano: el servicio pide abono pero no hay checkout online ni
 *  transferencia configurados, así que la clienta no PUEDE pagar dentro de la
 *  ventana del funnel. Lo escribe createBooking (la decisión es del servidor,
 *  no del navegador) y lo leen el cron —para avisarle a la clienta si la
 *  ventana se vence— y la pantalla de confirmación —para no pedirle que
 *  "complete el pago" que no existe. La ventana la configura la dueña en
 *  `Business.manualHoldHours`. */
export const MANUAL_COORDINATION_METHOD = 'manual'
