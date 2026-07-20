'use server'

// NOTE: 'use server' — SOLO funciones async exportadas. Flujo DUEÑA: requiere
// sesión (owner/admin). Reusa los helpers de declared.ts y applyApprovedPayment;
// no exportar consts/tipos desde este módulo (boundary de 'use server').

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import type { Prisma } from '@prisma/client'
import {
  isDeclaredTransferPayment,
  isDeclaredBalancePayment,
  isFirmBooking,
  isDeclaredPkgTransferPayment,
} from '@/lib/bank-transfer/declared'
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
  sendBankTransferRejectedToCustomer,
  sendBalanceTransferVerifiedToCustomer,
  sendBalanceTransferRejectedToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'
import { action, UserError } from '@/lib/actions/result'

// Carga y valida que el Payment sea una declaración de transferencia del negocio
// pendiente de verificar. Guard compartido por confirmar y rechazar (mismos dos
// errores, misma condición) — no exportado: sigue dentro del boundary 'use server'.
async function loadDeclaredPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  businessId: string,
) {
  const payment = await tx.payment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.businessId !== businessId) throw new UserError('Pago no encontrado')
  if (!isDeclaredTransferPayment(payment) && !isDeclaredBalancePayment(payment)) {
    throw new UserError('Este pago no es una transferencia por verificar')
  }
  if (!payment.bookingId) throw new UserError('El pago no está asociado a una reserva')
  return payment as typeof payment & { bookingId: string }
}

async function _confirmBankTransfer(
  paymentId: string,
  amount: number,
): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])
  if (!Number.isFinite(amount) || amount <= 0) throw new UserError('El monto debe ser positivo')

  const result = await prisma.$transaction(async (tx) => {
    const payment = await loadDeclaredPayment(tx, paymentId, businessId)

    const booking = await tx.booking.findUnique({
      where: { id: payment.bookingId },
      include: { customer: true, service: true },
    })
    if (!booking) throw new UserError('Reserva no encontrada')
    if (booking.status === 'expired') {
      throw new UserError('Esta reserva expiró. Revivila desde Reservas y después verificá el pago.')
    }
    if (booking.status === 'cancelled') {
      throw new UserError(
        'Esta reserva fue cancelada. Registrá el pago creando la reserva de nuevo desde el calendario.',
      )
    }

    if (isDeclaredBalancePayment(payment)) {
      // ── Rama SALDO (spec §4): reserva firme, sin hold ni cupo en juego. Los
      // guards de abono (doble cobro MP, re-validación de hold vencido) no
      // aplican: una reserva confirmed/completed no tiene cupo en disputa y
      // puede conservar un holdExpiresAt vencido de cuando SÍ tenía hold. ──
      if (!isFirmBooking(booking.status)) {
        if (booking.status === 'no_show') throw new UserError('Esta reserva quedó como no asistida.')
        throw new UserError('Esta reserva no admite verificar un saldo todavía.')
      }
      if (amount > booking.remainingBalance) throw new UserError('El monto excede el saldo pendiente')

      const derivedType = deriveManualPaymentType(booking, amount)
      await tx.payment.update({ where: { id: paymentId }, data: { amount, paymentType: derivedType } })

      const { applyApprovedPayment } = await import('@/server/services/finance')
      await applyApprovedPayment({
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
        allowCompleted: true,
      })
      return {
        wasConfirmed: false as const,
        bookingId: booking.id,
        balanceVerified: {
          amount,
          currency: payment.currency,
          customerName: booking.customer?.name ?? null,
          customerEmail: booking.customer?.email ?? null,
          serviceName: booking.service?.name ?? 'servicio',
          startDateTime: booking.startDateTime,
          bookingNumber: booking.bookingNumber,
        },
      }
    }

    // ── Rama ABONO: todo lo existente queda byte-idéntico desde acá. ──

    // Doble cobro: pagó MP después de declarar la transferencia.
    const approved = await tx.payment.findFirst({
      where: { bookingId: booking.id, status: 'approved' },
    })
    if (approved) throw new UserError('Esta reserva ya tiene el abono pagado.')

    if (amount > booking.remainingBalance) throw new UserError('El monto excede el saldo pendiente')

    const now = new Date()
    const holdExpired = booking.holdExpiresAt != null && booking.holdExpiresAt < now
    if (holdExpired && booking.startDateTime > now) {
      // Re-validar solape SOLO si el turno es FUTURO: con el hold vencido
      // availability volvió a ofertar ese horario y otra clienta/bloqueo pudo
      // tomarlo (§6.2 paso 2). Un turno ya pasado no tiene conflicto de cupo que
      // prevenir y assertSlotIsAvailable lo rechazaría por lead-time — falso
      // negativo que bloquearía registrar un pago legítimo el mismo día.
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
      // Ya re-validamos el cupo arriba (si hacía falta): saltar el chequeo de
      // hold vencido en vez de escribir un holdExpiresAt falso solo para pasar.
      skipHoldExpiryCheck: holdExpired,
    })
    return { wasConfirmed, bookingId: booking.id, balanceVerified: undefined }
  })

  if (result.wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(result.bookingId, businessId),
    )
  }
  if (result.balanceVerified?.customerEmail) {
    const bv = result.balanceVerified
    // Hoist el await FUERA del callback: sendNotificationSafely recibe un
    // `() =>` no-async; un await adentro no compila.
    const replyTo = await getBusinessReplyToEmail(businessId)
    await sendNotificationSafely('balance transfer verified', () =>
      sendBalanceTransferVerifiedToCustomer({
        businessName: business.name,
        businessTimezone: business.timezone || 'America/Santiago',
        businessReplyToEmail: replyTo,
        customerName: bv.customerName ?? 'Cliente',
        customerEmail: bv.customerEmail!,
        serviceName: bv.serviceName,
        startDateTime: bv.startDateTime,
        bookingNumber: bv.bookingNumber,
        amount: bv.amount,
        currency: bv.currency,
      }),
    )
  }
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}

