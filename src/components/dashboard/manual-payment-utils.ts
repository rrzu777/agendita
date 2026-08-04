import { isManuallyPayableStatus } from '@/lib/bookings/payable-statuses'
import { isDoomedHold } from '@/lib/payments/confirmation-state'
import type { Vocabulary } from '@/lib/vocabulary'

export type ManualPaymentMode = 'fixed' | 'percentage'

// Formato "$1.000 CLP" de la UI de pagos del dashboard (distinto del Intl de
// lib/money). Fuente única para las tres superficies: registrar pago manual,
// verificar transferencia y la sección "por verificar".
export function formatManualPaymentMoney(amount: number, currency: string) {
  return `$${amount.toLocaleString('es-CL')} ${currency}`
}

export type ManualPaymentBooking = {
  id: string
  bookingNumber: number | null
  status: string
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  /** Requeridos a propósito (mismo criterio que `professional` en
   *  CalendarBooking): opcionales, la consulta que se olvide de traerlos compila
   *  igual y el botón vuelve a desalinearse del server. `holdExpiresAt: null` =
   *  sin hold; van juntos porque el guard los lee a los dos. */
  holdExpiresAt: Date | null
  paymentStatus: string
  service: { name: string } | null
  customer: { name: string } | null
  // Opcional: solo lo traen los llamadores que ya consultan `payments`
  // (getBookings). Habilita el aviso de "saldo por verificar" en el diálogo
  // sin forzar a los demás llamadores a agregar la relación.
  payments?: Array<{ providerPaymentId?: string | null }>
}

/** Los campos que deciden si se puede cobrar. Nombrarlos una vez evita que las
 *  dos funciones que TIENEN que coincidir se separen por un `Pick` de menos. */
type PayabilityFields = Pick<
  ManualPaymentBooking,
  'status' | 'remainingBalance' | 'holdExpiresAt' | 'paymentStatus'
>

export function isManualPaymentAllowed(booking: PayabilityFields, now: Date = new Date()) {
  // Estados desde la fuente única compartida con assertBookingPayable (server);
  // el gate de monto (saldo > 0) es propio de esta superficie.
  if (booking.remainingBalance <= 0 || !isManuallyPayableStatus(booking.status)) return false
  // Segundo guard de assertBookingPayable, espejado acá con SU MISMO predicado:
  // el server tira "El tiempo para pagar esta reserva ha expirado" exactamente
  // cuando el cron va a barrer la reserva. Sin esto el panel ofrecía "Cobrar" y
  // el clic terminaba en ese error, que no le dice a la dueña qué hacer. Ojo:
  // quien esconda el botón por esto tiene que poner el motivo en su lugar — ver
  // `manualPaymentBlockedReason`.
  if (isDoomedHold(booking, now)) return false
  return true
}

/**
 * Por qué no se puede cobrar, en palabras que le sirvan a la dueña. `null` = se
 * puede, o el motivo es obvio mirando la fila (saldo cero, reserva cancelada).
 *
 * El plazo vencido es el único caso que merece explicación: la reserva se ve
 * viva, la clienta puede estar llamando con la plata, y la salida existe pero
 * no está a la vista — hay que esperar a que el cron la expire para que
 * aparezca "Revivir". Sin este texto, el botón que desaparece es indistinguible
 * de una app rota.
 *
 * Que la condición sea `isDoomedHold` y no "el plazo pasó" es lo que hace que la
 * salida que promete EXISTA: sobre una reserva con plata adentro el cron no pasa
 * nunca, así que "esperá a que quede Expirada" era mandarla a esperar sentada.
 * Ese caso ya no llega acá — se puede cobrar.
 */
export function manualPaymentBlockedReason(
  booking: PayabilityFields,
  now: Date = new Date(),
): string | null {
  if (booking.remainingBalance <= 0 || !isManuallyPayableStatus(booking.status)) return null
  if (!isDoomedHold(booking, now)) return null
  return 'Venció el plazo para pagar, así que el cobro está cerrado. Si quiere pagar igual, esperá a que la reserva quede Expirada y usá Revivir.'
}

export function calculateManualPaymentAmount({
  mode,
  value,
  remainingBalance,
}: {
  mode: ManualPaymentMode
  value: number
  remainingBalance: number
}) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (mode === 'percentage') {
    return Math.min(remainingBalance, Math.round((remainingBalance * value) / 100))
  }
  return Math.min(remainingBalance, Math.round(value))
}

export function getManualPaymentSuggestion({
  depositPaid,
  depositRequired,
  remainingBalance,
}: Pick<ManualPaymentBooking, 'depositPaid' | 'depositRequired' | 'remainingBalance'>) {
  if (remainingBalance <= 0) {
    return { amount: 0, label: 'Sin saldo pendiente' }
  }

  if (depositPaid <= 0 && depositRequired > 0) {
    return {
      amount: Math.min(depositRequired, remainingBalance),
      label: 'Abono configurado',
    }
  }

  return {
    amount: remainingBalance,
    label: 'Saldo pendiente',
  }
}

/**
 * Confirmación de "rechazar transferencia". Vive acá porque el diálogo de
 * verificación y la sección "por verificar" la muestran idéntica, y el texto del
 * saldo cambia con el rubro — duplicarla era duplicar también la interpolación.
 *
 * Rechazar el ABONO cancela la reserva; rechazar el SALDO no, y por eso invita a
 * volver a avisar.
 */
export function rejectTransferConfirmMessage(kind: 'deposit' | 'balance', vocabulary: Vocabulary): string {
  return kind === 'balance'
    ? `¿Rechazar esta transferencia del saldo? La reserva NO se cancela; ${vocabulary.theClient} podrá volver a avisar.`
    : '¿Rechazar esta transferencia? Se cancelará la reserva.'
}
