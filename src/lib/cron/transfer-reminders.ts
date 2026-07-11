import { addHours, subHours } from 'date-fns'
import { type Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BANK_TRANSFER_METHOD, declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  getBusinessReplyToEmail,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendTransferReminderToCustomer,
  sendTransferReminderToBusiness,
} from '@/lib/notifications'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import { fmtCurrency } from '@/lib/notifications/templates'
import { logger } from '@/lib/logger'

// Ventanas del recordatorio (no son 'use server', pueden ser constantes del módulo).
export const CUSTOMER_REMINDER_HOURS_BEFORE_HOLD = 3
export const BUSINESS_REMINDER_HOURS_BEFORE_VERIFY = 6
export const BUSINESS_REMINDER_HOURS_AFTER_DECLARE = 24

export interface TransferRemindersResult {
  customerSent: number
  businessSent: number
  skipped: number
  errors: number
}

interface Deps {
  sendCustomer: typeof sendTransferReminderToCustomer
  sendBusiness: typeof sendTransferReminderToBusiness
}

/**
 * Recordatorios intermedios de transferencia (best-effort, disparados por el cron
 * horario). Dos ramas independientes con compare-and-swap de where COMPLETO:
 *  (1) empuja a la clienta que eligió transferencia y no declaró antes de que
 *      venza el hold;
 *  (2) empuja a la dueña a verificar una transferencia declarada que envejece
 *      (incluye el caso verifyHours=null → hold NULL + Payment viejo).
 *
 * El claim re-afirma el where entero (no solo el flag) para no mandar "andá a
 * transferir" a quien recién declaró / "verificá" a quien recién verificó.
 */
export async function sendTransferReminders(
  now = new Date(),
  db: Pick<PrismaClient, 'booking'> = prisma,
  deps: Deps = { sendCustomer: sendTransferReminderToCustomer, sendBusiness: sendTransferReminderToBusiness },
): Promise<TransferRemindersResult> {
  const result: TransferRemindersResult = { customerSent: 0, businessSent: 0, skipped: 0, errors: 0 }

  // ---- Clienta (pre-declaración) ----
  const customerWhere = {
    status: 'pending_payment' as const,
    paymentStatus: 'unpaid' as const,
    paymentMethod: BANK_TRANSFER_METHOD,
    transferReminderCustomerSentAt: null,
    holdExpiresAt: { gt: now, lte: addHours(now, CUSTOMER_REMINDER_HOURS_BEFORE_HOLD) },
    payments: { none: { OR: [declaredTransferPaymentWhere, { provider: 'mercado_pago', status: 'pending' }] } },
    business: { bankTransferAccount: { isEnabled: true, holdHours: { gt: CUSTOMER_REMINDER_HOURS_BEFORE_HOLD } } },
  } satisfies Prisma.BookingWhereInput
  const customerBookings = await db.booking.findMany({
    where: customerWhere,
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: {
        select: {
          id: true, name: true, timezone: true, currency: true, slug: true, subdomain: true,
          bankTransferAccount: true,
        },
      },
    },
  })
  for (const b of customerBookings) {
    if (!b.customer?.email || !b.business.bankTransferAccount || !b.holdExpiresAt) {
      result.skipped++
      continue
    }
    // CAS con where COMPLETO (re-afirma sin declarar / sin MP pending / hold vigente / etc.).
    const claim = await db.booking.updateMany({
      where: { id: b.id, ...customerWhere },
      data: { transferReminderCustomerSentAt: now },
    })
    if (claim.count === 0) {
      result.skipped++
      continue
    }
    const acct = b.business.bankTransferAccount
    const depositLabel = fmtCurrency(Math.min(b.depositRequired, b.remainingBalance), b.business.currency || 'CLP')
    try {
      const res = await sendNotificationSafely('transfer reminder customer', async () =>
        deps.sendCustomer({
          businessName: b.business.name,
          businessTimezone: b.business.timezone || 'America/Santiago',
          customerName: b.customer!.name,
          serviceName: b.service?.name ?? 'servicio',
          depositLabel,
          bankTransfer: {
            accountHolder: acct.accountHolder,
            rut: acct.rut,
            bankName: acct.bankName,
            accountType: acct.accountType,
            accountNumber: acct.accountNumber,
            email: acct.email,
            instructions: acct.instructions,
            deadline: b.holdExpiresAt,
            confirmationUrl: getBookingConfirmationUrl(b.business, b.id),
          },
          bookingNumber: b.bookingNumber,
          customerEmail: b.customer!.email!,
          businessReplyToEmail: await getBusinessReplyToEmail(b.business.id),
        }),
      )
      if (res.success) result.customerSent++
      else {
        await releaseCustomer(db, b.id, now)
        result.skipped++
      }
    } catch {
      await releaseCustomer(db, b.id, now)
      logger.error('transfer_reminder.customer.failed', b.id)
      result.errors++
    }
  }

  // ---- Dueña (declarada sin verificar) ----
  const businessWhere = {
    status: 'pending_payment' as const,
    transferReminderBusinessSentAt: null,
    OR: [
      {
        holdExpiresAt: { gt: now, lte: addHours(now, BUSINESS_REMINDER_HOURS_BEFORE_VERIFY) },
        payments: { some: declaredTransferPaymentWhere },
      },
      {
        holdExpiresAt: null,
        payments: { some: { ...declaredTransferPaymentWhere, createdAt: { lte: subHours(now, BUSINESS_REMINDER_HOURS_AFTER_DECLARE) } } },
      },
    ],
  } satisfies Prisma.BookingWhereInput
  const businessBookings = await db.booking.findMany({
    where: businessWhere,
    include: {
      service: { select: { name: true } },
      customer: { select: { name: true } },
      business: { select: { id: true, name: true } },
    },
  })
  for (const b of businessBookings) {
    const claim = await db.booking.updateMany({
      where: { id: b.id, ...businessWhere },
      data: { transferReminderBusinessSentAt: now },
    })
    if (claim.count === 0) {
      result.skipped++
      continue
    }
    try {
      const results = await sendMultiNotificationSafely('transfer reminder business', () =>
        deps.sendBusiness(b.business.id, {
          businessName: b.business.name,
          customerName: b.customer?.name ?? 'la clienta',
          serviceName: b.service?.name ?? 'servicio',
          bookingNumber: b.bookingNumber,
        }),
      )
      if (results.some((r) => r.success)) result.businessSent++
      else {
        await releaseBusiness(db, b.id, now)
        result.skipped++
      }
    } catch {
      await releaseBusiness(db, b.id, now)
      logger.error('transfer_reminder.business.failed', b.id)
      result.errors++
    }
  }

  return result
}

async function releaseCustomer(db: Pick<PrismaClient, 'booking'>, id: string, now: Date) {
  await db.booking.updateMany({
    where: { id, transferReminderCustomerSentAt: now },
    data: { transferReminderCustomerSentAt: null },
  })
}

async function releaseBusiness(db: Pick<PrismaClient, 'booking'>, id: string, now: Date) {
  await db.booking.updateMany({
    where: { id, transferReminderBusinessSentAt: now },
    data: { transferReminderBusinessSentAt: null },
  })
}
