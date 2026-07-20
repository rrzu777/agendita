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
import { PaymentStatus, type BankTransferAccount } from '@prisma/client'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
  sendTransferReactivatedToCustomer,
  getBusinessReplyToEmail,
} from '@/lib/notifications'
import { toBankTransferEmailInfo } from '@/lib/notifications/types'
import { action, UserError } from '@/lib/actions/result'

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
      // reopen implica turno futuro (guard en la tx), por eso no carga isFuture.
      mode: 'reopen'
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

async function _reviveBooking(bookingId: string, mode: 'confirm' | 'reopen'): Promise<void> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('revive-booking', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const timezone = business.timezone || 'America/Santiago'

  let result: ReviveResult
  try {
    result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId }, // guard cross-tenant
        include: {
          // Solo lo que consume el reopen/email; el confirm usa los escalares.
          customer: { select: { name: true, email: true } },
          service: { select: { name: true } },
          business: { select: { bankTransferAccount: true } },
        },
      })
      if (!booking) throw new UserError('Reserva no encontrada')
      if (booking.status !== 'expired') {
        throw new UserError('Solo se puede revivir una reserva expirada')
      }

      const now = new Date()
      const isFuture = booking.startDateTime > now

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
        if (count === 0) throw new UserError('Solo se puede revivir una reserva expirada')
        return { mode: 'confirm' as const, isFuture }
      }

      // mode === 'reopen': solo turno futuro + transferencia habilitada (v1 no
      // reabre MP: /book/confirmation no tiene CTA de pago MP — spec §5).
      if (!isFuture) throw new UserError('El turno ya pasó: solo se puede confirmar.')
      const account = booking.business.bankTransferAccount
      if (booking.paymentMethod !== BANK_TRANSFER_METHOD || !account || !account.isEnabled) {
        throw new UserError('Solo se puede dar nuevo plazo a reservas con transferencia bancaria habilitada.')
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
      if (count === 0) throw new UserError('Solo se puede revivir una reserva expirada')

      // Matar los Payments MP viejos: sin esto deriveConfirmationState mostraría
      // "verifying" sin salida y el recordatorio-clienta quedaría bloqueado
      // (spec §2.3). El webhook MP es idempotente frente al cancelled local.
      await tx.payment.updateMany({
        where: { bookingId, provider: 'mercado_pago', status: PaymentStatus.pending },
        data: { status: PaymentStatus.cancelled },
      })

      return { mode: 'reopen' as const, booking, holdExpiresAt, account }
    })
  } catch (e) {
    if (isNoOverlapViolation(e)) {
      throw new UserError('Ese horario ya está ocupado por otra reserva.')
    }
    throw e
  }

  if (result.mode === 'confirm' && result.isFuture) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  if (result.mode === 'reopen') {
    const { booking: revived, account, holdExpiresAt } = result
    const customer = revived.customer
    if (customer?.email) {
      const customerEmail = customer.email
      const replyTo = await getBusinessReplyToEmail(businessId)
      await sendNotificationSafely('transfer reactivated', () =>
        sendTransferReactivatedToCustomer({
          businessName: business.name,
          businessTimezone: timezone,
          businessReplyToEmail: replyTo,
          customerName: customer.name,
          customerEmail,
          serviceName: revived.service?.name ?? 'servicio',
          bookingNumber: revived.bookingNumber,
          depositAmount: Math.min(revived.depositRequired, revived.remainingBalance),
          businessCurrency: business.currency || 'CLP',
          // deadline = el holdExpiresAt escrito en la tx — NO recalcular.
          bankTransfer: toBankTransferEmailInfo(account, holdExpiresAt, getBookingConfirmationUrl(business, bookingId)),
        }),
      )
    }
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
}

export const reviveBooking = action(_reviveBooking)
