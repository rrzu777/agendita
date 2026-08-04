import { BookingStatus } from '@prisma/client'
import { isManuallyPayableStatus } from '@/lib/bookings/payable-statuses'
import { isDoomedHold } from '@/lib/payments/confirmation-state'

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
 * El plazo vencido cierra el cobro por un motivo PRESTADO: no es que la plata
 * moleste, es que el cron va a expirar la reserva y asentarla sería asentarla
 * sobre algo que en minutos es `expired`. Por eso el chequeo no es "el plazo
 * pasó" sino `isDoomedHold`, que espeja las condiciones del sweep — y el sweep
 * NO toca una reserva con plata adentro (filtra `paymentStatus: 'unpaid'`).
 *
 * La diferencia no era teórica. `pending_payment` + `deposit_paid` + plazo
 * vencido —lo que deja la rama `slotConflict` de `recalcBookingFromPayments`
 * cuando el pago llega y el horario ya se lo llevó otra persona— era un callejón
 * sin salida: acá se rechazaba el cobro, el panel mandaba a esperar el estado
 * `Expirada`, y ese estado no llegaba nunca porque el cron la saltea. La clienta
 * con el efectivo en la mano y ningún lugar donde asentarlo.
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
    /** Requerido a propósito: es lo único que distingue la reserva que el cron
     *  va a barrer de la que tiene plata adentro y ningún sweep va a tocar. Un
     *  caller que no lo traiga le cierra el cobro para siempre. */
    paymentStatus: string
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

  if (!opts?.allowExpiredHold && isDoomedHold(booking, new Date())) {
    throw new BookingNotPayableError('El tiempo para pagar esta reserva ha expirado')
  }
}
