'use server'

import { addHours } from 'date-fns'
import { Prisma, PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { BANK_TRANSFER_PUBLIC_SELECT, type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { btDeclaredId, BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { sendMultiNotificationSafely, sendBankTransferDeclaredToBusiness } from '@/lib/notifications'

// NOTE: módulo 'use server' — SOLO funciones async exportadas (schemas/consts
// en src/lib/bank-transfer/). Flujo PÚBLICO: sin sesión, mismo modelo de
// seguridad que payments.ts (identidad = bookingId cuid + rate limit).

export async function getBankTransferInfo(businessId: string): Promise<BankTransferPublicInfo | null> {
  return prisma.bankTransferAccount.findFirst({
    where: { businessId, isEnabled: true },
    select: BANK_TRANSFER_PUBLIC_SELECT,
  })
}

/**
 * La clienta declara "ya transferí". Idempotente (providerPaymentId
 * determinístico) y con guard de carrera contra el cron expire-holds:
 * solo transiciona una pending_payment con hold vigente.
 */
export async function declareBankTransfer(bookingId: string): Promise<{ ok: true }> {
  const limit = await checkRateLimit('declare-bank-transfer', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const declared = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        business: { include: { bankTransferAccount: true } },
        service: true,
        customer: true,
      },
    })
    if (!booking) throw new Error('Reserva no encontrada')
    if (booking.paymentMethod !== BANK_TRANSFER_METHOD) {
      throw new Error('Esta reserva no eligió pago por transferencia')
    }
    const account = booking.business.bankTransferAccount
    if (!account || !account.isEnabled) {
      throw new Error('Este negocio no tiene transferencia bancaria habilitada')
    }

    // Idempotencia por status del bt-declared existente:
    // - pending  → ya declaró; éxito sin tocar el hold (re-declarar no re-extiende).
    // - approved → ya verificado (alcanzable vía confirmación parcial); jamás tocarlo,
    //              el ledger ya lo contabilizó.
    // - cancelled/rejected → la declaración murió (cron/expiración) y la dueña
    //   reabrió la reserva: REACTIVAR el mismo Payment (el unique impide crear otro).
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btDeclaredId(bookingId) },
    })
    if (existing && (existing.status === 'pending' || existing.status === 'approved')) return null

    // Guard de carrera vs cron (spec §4): solo una pending_payment con hold
    // vigente puede declarar (creación Y reactivación pasan por acá).
    const now = new Date()
    const newHold = account.verifyHours == null ? null : addHours(now, account.verifyHours)
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: 'pending_payment', holdExpiresAt: { gt: now } },
      data: { holdExpiresAt: newHold },
    })
    if (count === 0) {
      // Mensaje según el estado real (una revivida-cancelada/confirmada no "expiró").
      if (booking.status === 'cancelled') throw new Error('Tu reserva fue cancelada.')
      if (booking.status === 'confirmed') throw new Error('Tu reserva ya está confirmada.')
      throw new Error('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }

    // Monto server-authoritative, mismo criterio que initiatePayment (payments.ts).
    const amount = Math.min(booking.depositRequired, booking.remainingBalance)
    if (amount <= 0) throw new Error('Esta reserva no requiere abono')

    if (existing) {
      // Reactivación: mismo Payment, declaración "nueva" — createdAt = now para
      // que el recordatorio-dueña (rama verifyHours=null, 24h desde createdAt)
      // no dispare al instante.
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: PaymentStatus.pending, amount, createdAt: now },
      })
      return { booking, amount }
    }

    try {
      await tx.payment.create({
        data: {
          businessId: booking.businessId,
          bookingId,
          customerId: booking.customerId,
          provider: PaymentProvider.manual,
          providerPaymentId: btDeclaredId(bookingId),
          amount,
          currency: booking.business.currency || 'CLP',
          status: PaymentStatus.pending,
          paymentType: PaymentType.deposit,
          paymentMethod: 'Transferencia',
        },
      })
    } catch (e) {
      // P2002 = otro request ganó la carrera del create: tratarlo como éxito.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
      throw e
    }
    return { booking, amount }
  })

  if (declared) {
    // Post-tx, best-effort: un fallo de email no debe romper la declaración.
    await sendMultiNotificationSafely('bank transfer declared notification', () =>
      sendBankTransferDeclaredToBusiness(declared.booking.businessId, {
        businessName: declared.booking.business.name,
        businessTimezone: declared.booking.business.timezone,
        customerName: declared.booking.customer.name,
        serviceName: declared.booking.service?.name ?? 'servicio',
        startDateTime: declared.booking.startDateTime,
        amount: declared.amount,
        currency: declared.booking.business.currency || 'CLP',
        bookingNumber: declared.booking.bookingNumber,
      }),
    )
  }

  return { ok: true }
}