export const confirmBankTransfer = action(_confirmBankTransfer)

async function _rejectBankTransfer(paymentId: string): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const result = await prisma.$transaction(async (tx) => {
    const payment = await loadDeclaredPayment(tx, paymentId, businessId)
    // Capturado ANTES del updateMany: isDeclaredBalancePayment exige
    // status==='pending', que el updateMany de abajo cambia a 'rejected'.
    const isBalance = isDeclaredBalancePayment(payment)
    const { amount, currency } = payment

    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'rejected' },
    })
    if (count === 0) throw new UserError('Este pago ya fue procesado')

    const bookingUpd = await tx.booking.updateMany({
      where: { id: payment.bookingId, status: 'pending_payment' },
      data: { status: 'cancelled' },
    })
    if (bookingUpd.count > 0) {
      await releaseRedemptionForBooking(tx, payment.bookingId, 'cancelled')
    }
    const booking = await tx.booking.findUnique({
      where: { id: payment.bookingId },
      include: { customer: true, service: true },
    })
    return { booking, isBalance, amount, currency }
  })

  const { booking: rejected, isBalance, amount, currency } = result
  if (rejected?.customer?.email) {
    // Hoist el await FUERA del callback: sendNotificationSafely recibe un
    // `() =>` no-async; un await adentro no compila.
    const replyTo = await getBusinessReplyToEmail(businessId)
    const base = {
      businessName: business.name,
      businessTimezone: business.timezone || 'America/Santiago',
      businessReplyToEmail: replyTo,
      customerName: rejected.customer!.name,
      customerEmail: rejected.customer!.email!,
      serviceName: rejected.service?.name ?? 'servicio',
      startDateTime: rejected.startDateTime,
      bookingNumber: rejected.bookingNumber,
    }
    // El de saldo lleva monto/moneda y NO menciona cancelación; el de abono
    // (reserva sin confirmar) avisa que la reserva se canceló.
    await sendNotificationSafely(isBalance ? 'balance transfer rejected' : 'bank transfer rejected', () =>
      isBalance
        ? sendBalanceTransferRejectedToCustomer({ ...base, amount, currency })
        : sendBankTransferRejectedToCustomer(base),
    )
  }
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}

export const rejectBankTransfer = action(_rejectBankTransfer)

// ── Transferencia de PAQUETE (B4b-3, Task 12) ──
// No reusa loadDeclaredPayment: ese helper exige bookingId, que un pago de
// paquete no tiene (tiene packagePurchaseId en su lugar).

async function _confirmPackageTransfer(paymentId: string): Promise<{ ok: true }> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new UserError('Pago no encontrado')
    if (!isDeclaredPkgTransferPayment(payment)) throw new UserError('Este pago no es una transferencia de paquete por verificar')
    if (!payment.packagePurchaseId) throw new UserError('El pago no está asociado a una compra')

    // Flip atómico pending→active: gana un solo confirm y serializa contra el sweep
    // del cron y el doble-click (sin esto, un UPDATE by-id incondicional pisaría una
    // expiración concurrente o dispararía un P2002 opaco en el 2º confirm).
    const flip = await tx.packagePurchase.updateMany({
      where: { id: payment.packagePurchaseId, status: 'pending' },
      data: { status: 'active' },
    })
    if (flip.count === 0) throw new UserError('Esta compra ya fue procesada.')
    const purchase = await tx.packagePurchase.findUnique({ where: { id: payment.packagePurchaseId } })
    if (!purchase) throw new UserError('Compra no encontrada')

    await tx.payment.update({ where: { id: paymentId }, data: { status: 'approved' } })
    // Cancelar cualquier otro Payment pending de la compra (ej. un intento MP abandonado
    // antes de declarar la transferencia) — si no, quedaría pending para siempre y podría
    // aprobarse tarde sin asiento.
    await tx.payment.updateMany({
      where: { packagePurchaseId: purchase.id, status: 'pending', id: { not: paymentId } },
      data: { status: 'cancelled' },
    })
    await activatePackagePurchaseInTx(tx, purchase, { requestId: `pkg-transfer:${purchase.id}`, paymentId })
    return { customerId: purchase.customerId }
  })
  revalidatePath(`/dashboard/customers/${result.customerId}`)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}

export const confirmPackageTransfer = action(_confirmPackageTransfer)

async function _rejectPackageTransfer(paymentId: string): Promise<{ ok: true }> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.businessId !== businessId) throw new UserError('Pago no encontrado')
    if (!isDeclaredPkgTransferPayment(payment)) throw new UserError('Este pago no es una transferencia de paquete por verificar')
    const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'pending' }, data: { status: 'rejected' } })
    if (count === 0) throw new UserError('Este pago ya fue procesado')
    if (payment.packagePurchaseId) {
      await tx.packagePurchase.updateMany({ where: { id: payment.packagePurchaseId, status: 'pending' }, data: { status: 'rejected' } })
    }
    return { customerId: payment.customerId }
  })
  revalidatePath(`/dashboard/customers/${result.customerId}`)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}

export const rejectPackageTransfer = action(_rejectPackageTransfer)
