import { addHours, subHours } from 'date-fns'
import { BookingStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BANK_TRANSFER_METHOD, declaredTransferPaymentWhere, declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import {
  getBusinessReplyToEmail,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendTransferReminderToCustomer,
  sendTransferReminderToBusiness,
  sendPackageTransferReminderToCustomer,
  sendPackageTransferUnverifiedToBusiness,
} from '@/lib/notifications'
import { getBookingConfirmationUrl, getPackageConfirmationUrl } from '@/lib/business/urls'
import { toBankTransferEmailInfo } from '@/lib/notifications/types'
import { logger } from '@/lib/logger'

// Ventanas del recordatorio (no son 'use server', pueden ser constantes del módulo).
export const CUSTOMER_REMINDER_HOURS_BEFORE_HOLD = 3
export const BUSINESS_REMINDER_HOURS_BEFORE_VERIFY = 6
export const BUSINESS_REMINDER_HOURS_AFTER_DECLARE = 24

export interface TransferRemindersResult {
  customerSent: number
  businessSent: number
  packageCustomerSent: number
  packageBusinessSent: number
  skipped: number
  errors: number
}

interface Deps {
  sendCustomer: typeof sendTransferReminderToCustomer
  sendBusiness: typeof sendTransferReminderToBusiness
  sendPkgCustomer: typeof sendPackageTransferReminderToCustomer
  sendPkgBusiness: typeof sendPackageTransferUnverifiedToBusiness
}

type ReminderField = 'transferReminderCustomerSentAt' | 'transferReminderBusinessSentAt'

/** Libera el claim (revierte el flag a null) cuando el envío no pudo concretarse. */
async function releaseReminderClaim(db: Pick<PrismaClient, 'booking'>, id: string, field: ReminderField, now: Date) {
  await db.booking.updateMany({ where: { id, [field]: now }, data: { [field]: null } })
}

/** Ídem para compras de paquete (mismos nombres de flag, otra tabla). */
async function releasePkgReminderClaim(
  db: Pick<PrismaClient, 'packagePurchase'>, id: string, field: ReminderField, now: Date,
) {
  await db.packagePurchase.updateMany({ where: { id, [field]: now }, data: { [field]: null } })
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
 * transferir" a quien recién declaró / "verificá" a quien recién verificó. Cada
 * rama: reclamar (secuencial, updates por PK baratos) → resolver reply-to una vez
 * por negocio → enviar en paralelo (Promise.all), liberando el claim si falla.
 */
export async function sendTransferReminders(
  now = new Date(),
  db: Pick<PrismaClient, 'booking' | 'packagePurchase'> = prisma,
  deps: Deps = {
    sendCustomer: sendTransferReminderToCustomer,
    sendBusiness: sendTransferReminderToBusiness,
    sendPkgCustomer: sendPackageTransferReminderToCustomer,
    sendPkgBusiness: sendPackageTransferUnverifiedToBusiness,
  },
): Promise<TransferRemindersResult> {
  const result: TransferRemindersResult = {
    customerSent: 0, businessSent: 0, packageCustomerSent: 0, packageBusinessSent: 0, skipped: 0, errors: 0,
  }

  // ---- Clienta (pre-declaración) ----
  const customerWhere = {
    status: BookingStatus.pending_payment,
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

  // Fase 1: reclamar (CAS con where COMPLETO) los que siguen elegibles y con datos completos.
  const customerClaimed: typeof customerBookings = []
  for (const b of customerBookings) {
    if (!b.customer?.email || !b.business.bankTransferAccount || !b.holdExpiresAt) {
      result.skipped++
      continue
    }
    const claim = await db.booking.updateMany({
      where: { id: b.id, ...customerWhere },
      data: { transferReminderCustomerSentAt: now },
    })
    if (claim.count === 0) {
      result.skipped++
      continue
    }
    customerClaimed.push(b)
  }

  // Fase 2: reply-to una vez por negocio distinto (evita N+1 sobre businessUser).
  const replyToByBiz = new Map<string, string | null>()
  await Promise.all(
    [...new Set(customerClaimed.map((b) => b.business.id))].map(async (id) => {
      replyToByBiz.set(id, await getBusinessReplyToEmail(id))
    }),
  )

  // Fase 3: enviar en paralelo; liberar el claim si el envío no se concreta.
  await Promise.all(
    customerClaimed.map(async (b) => {
      const acct = b.business.bankTransferAccount!
      try {
        const res = await sendNotificationSafely('transfer reminder customer', () =>
          deps.sendCustomer({
            businessName: b.business.name,
            businessTimezone: b.business.timezone || 'America/Santiago',
            customerName: b.customer!.name,
            serviceName: b.service?.name ?? 'servicio',
            depositAmount: Math.min(b.depositRequired, b.remainingBalance),
            businessCurrency: b.business.currency || 'CLP',
            bankTransfer: toBankTransferEmailInfo(acct, b.holdExpiresAt!, getBookingConfirmationUrl(b.business, b.id)),
            bookingNumber: b.bookingNumber,
            customerEmail: b.customer!.email!,
            businessReplyToEmail: replyToByBiz.get(b.business.id) ?? null,
          }),
        )
        if (res.success) result.customerSent++
        else {
          await releaseReminderClaim(db, b.id, 'transferReminderCustomerSentAt', now)
          result.skipped++
        }
      } catch {
        await releaseReminderClaim(db, b.id, 'transferReminderCustomerSentAt', now)
        logger.error('transfer_reminder.customer.failed', b.id)
        result.errors++
      }
    }),
  )

  // ---- Dueña (declarada sin verificar) ----
  const businessWhere = {
    status: BookingStatus.pending_payment,
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

  // Fase 1: reclamar.
  const businessClaimed: typeof businessBookings = []
  for (const b of businessBookings) {
    const claim = await db.booking.updateMany({
      where: { id: b.id, ...businessWhere },
      data: { transferReminderBusinessSentAt: now },
    })
    if (claim.count === 0) {
      result.skipped++
      continue
    }
    businessClaimed.push(b)
  }

  // Fase 2: enviar en paralelo (cada email es per-booking; el sender resuelve los owners).
  await Promise.all(
    businessClaimed.map(async (b) => {
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
          await releaseReminderClaim(db, b.id, 'transferReminderBusinessSentAt', now)
          result.skipped++
        }
      } catch {
        await releaseReminderClaim(db, b.id, 'transferReminderBusinessSentAt', now)
        logger.error('transfer_reminder.business.failed', b.id)
        result.errors++
      }
    }),
  )

  // ---- Paquetes: clienta (eligió transferencia, no declaró, hold por vencer) ----
  const pkgCustomerWhere = {
    status: 'pending',
    source: 'online',
    paymentMethod: 'Transferencia',
    transferReminderCustomerSentAt: null,
    holdExpiresAt: { gt: now, lte: addHours(now, CUSTOMER_REMINDER_HOURS_BEFORE_HOLD) },
    // Espejo del where de reservas: ni declarada ni con un MP en vuelo.
    payments: { none: { OR: [declaredPkgTransferPaymentWhere, { provider: 'mercado_pago', status: 'pending' }] } },
    business: { bankTransferAccount: { isEnabled: true, holdHours: { gt: CUSTOMER_REMINDER_HOURS_BEFORE_HOLD } } },
  } satisfies Prisma.PackagePurchaseWhereInput
  const pkgCustomer = await db.packagePurchase.findMany({
    where: pkgCustomerWhere,
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true, email: true } },
      business: {
        select: {
          id: true, name: true, timezone: true, currency: true, slug: true, subdomain: true,
          bankTransferAccount: true,
        },
      },
    },
  })
  const pkgCustomerClaimed: typeof pkgCustomer = []
  for (const p of pkgCustomer) {
    if (!p.customer?.email || !p.business.bankTransferAccount || !p.holdExpiresAt) {
      result.skipped++
      continue
    }
    const claim = await db.packagePurchase.updateMany({
      where: { id: p.id, ...pkgCustomerWhere },
      data: { transferReminderCustomerSentAt: now },
    })
    if (claim.count === 0) { result.skipped++; continue }
    pkgCustomerClaimed.push(p)
  }
  // Reusa el mapa de reply-to de la rama reservas: solo resuelve negocios nuevos.
  await Promise.all(
    [...new Set(pkgCustomerClaimed.map((p) => p.business.id))]
      .filter((id) => !replyToByBiz.has(id))
      .map(async (id) => { replyToByBiz.set(id, await getBusinessReplyToEmail(id)) }),
  )
  await Promise.all(
    pkgCustomerClaimed.map(async (p) => {
      const acct = p.business.bankTransferAccount!
      try {
        const res = await sendNotificationSafely('package transfer reminder customer', () =>
          deps.sendPkgCustomer({
            businessName: p.business.name,
            businessTimezone: p.business.timezone || 'America/Santiago',
            customerName: p.customer.name,
            productName: p.product.name,
            amount: p.pricePaid,
            businessCurrency: p.business.currency || 'CLP',
            bankTransfer: toBankTransferEmailInfo(acct, p.holdExpiresAt!, getPackageConfirmationUrl(p.business, p.id)),
            customerEmail: p.customer.email!,
            businessReplyToEmail: replyToByBiz.get(p.business.id) ?? null,
          }),
        )
        if (res.success) result.packageCustomerSent++
        else {
          await releasePkgReminderClaim(db, p.id, 'transferReminderCustomerSentAt', now)
          result.skipped++
        }
      } catch {
        await releasePkgReminderClaim(db, p.id, 'transferReminderCustomerSentAt', now)
        logger.error('transfer_reminder.package_customer.failed', p.id)
        result.errors++
      }
    }),
  )

  // ---- Paquetes: dueña (declarada envejecida sin verificar) ----
  // Un paquete declarado no tiene verify-deadline (el sweep lo exime y el hold no
  // se extiende al declarar): sólo existe la rama "declaró hace >= 24h".
  const pkgBusinessWhere = {
    status: 'pending',
    transferReminderBusinessSentAt: null,
    payments: { some: { ...declaredPkgTransferPaymentWhere, createdAt: { lte: subHours(now, BUSINESS_REMINDER_HOURS_AFTER_DECLARE) } } },
  } satisfies Prisma.PackagePurchaseWhereInput
  const pkgBusiness = await db.packagePurchase.findMany({
    where: pkgBusinessWhere,
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true } },
      business: { select: { id: true, name: true } },
    },
  })
  const pkgBusinessClaimed: typeof pkgBusiness = []
  for (const p of pkgBusiness) {
    const claim = await db.packagePurchase.updateMany({
      where: { id: p.id, ...pkgBusinessWhere },
      data: { transferReminderBusinessSentAt: now },
    })
    if (claim.count === 0) { result.skipped++; continue }
    pkgBusinessClaimed.push(p)
  }
  await Promise.all(
    pkgBusinessClaimed.map(async (p) => {
      try {
        const results = await sendMultiNotificationSafely('package transfer unverified business', () =>
          deps.sendPkgBusiness(p.business.id, {
            businessName: p.business.name,
            customerName: p.customer?.name ?? 'la clienta',
            productName: p.product.name,
          }),
        )
        if (results.some((r) => r.success)) result.packageBusinessSent++
        else {
          await releasePkgReminderClaim(db, p.id, 'transferReminderBusinessSentAt', now)
          result.skipped++
        }
      } catch {
        await releasePkgReminderClaim(db, p.id, 'transferReminderBusinessSentAt', now)
        logger.error('transfer_reminder.package_business.failed', p.id)
        result.errors++
      }
    }),
  )

  return result
}
