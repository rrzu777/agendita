'use server'

// NOTE: 'use server' — SOLO funciones async exportadas. Flujo DUEÑA: requiere
// sesión (owner/admin). Reusa los helpers de declared.ts y applyApprovedPayment;
// no exportar consts/tipos desde este módulo (boundary de 'use server').

import { addHours } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { isDeclaredTransferPayment } from '@/lib/bank-transfer/declared'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
  sendBankTransferRejectedToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

export async function confirmBankTransfer(
  paymentId: string,
  amount: number,
): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser positivo')

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new Error('Pago no encontrado')
    if (!isDeclaredTransferPayment(payment)) {
      throw new Error('Este pago no es una transferencia por verificar')
    }

    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } })
    if (!booking) throw new Error('Reserva no encontrada')
    if (booking.status === 'expired' || booking.status === 'cancelled') {
      throw new Error(
        'Esta reserva expiró o fue cancelada. Registrá el pago creando la reserva de nuevo desde el calendario.',
      )
    }

    // Doble cobro: pagó MP después de declarar la transferencia.
    const approved = await tx.payment.findFirst({
      where: { bookingId: booking.id, status: 'approved' },
    })
    if (approved) throw new Error('Esta reserva ya tiene el abono pagado.')

    if (amount > booking.remainingBalance) throw new Error('El monto excede el saldo pendiente')

    const now = new Date()
    const holdExpired = booking.holdExpiresAt != null && booking.holdExpiresAt < now
    if (holdExpired) {
      // Re-validar solape SOLO si el turno es FUTURO: con el hold vencido
      // availability volvió a ofertar ese horario y otra clienta/bloqueo pudo
      // tomarlo (§6.2 paso 2). Un turno ya pasado no tiene conflicto de cupo que
      // prevenir y assertSlotIsAvailable lo rechazaría por lead-time — falso
      // negativo que bloquearía registrar un pago legítimo el mismo día.
      if (booking.startDateTime > now) {
        await assertSlotIsAvailable({
          tx,
          businessId,
          serviceId: booking.serviceId,
          startDateTime: booking.startDateTime,
          endDateTime: booking.endDateTime,
          timezone: business.timezone || 'America/Santiago',
          excludeBookingId: booking.id,
          leadTimeMinutes: 0,
        })
      }
      // Bump corto SIEMPRE que el hold venció (futuro o pasado): assertBookingPayable
      // tira con pending_payment + hold vencido sin mirar startDateTime. Sin este
      // update la confirmación de un pago legítimo revienta. El paso final confirma ya.
      await tx.booking.updateMany({
        where: { id: booking.id, status: 'pending_payment' },
        data: { holdExpiresAt: addHours(now, 1) },
      })
    }

    // applyApprovedPayment exige amount/paymentType EXACTOS: actualizar antes.
    const derivedType = deriveManualPaymentType(booking, amount)
    await tx.payment.update({
      where: { id: paymentId },
      data: { amount, paymentType: derivedType },
    })

    const { applyApprovedPayment } = await import('@/server/services/finance')
    const { wasConfirmed } = await applyApprovedPayment({
      tx,
      bookingId: booking.id,
      businessId,
      amount,
      currency: payment.currency,
      provider: 'manual',
      providerPaymentId: payment.providerPaymentId,
      paymentType: derivedType,
      paymentMethod: payment.paymentMethod ?? 'Transferencia',
      paymentId,
    })
    return { wasConfirmed, bookingId: booking.id }
  })

  if (result.wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(result.bookingId, businessId),
    )
  }
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
