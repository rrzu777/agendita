import { BookingStatus } from '@prisma/client'
import { isManuallyPayableStatus } from '@/lib/bookings/payable-statuses'

export class BookingNotPayableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingNotPayableError'
  }
}

/**
 * Verifica que una reserva esté en estado pagable y que su hold no haya expirado.
 * Lanza BookingNotPayableError si no es pagable.
 *
 * `allowExpiredHold`: salta SOLO el chequeo de hold vencido (no revive estados
 * terminales). Lo usa el verificador de transferencia, que ya re-validó el cupo
 * dentro de su propia tx y no debería tener que escribir un holdExpiresAt falso
 * solo para pasar por acá.
 *
 * `allowCompleted`: `completed` es terminal para pagos SALVO el saldo por
 * transferencia (spec #3 §4: la clienta puede pagar después de atendida) y el
 * pago manual de la dueña (spec FU-B4b-3 §6: recobro post-chargeback / saldo
 * tras atender). Lo pasan la rama bt-balance de confirmBankTransfer y
 * createManualPayment — nunca el webhook MP ni confirmPayment.
 */
export function assertBookingPayable(
  booking: {
    status: BookingStatus
    holdExpiresAt: Date | null
  },
  opts?: { allowExpiredHold?: boolean; allowCompleted?: boolean },
): void {
  // Deriva de la fuente única MANUAL_PAYMENT_STATUSES (payable-statuses.ts) —
  // la misma que gatea el botón en la UI. Fail-closed: un status nuevo del
  // enum queda NO pagable hasta sumarlo explícitamente a la lista.
  const payable =
    booking.status === BookingStatus.completed
      ? !!opts?.allowCompleted
      : isManuallyPayableStatus(booking.status)
  if (!payable) {
    throw new BookingNotPayableError('No se puede procesar pago para esta reserva')
  }

  if (
    !opts?.allowExpiredHold &&
    booking.status === BookingStatus.pending_payment &&
    booking.holdExpiresAt &&
    booking.holdExpiresAt < new Date()
  ) {
    throw new BookingNotPayableError('El tiempo para pagar esta reserva ha expirado')
  }
}
