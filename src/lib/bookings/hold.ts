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
 * Y devuelve **quién puso el techo**, no una fecha: `'window'` es el plazo de
 * verdad, con la suya; `'appointment'` es "hasta la cita" y no lleva ninguna a
 * propósito, porque esa fecha es el final del propio turno que la pantalla o el
 * mail ya están contando y repetirla se lee como un dato nuevo. Que el dato
 * viaje en el tipo es lo que hace que las plantillas de email puedan decirlo en
 * palabras: allá la reserva ya no está a mano y un `Date` pelado no se puede
 * comparar contra nada. Cada superficie pone las suyas — la clienta lee "tu
 * cita" y la dueña "la cita".
 *
 * `endDateTime` va en `null` para lo que no es una cita —una compra de paquete
 * tiene hold pero no turno—: ahí el único techo posible es la ventana. Pasa por
 * acá igual para que los tres casos de "no prometas nada" tengan un solo dueño.
 */
export type HoldDeadlinePromise = { kind: 'window'; at: Date } | { kind: 'appointment' }

export function holdDeadlinePromise(
  booking: { holdExpiresAt: Date | null; endDateTime: Date | null },
  now: Date = new Date(),
): HoldDeadlinePromise | null {
  if (booking.holdExpiresAt == null || booking.holdExpiresAt <= now) return null
  if (booking.endDateTime == null) return { kind: 'window', at: booking.holdExpiresAt }
  if (booking.endDateTime <= now) return null
  return booking.holdExpiresAt < booking.endDateTime
    ? { kind: 'window', at: booking.holdExpiresAt }
    : { kind: 'appointment' }
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
 * Devuelve `null` en los mismos tres casos que `holdDeadlinePromise`, así que
 * el caller muestra la frase o no muestra nada.
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
  if (promise.kind === 'appointment') return 'tu cita'
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
