import { getLocalDateStr } from '@/lib/availability/timezone'
import { formatConfirmationDateTime } from '@/lib/bookings/format-confirmation-datetime'
import { isDoomedBooking } from '@/lib/payments/confirmation-state'

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
 * al reprogramarla a la semana siguiente moriría con la cita a siete días.
 * (`calculateApprovalExpiresAt` sí topa al escribir, y paga exactamente ese precio:
 * necesita que reprogramar RECALCULE el plazo — ver `rescheduledApprovalPatch`. No
 * es imposible sostenerlo, es más caro.) Peor
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

/** Quién está reprogramando. El core decide que una reserva condenada no se
 *  mueve; qué SALIDA nombrarle sólo lo sabe el caller, y es distinta de cada
 *  lado. Viaja como esta unión y no como un string con el texto ya puesto: así
 *  el error que este cambio teme —pasarle a la clienta el mensaje de la dueña—
 *  deja de compilar en vez de necesitar un test que lo vigile. */
export type RescheduleAudience = 'owner' | 'customer'

/**
 * Los cuatro textos del "no se puede reprogramar". Dos ejes, y los dos importan:
 *
 * - **Quién lee.** Cada mensaje nombra la salida de SU lado, que es lo que hace
 *   la diferencia entre un "no" y una app rota. La clienta no tiene ninguna —el
 *   plazo pasó—, así que lo único honesto es mandarla al negocio.
 * - **Qué plazo venció.** `isDoomedBooking` da por muerta a la reserva sin pagar
 *   *y* a la solicitud sin responder, y son dos historias distintas: la segunda
 *   la puede salvar la dueña ahora mismo con **Aceptar**, que además limpia el
 *   plazo (el argumento entero está en `effectiveBookingStatus`, que por eso
 *   deriva sólo `pending_payment`; acá no se repite para que no envejezca en dos
 *   lados). Mandarla a esperar el Revivir sería nombrarle la salida equivocada.
 *   Y del lado de la clienta ese plazo no era suyo: una solicitud sobre un
 *   servicio gratis nace `fully_paid`.
 *
 * El mensaje de la clienta no dice "para pagar" ni siquiera en la rama del pago,
 * y no es un olvido: el cron barre también la transferencia YA DECLARADA (sólo
 * el barrido perezoso de `approval.ts` la exime), así que este texto le puede
 * caer a alguien que transfirió en fecha y que arriba, en la misma pantalla, ve
 * "Transferencia en verificación". El bloqueo es correcto; la acusación no. Con
 * un pago de Mercado Pago en vuelo pasa lo mismo y es más incómodo —la fila dice
 * "Verificando tu pago"— pero el cron tampoco lo exime: ese pago puede aterrizar
 * y confirmar, y hasta que aterrice moverla no la salva.
 */
const HOLD_EXPIRED_RESCHEDULE = {
  owner: {
    payment:
      'Venció el plazo de esta reserva, así que reprogramarla no la mantendría viva. Esperá a que quede Expirada y usá Revivir, o verificá la transferencia si la clienta ya avisó.',
    confirmation:
      'Venció el plazo para responder esta solicitud, así que moverla no la mantendría viva. Si todavía la querés tomar, aceptala: al aceptarla el plazo desaparece.',
  },
  customer: {
    payment:
      'Venció el plazo de esta reserva, así que ya no se puede reprogramar. Contactá al negocio para coordinar.',
    confirmation:
      'El negocio no respondió esta solicitud a tiempo, así que ya no se puede reprogramar. Contactá al negocio para coordinar.',
  },
} as const satisfies Record<RescheduleAudience, { payment: string; confirmation: string }>

/**
 * Por qué no se puede reprogramar, en palabras que le sirvan a quien mira, o
 * `null` si sí se puede.
 *
 * Gemelo de `manualPaymentBlockedReason`, y por el mismo motivo: la condición y
 * el texto que la explica tienen que viajar juntos. Las CINCO superficies que
 * esconden el botón hacían el mismo par a mano —chequear `isDoomedBooking`, después
 * elegir el mensaje—, y una copia que se quede con un predicado más flojo no
 * falla: deja un "no" con la explicación de otro caso.
 *
 * Recibe la reserva entera y no el status suelto: al lado del status de la
 * reserva hay OTRO status (el del Payment: approved/pending/rejected) que
 * encajaría sin chistar y apagaría el guard. Pidiendo los cuatro campos que lee
 * `isDoomedBooking`, ese error no se puede escribir.
 *
 * `now` es OBLIGATORIO, igual que en `manualPaymentBlockedReason` y por los dos
 * motivos juntos: la etiqueta de estado y este bloqueo tienen que salir del
 * MISMO instante —si no, la fila dice "Expirada" y abajo ofrece Reprogramar, que
 * es exactamente lo que esto vino a sacar— y además lo llama un componente
 * `'use client'` que el servidor renderiza a HTML, donde un default `new Date()`
 * hace que servidor y navegador decidan con relojes distintos (hydration
 * mismatch, React #418, tumba la página entera).
 */
export function rescheduleBlockedReason(
  booking: {
    status: string
    paymentStatus: string
    holdExpiresAt: Date | null
    approvalExpiresAt: Date | null
  },
  audience: RescheduleAudience,
  now: Date,
): string | null {
  if (!isDoomedBooking(booking, now)) return null
  // Cae a la rama del pago por default a propósito: `isDoomedBooking` sólo condena
  // esos dos status, y si mañana suma uno, el texto genérico ("venció el plazo
  // de esta reserva") sigue siendo cierto — el de la solicitud no lo sería.
  const textos = HOLD_EXPIRED_RESCHEDULE[audience]
  return booking.status === 'pending_confirmation' ? textos.confirmation : textos.payment
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
