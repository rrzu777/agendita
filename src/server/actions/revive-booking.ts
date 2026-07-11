'use server'

// NOTE: 'use server' — SOLO funciones async exportadas (helpers privados sin
// export). Flujo DUEÑA: revive una reserva `expired`. Es el ÚNICO camino de
// salida de `expired`: el mapa VALID_STATUS_TRANSITIONS del path genérico
// (bookings.ts) queda en [] a propósito (updateBookingStatus no sabe
// re-validar cupo).

import { addHours } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import type { BankTransferAccount } from '@prisma/client'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
  sendTransferReactivatedToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

// El EXCLUDE parcial Booking_no_overlap puede rechazar el update aun cuando el
// chequeo de solape pasó (p.ej. pending_payment con hold recién vencido que el
// assert considera libre, o confirm de turno pasado sin assert). Postgres tira
// 23P01; Prisma no lo mapea a un código conocido — detectamos por el nombre
// del constraint en message/meta.
function isNoOverlapViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const meta = (e as { meta?: unknown } | null)?.meta
  let metaStr = ''
  try {
    metaStr = JSON.stringify(meta ?? {})
  } catch {
    // meta puede traer BigInt u otros valores no serializables por JSON.stringify
    // (p.ej. counts de Postgres); no dejamos que eso enmascare el error original.
    metaStr = ''
  }
  return `${msg} ${metaStr}`.includes('Booking_no_overlap')
}

type ReviveResult =
  | { mode: 'confirm'; isFuture: boolean }
  | {
      mode: 'reopen'
      isFuture: boolean
      booking: {
        id: string
        bookingNumber: number | null
        depositRequired: number
        remainingBalance: number
        customer: { name: string; email: string | null } | null
        service: { name: string } | null
      }
      holdExpiresAt: Date
      account: BankTransferAccount
    }

export async function reviveBooking(
  bookingId: string,
  mode: 'confirm' | 'reopen',
): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('revive-booking', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  let result: ReviveResult
  try {
    result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId }, // guard cross-tenant
        include: {
          customer: true,
          service: true,
          business: { include: { bankTransferAccount: true } },
        },
      })
      if (!booking) throw new Error('Reserva no encontrada')
      if (booking.status !== 'expired') {
        throw new Error('Solo se puede revivir una reserva expirada')
      }

      const now = new Date()
      const isFuture = booking.startDateTime > now
      const timezone = business.timezone || 'America/Santiago'

      if (mode === 'confirm') {
        if (isFuture) {
          await assertSlotFreeOfConflicts({
            tx,
            businessId,
            startDateTime: booking.startDateTime,
            endDateTime: booking.endDateTime,
            timezone,
            excludeBookingId: booking.id,
          })
        }
        // Los Payments NO se tocan y la redemption de promo liberada al expirar
        // NO se re-reclama: la revivida mantiene el precio descontado que la
        // clienta aceptó, aceptando el posible sobre-uso del cap de la promo
        // (spec §1.4 — decisión de producto). El abono se registra después con
        // el flujo manual existente.
        const { count } = await tx.booking.updateMany({
          where: { id: bookingId, businessId, status: 'expired' }, // guard cross-tenant + CAS
          data: { status: 'confirmed', holdExpiresAt: null },
        })
        if (count === 0) throw new Error('Solo se puede revivir una reserva expirada')
        return { mode: 'confirm' as const, isFuture }
      }

      // mode === 'reopen': solo turno futuro + transferencia habilitada (v1 no
      // reabre MP: /book/confirmation no tiene CTA de pago MP — spec §5).
      if (!isFuture) throw new Error('El turno ya pasó: solo se puede confirmar.')
      const account = booking.business.bankTransferAccount
      if (booking.paymentMethod !== BANK_TRANSFER_METHOD || !account || !account.isEnabled) {
        throw new Error('Solo se puede dar nuevo plazo a reservas con transferencia bancaria habilitada.')
      }

      await assertSlotFreeOfConflicts({
        tx,
        businessId,
        startDateTime: booking.startDateTime,
        endDateTime: booking.endDateTime,
        timezone,
        excludeBookingId: booking.id,
      })

      const holdExpiresAt = addHours(now, account.holdHours)
      const { count } = await tx.booking.updateMany({
        where: { id: bookingId, businessId, status: 'expired' },
        data: {
          status: 'pending_payment',
          holdExpiresAt,
          // Rehabilitar el ciclo de recordatorios del cron (exigen flag null).
          transferReminderCustomerSentAt: null,
          transferReminderBusinessSentAt: null,
        },
      })
      if (count === 0) throw new Error('Solo se puede revivir una reserva expirada')

      // Matar los Payments MP viejos: sin esto deriveConfirmationState mostraría
      // "verifying" sin salida y el recordatorio-clienta quedaría bloqueado
      // (spec §2.3). El webhook MP es idempotente frente al cancelled local.
      await tx.payment.updateMany({
        where: { bookingId, provider: 'mercado_pago', status: 'pending' },
        data: { status: 'cancelled' },
      })

      return { mode: 'reopen' as const, isFuture, booking, holdExpiresAt, account }
    })
  } catch (e) {
    if (isNoOverlapViolation(e)) {
      throw new Error('Ese horario ya está ocupado por otra reserva.')
    }
    throw e
  }

  if (result.mode === 'confirm' && result.isFuture) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  if (result.mode === 'reopen' && result.booking.customer?.email) {
    const replyTo = await getBusinessReplyToEmail(businessId)
    const acct = result.account
    await sendNotificationSafely('transfer reactivated', () =>
      sendTransferReactivatedToCustomer({
        businessName: business.name,
        businessTimezone: business.timezone || 'America/Santiago',
        businessReplyToEmail: replyTo,
        customerName: result.booking.customer!.name,
        customerEmail: result.booking.customer!.email!,
        serviceName: result.booking.service?.name ?? 'servicio',
        bookingNumber: result.booking.bookingNumber,
        depositAmount: Math.min(result.booking.depositRequired, result.booking.remainingBalance),
        businessCurrency: business.currency || 'CLP',
        bankTransfer: {
          accountHolder: acct.accountHolder,
          rut: acct.rut,
          bankName: acct.bankName,
          accountType: acct.accountType,
          accountNumber: acct.accountNumber,
          email: acct.email,
          instructions: acct.instructions,
          deadline: result.holdExpiresAt, // el escrito en la tx — NO recalcular
          confirmationUrl: getBookingConfirmationUrl(business, bookingId),
        },
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
