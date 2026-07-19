'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Booking } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { getCurrentUser } from '@/lib/auth/user'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
import { logger } from '@/lib/logger'

import { assertSlotIsAvailable } from '@/lib/availability/validation'
import { assignBookingNumber } from '@/lib/bookings/number'
import { assertBusinessCanReceiveBookings } from '@/lib/subscriptions/enforcement'
import { normalizePhone } from '@/lib/customers/phone'
import { isValidBirthDateString, birthDateToUtcDate } from '@/lib/dates'
import { addMinutes } from 'date-fns'
import { applyPromotionInTx } from '@/lib/promotions/apply'
import { recomputeBookingAmountsAfterDiscount } from '@/lib/booking/recompute'
import { applyPackageInTx } from '@/lib/packages/consume'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { cancelBookingInTx, rescheduleBookingInTx } from '@/lib/bookings/mutate'
import { creditVisitPoints } from '@/lib/loyalty/credit'
import { emitAutomaticReward, loadAutomaticRules } from '@/lib/loyalty/automatic'
import { rewardReferralOnCompletion, captureReferral, notifyReferralReward } from '@/lib/loyalty/referral'
import { firstVisitKey, conditionKind } from '@/lib/loyalty/automatic-match'
import { type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { BANK_TRANSFER_METHOD, anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import type { BookingEmailData } from '@/lib/notifications/types'
import {
  sendBookingReceivedToCustomer,
  sendNewBookingNotificationToBusiness,
  sendBookingCancelledNotification,
  sendBookingConfirmedNotification,
  sendBookingRescheduledNotification,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerBirthDate: z.string().optional().or(z.literal(''))
    .refine((v) => !v || isValidBirthDateString(v), 'Fecha de cumpleaños inválida'),
  startDateTime: z.date(),
  idempotencyKey: z.string().min(1).max(64).optional(),
  acceptedTerms: z.boolean(),
  promotionCode: z.string().trim().max(40).optional(),
  skipPackage: z.boolean().optional(),
  paymentMethod: z.enum(['bank_transfer']).optional(),
})

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
})

const VALID_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
  // expired es terminal PARA ESTE PATH: la única salida es reviveBooking
  // (revive-booking.ts), que re-valida cupo antes de transicionar.
  expired: [],
}

async function fireBookingNotifications(
  business: {
    name: string
    timezone: string
    whatsapp: string | null
    addressText: string | null
    currency: string
    cancellationPolicy: string | null
    slug: string
    subdomain: string | null
  },
  booking: {
    customer: { name: string; phone: string; email: string | null }
    totalPrice: number
    discountAmount: number
    finalAmount: number
    depositRequired: number
    depositPaid: number
    remainingBalance: number
    startDateTime: Date
    paymentMethod: string | null
    holdExpiresAt: Date | null
  } & { id: string; businessId: string; bookingNumber: number | null },
  serviceName: string,
  // La cuenta ya la leyó createBooking antes de la tx; se pasa para no
  // re-consultar la misma fila (solo presente en reservas-transferencia).
  bankTransferAccount: BankTransferPublicInfo | null,
) {
  const customerEmail = booking.customer.email
  const businessTimezone = business.timezone || 'America/Santiago'
  const businessCurrency = business.currency || 'CLP'

  // Reserva con transferencia: el email de "reserva recibida" ES la fuente
  // durable de los datos bancarios (la pestaña del wizard es efímera).
  let bankTransfer: BookingEmailData['bankTransfer'] | undefined
  if (booking.paymentMethod === BANK_TRANSFER_METHOD && bankTransferAccount) {
    bankTransfer = {
      ...bankTransferAccount,
      deadline: booking.holdExpiresAt,
      confirmationUrl: getBookingConfirmationUrl({ slug: business.slug, subdomain: business.subdomain }, booking.id),
    }
  }

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || 'localhost:3000'
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const protocol = cleanDomain.startsWith('localhost') || cleanDomain.endsWith('.localhost') || cleanDomain.startsWith('127.0.0.1') ? 'http' : 'https'
  const dashboardLink = `${protocol}://${cleanDomain}/dashboard/bookings`
  const businessReplyToEmail = await getBusinessReplyToEmail(booking.businessId)

  const promises: Promise<unknown>[] = []

  if (customerEmail) {
    promises.push(
      sendNotificationSafely('customer received', () =>
        sendBookingReceivedToCustomer({
          businessName: business.name,
          bookingNumber: booking.bookingNumber,
          businessReplyToEmail,
          businessWhatsapp: business.whatsapp,
          businessAddress: business.addressText,
          businessTimezone,
          businessCurrency,
          businessCancellationPolicy: business.cancellationPolicy,
          customerName: booking.customer.name,
          customerEmail,
          customerPhone: booking.customer.phone,
          serviceName,
          startDateTime: booking.startDateTime,
          totalPrice: booking.totalPrice,
          discountAmount: booking.discountAmount,
          finalAmount: booking.finalAmount,
          depositRequired: booking.depositRequired,
          depositPaid: booking.depositPaid,
          remainingBalance: booking.remainingBalance,
          bankTransfer,
        }),
      ),
    )
  }

  promises.push(
    sendMultiNotificationSafely('business notification', () =>
      sendNewBookingNotificationToBusiness(booking.businessId, {
        businessName: business.name,
        bookingNumber: booking.bookingNumber,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        customerEmail: customerEmail || null,
        serviceName,
        startDateTime: booking.startDateTime,
        businessTimezone,
        businessCurrency,
        depositRequired: booking.depositRequired,
        remainingBalance: booking.remainingBalance,
        dashboardLink,
        paymentNote: booking.paymentMethod === BANK_TRANSFER_METHOD
          ? 'La clienta eligió pagar el abono por transferencia. Te va a llegar otro aviso cuando declare que transfirió.'
          : undefined,
      }),
    ),
  )

  await Promise.allSettled(promises)
}

// sendBookingConfirmedNotification is now centralized in @/lib/notifications

// Fragmento reusado por getBookings y getBookingsSummary: la declaración de
// transferencia pendiente de verificar, sea abono (bt-declared) o saldo
// (bt-balance). El array queda vacío salvo que haya una por verificar → deriva
// los badges y la sección del dashboard sin segunda query (el `kind` se
// distingue en el llamador por el prefijo de providerPaymentId, ver
// BT_BALANCE_PREFIX).
const declaredTransferPaymentsInclude = {
  where: anyDeclaredTransferWhere,
  select: { id: true, amount: true, createdAt: true, providerPaymentId: true, proofKey: true, proofContentType: true },
} as const

// Lista completa del historial con SOLO las columnas que consumen la página de
// Reservas (set pesado) y el diálogo de pago manual de Pagos (subset de
// ManualPaymentBooking). `select` explícito en vez de `include: { service:
// true, customer: true }`: antes traía todas las columnas de Booking/Service/
// Customer (internalNotes, reviewToken, timestamps…) para todo el historial.
// El resumen del dashboard usa getBookingsSummary (aún más angosto).
export async function getBookings() {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'desc' },
    select: {
      id: true,
      bookingNumber: true,
      startDateTime: true,
      status: true,
      depositPaid: true,
      depositRequired: true,
      finalAmount: true,
      paymentStatus: true,
      totalPrice: true,
      remainingBalance: true,
      paymentMethod: true,
      service: { select: { name: true } },
      customer: { select: { name: true, phone: true, email: true } },
      payments: declaredTransferPaymentsInclude,
    },
  })
}

// Versión liviana para el home del dashboard: solo lo que necesitan los conteos
// (hoy/próximas/total via .length y .filter), las 5 próximas citas y los
// predicados hasPendingDeclaredTransfer/hasPendingBalanceTransfer. Evita
// arrastrar las columnas de plata y las relaciones completas en la landing más
// caliente. Mismo where/orderBy que getBookings → mismo orden y conjunto.
export async function getBookingsSummary() {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: { businessId },
    orderBy: { startDateTime: 'desc' },
    select: {
      id: true,
      startDateTime: true,
      status: true,
      service: { select: { name: true } },
      customer: { select: { name: true } },
      payments: {
        where: anyDeclaredTransferWhere,
        select: { providerPaymentId: true },
      },
    },
  })
}

export async function createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  customerBirthDate?: string
  startDateTime: Date
  idempotencyKey?: string
  acceptedTerms: boolean
  promotionCode?: string
  skipPackage?: boolean
  referralToken?: string
  paymentMethod?: typeof BANK_TRANSFER_METHOD
}, businessId: string) {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  if (parsed.data.acceptedTerms !== true) {
    throw new Error('Debes aceptar los términos y condiciones y la política de cancelación')
  }

  // Validar que el negocio exista, esté activo y pueda recibir reservas
  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: {
      id: true,
      timezone: true,
      name: true,
      whatsapp: true,
      addressText: true,
      currency: true,
      cancellationPolicy: true,
      slug: true,
      subdomain: true,
      subscriptionStatus: true,
    },
  })
  if (!business) {
    throw new Error('Negocio no válido')
  }

  assertBusinessCanReceiveBookings(business.subscriptionStatus)

  // Validar que el servicio pertenezca al negocio
  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId, isActive: true },
  })
  if (!service) {
    throw new Error('Servicio no disponible')
  }

  // Recalcular precios y horario server-side
  const totalPrice = service.price
  const depositRequired = service.depositAmount
  const finalAmount = service.price
  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  // Transferencia bancaria: validar server-side que esté habilitada. El hold
  // largo (holdHours, default 24h) da la ventana para transferir y declarar
  // (spec transferencia §5.2). Solo aplica si el servicio requiere abono.
  // Se leen los campos públicos completos porque el email de reserva recibida
  // los reusa (se pasan a fireBookingNotifications sin re-consultar).
  let bankTransferAccount: BankTransferPublicInfo | null = null
  if (data.paymentMethod === BANK_TRANSFER_METHOD) {
    bankTransferAccount = await getBankTransferInfo(businessId)
    if (!bankTransferAccount) {
      throw new Error('Este negocio no tiene transferencia bancaria habilitada')
    }
  }

  // Vía 3 de vinculación (leer sesión ANTES de la tx: toca Supabase/cookies).
  const sessionUser = await getCurrentUser()

  // Idempotencia: si llega key, buscar booking existente fuera de tx (fast path).
  // El race final se maneja con el unique constraint de DB dentro de la tx.
  if (data.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey: data.idempotencyKey,
        },
      },
      include: { service: true, customer: true },
    })
    if (existing) {
      return existing
    }
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Validación transaccional de disponibilidad con lock
      await assertSlotIsAvailable({
        tx,
        businessId,
        serviceId: data.serviceId,
        startDateTime: data.startDateTime,
        endDateTime,
        timezone: business.timezone || 'America/Santiago',
      })

      // Buscar o crear cliente dentro de la transacción (matcher único por
      // teléfono; el link de sesión — vía 3 — vive en el helper).
      const { customer, created } = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
        birthDate: birthDateToUtcDate(data.customerBirthDate),
        sessionUser,
      })

      // Atribución de referida: SOLO clientas nuevas (recién creadas).
      if (created && data.referralToken) {
        await captureReferral(tx, {
          businessId,
          referredCustomerId: customer.id,
          referrerToken: data.referralToken,
          referredPhone: normalizePhone(data.customerPhone),
        })
      }

      const noDepositRequired = depositRequired <= 0
      const isFreeService = finalAmount <= 0

      const status = noDepositRequired ? BookingStatus.confirmed : BookingStatus.pending_payment
      const holdMinutes = bankTransferAccount && depositRequired > 0 ? bankTransferAccount.holdHours * 60 : 15
      const holdExpiresAt = status === BookingStatus.pending_payment ? addMinutes(new Date(), holdMinutes) : null
      const bookingPaymentStatus = isFreeService ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid

      const bookingNumber = await assignBookingNumber(tx, businessId)

      const booking = await tx.booking.create({
        data: {
          businessId,
          serviceId: data.serviceId,
          customerId: customer.id,
          startDateTime: data.startDateTime,
          endDateTime,
          status,
          totalPrice,
          depositRequired,
          depositPaid: 0,
          remainingBalance: finalAmount,
          finalAmount,
          paymentStatus: bookingPaymentStatus,
          holdExpiresAt,
          paymentMethod: bankTransferAccount && depositRequired > 0 ? BANK_TRANSFER_METHOD : null,
          idempotencyKey: data.idempotencyKey || null,
          bookingNumber,
        },
        include: {
          service: true,
          customer: true,
        },
      })

      // Aplicar promo por código (server-authoritative) dentro de la misma tx.
      // Si el código es inválido/agotado, applyPromotionInTx lanza y TODA la
      // transacción (booking + canje + incremento) hace rollback: no se crea reserva.
      // Precedencia: paquete prepago gana sobre código. Si aplica un paquete, se ignora
      // el código. applyPromotionInTx sigue lanzando si el código es inválido (rollback).
      let discount: { discountAmount: number } | null = null
      if (!data.skipPackage) {
        discount = await applyPackageInTx(tx, {
          businessId, customerId: customer.id, serviceId: data.serviceId,
          bookingId: booking.id, totalPrice: service.price, source: 'public_booking',
        })
      }
      if (!discount) {
        discount = await applyPromotionInTx(tx, {
          businessId,
          code: parsed.data.promotionCode,
          serviceId: data.serviceId,
          customerId: customer.id,
          totalPrice: service.price,
          bookingId: booking.id,
          source: 'public_booking',
        })
      }

      if (!discount) return booking

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: recomputeBookingAmountsAfterDiscount({
          price: service.price, depositAmount: service.depositAmount, discountAmount: discount.discountAmount,
          // Sin esto, una reserva-transferencia con promo perdería su ventana
          // de 24h: recompute re-derivaba el hold a +15min incondicionalmente.
          holdMinutes,
        }),
        include: { service: true, customer: true },
      })
      return updated
      // 15s: la tx hace lock de slot + upsert de cliente + creación de reserva +
      // aplicación de promo + update; el default de 5s queda corto cuando se aplica
      // un código (varias queries extra) o si la latencia a la DB es alta.
    }, { timeout: 15_000 })

    const bookingForNotification = booking as Booking & {
      service: { name: string }
      customer: { name: string; phone: string; email: string | null }
    }

    await fireBookingNotifications(business, bookingForNotification, service.name, bankTransferAccount)

    logger.booking.created(booking.id, businessId, booking.customer?.email ?? undefined)

    revalidatePath('/dashboard/bookings')
    await revalidateBusinessPublicPaths(businessId)
    return booking
  } catch (e: unknown) {
    // Race: otro request creó la misma idempotencyKey entre el findUnique y el create.
    // El unique constraint de DB lo detecta y devolvemos la reserva existente.
    const prismaError = e as { code?: string; meta?: { target?: string[] } }
    if (
      prismaError.code === 'P2002' &&
      data.idempotencyKey &&
      Array.isArray(prismaError.meta?.target) &&
      prismaError.meta.target.includes('businessId_idempotencyKey')
    ) {
      const existing = await prisma.booking.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: data.idempotencyKey,
          },
        },
        include: { service: true, customer: true },
      })
      if (existing) return existing
    }
    // Safe error handling: log internal error, return generic message
    const msg = e instanceof Error ? e.message : String(e)
    if (prismaError.code?.startsWith('P')) {
      logger.error('booking.error', `Database error in createBooking: ${msg}`, {
        businessId,
        metadata: { error: msg },
      })
      throw new Error('Error de base de datos. Por favor intenta nuevamente.')
    }
    throw e
  }
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const { businessId } = await requireBusiness()
  const limit = await checkRateLimit('update-booking-status', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.booking.findFirst({
    where: { id, businessId },
    include: {
      customer: { select: { name: true, email: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true } },
    },
  })
  if (!existing) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (!VALID_STATUS_TRANSITIONS[existing.status].includes(status)) {
    throw new ForbiddenError(`No se puede cambiar el estado de ${existing.status} a ${status}`)
  }

  // Al completar, generamos el token de reseña de inmediato para que el link
  // esté listo en el momento adecuado (sin un paso manual extra después).
  const completing = status === BookingStatus.completed && !existing.reviewToken
  const reviewTokenData = completing
    ? { reviewToken: crypto.randomUUID(), reviewTokenCreatedAt: new Date() }
    : {}

  // Config de fidelización (puede ser null si el negocio no la activó nunca).
  const loyaltyConfig =
    status === BookingStatus.completed
      ? await prisma.loyaltyConfig.findUnique({ where: { businessId } })
      : null

  // Pago revertido (chargeback/refund MP, spec FU-B4b-3 §7): completar está
  // permitido ("atender igual"), pero NO se acredita loyalty (visit points ni
  // emisiones automáticas) por una visita cuya plata se fue. Si la clienta
  // re-paga antes, el recalc ya limpió el marcador y esto no gatea.
  const paymentReverted = existing.paymentStatus === BookingPaymentStatus.refunded

  let isFirstVisit = false
  const updateResult = await prisma.$transaction(async (tx) => {
    // Guard por status esperado DENTRO de la tx (mismo patrón que
    // cancelBookingInTx/rescheduleBookingInTx en lib/bookings/mutate.ts): la
    // transición se validó recién sobre `existing.status`, pero entre ese read y
    // este write otra request pudo mover la reserva. Sin el `status` en el where,
    // un confirmed→completed lento pisaría una reserva ya cancelled y produciría
    // el inválido cancelled→completed. Con el guard, count===0 == carrera perdida.
    const res = await tx.booking.updateMany({
      where: { id, businessId, status: existing.status },
      data: { status, ...reviewTokenData },
    })
    if (
      res.count > 0 &&
      (status === BookingStatus.cancelled || status === BookingStatus.no_show)
    ) {
      await releaseRedemptionForBooking(
        tx,
        id,
        status === BookingStatus.cancelled ? 'cancelled' : 'no_show',
      )
      // Una reserva que muere (cancelled/no_show) no puede quedar con una
      // transferencia declarada "por verificar" eterna (spec §5-ter).
      // completed NO barre: pagar el saldo después de atendida es el caso de uso.
      await tx.payment.updateMany({
        where: { bookingId: id, ...anyDeclaredTransferWhere },
        data: { status: 'cancelled' },
      })
    }
    if (res.count > 0 && status === BookingStatus.completed && existing.customerId) {
      // Marca de primera/última completación (sirve a aniversario y win-back del cron).
      const prevCompleted = await tx.booking.count({
        where: { customerId: existing.customerId, status: BookingStatus.completed, id: { not: id } },
      })
      isFirstVisit = prevCompleted === 0
      const now = new Date()
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { lastCompletedAt: now, ...(isFirstVisit ? { firstCompletedAt: now } : {}) },
      })
      if (loyaltyConfig?.isActive && !paymentReverted) {
        await creditVisitPoints(tx, {
          businessId,
          customerId: existing.customerId,
          finalAmount: existing.finalAmount,
          bookingId: id,
          config: loyaltyConfig,
        })
      }
    }
    return res
  })
  if (updateResult.count === 0) {
    // La reserva existía (findFirst pasó); count 0 == el guard por status no
    // matcheó, i.e. otra request ya la transicionó entre el read y el write.
    throw new ForbiddenError('El estado de la reserva cambió. Recargá e intentá de nuevo.')
  }

  // R-EMIT: emisiones automáticas FUERA de la tx del evento (cada una en su propia tx, post-commit).
  if (status === BookingStatus.completed && existing.customerId && loyaltyConfig?.isActive && !paymentReverted) {
    const customerId = existing.customerId
    const emitCfg = {
      grantExpiryDays: loyaltyConfig.grantExpiryDays,
      forfeitGrantOnNoShow: loyaltyConfig.forfeitGrantOnNoShow,
    }
    const now = new Date()
    // Cargá las reglas automáticas UNA vez (fuera de tx); cada emisión abre su propia tx
    // post-commit solo si hay regla aplicable (evita transacciones vacías en el caso común).
    const autoRules = await loadAutomaticRules(prisma, businessId)
    const firstVisitRule = autoRules.find((r) => conditionKind(r.conditions) === 'first_visit')
    const referralRule = autoRules.find((r) => conditionKind(r.conditions) === 'referral')

    if (isFirstVisit && firstVisitRule) {
      try {
        await prisma.$transaction((tx) =>
          emitAutomaticReward(tx, {
            rule: firstVisitRule,
            businessId,
            customerId,
            dedupeKey: firstVisitKey(customerId),
            config: emitCfg,
            triggeringBookingId: id,
            now,
          }))
      } catch (e) {
        logger.error('loyalty.first_visit_emit_failed', `first_visit emit falló booking=${id}: ${String(e)}`)
      }
    }
    if (referralRule) {
      try {
        const referralResult = await prisma.$transaction((tx) =>
          rewardReferralOnCompletion(tx, {
            businessId,
            referredCustomerId: customerId,
            bookingId: id,
            rule: referralRule,
            config: emitCfg,
            now,
          }))
        // Email de recompensa de referido — best-effort, FUERA de la tx.
        if (referralResult) {
          await notifyReferralReward(referralResult, businessId)
        }
      } catch (e) {
        logger.error('loyalty.referral_emit_failed', `referral emit falló booking=${id}: ${String(e)}`)
      }
    }
  }

  if (status === BookingStatus.cancelled && existing.customer.email) {
    await sendNotificationSafely('cancellation', async () =>
      sendBookingCancelledNotification({
        businessName: existing.business.name,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        customerName: existing.customer.name,
        customerEmail: existing.customer.email,
        serviceName: existing.service.name,
        startDateTime: existing.startDateTime,
        businessTimezone: existing.business.timezone || 'America/Santiago',
      }),
    )
  }

  const updated = await prisma.booking.findUnique({ where: { id } })
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

/**
 * Flujo privado (dashboard): confirma/aplica un pago ya existente a una reserva.
 * Requiere sesión y rol owner/admin. Delega toda la lógica financiera a
 * applyApprovedPayment para garantizar consistencia e idempotencia.
 */
export async function confirmPayment(bookingId: string, paymentId: string, amount: number) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, paymentId, amount })
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva')
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, businessId },
  })
  if (!payment) throw new ForbiddenError('Pago no encontrado')
  if (payment.bookingId !== bookingId) throw new ForbiddenError('El pago no corresponde a esta reserva')
  if (payment.amount !== amount) throw new ForbiddenError('El monto no coincide con el pago registrado')

  let wasConfirmed = false

  const updated = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    const result = await applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    })
    wasConfirmed = result.wasConfirmed
    return result.booking
  })

  if (updated && wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export async function getBookingsByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()

  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new Error('Rango de fechas inválido')
  }
  if (start > end) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de término')
  }

  return prisma.booking.findMany({
    where: {
      businessId,
      startDateTime: { gte: start, lte: end },
    },
    orderBy: { startDateTime: 'asc' },
    include: {
      service: true,
      customer: true,
    },
  })
}

const createBookingFromDashboardSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerBirthDate: z.string().optional().or(z.literal(''))
    .refine((v) => !v || isValidBirthDateString(v), 'Fecha de cumpleaños inválida'),
  startDateTime: z.date(),
  internalNotes: z.string().max(500).optional(),
  markDepositPaid: z.boolean().optional().default(false),
  paymentMode: z.enum(['none', 'deposit_paid', 'full_paid']).optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'external_card', 'other']).optional(),
  customerId: z.string().min(1).optional(),
  promotionCode: z.string().trim().max(40).optional(),
  skipPackage: z.boolean().optional(),
})

const PAYMENT_METHOD_MAP: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  external_card: 'Tarjeta externa',
  other: 'Otro',
}

export async function createBookingFromDashboard(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  customerBirthDate?: string
  startDateTime: Date
  internalNotes?: string
  markDepositPaid?: boolean
  paymentMode?: 'none' | 'deposit_paid' | 'full_paid'
  paymentMethod?: string
  customerId?: string
  promotionCode?: string
  skipPackage?: boolean
}) {
  const { user, business, businessId } = await requireBusinessRole(['owner', 'admin'])

  // A suspended/cancelled business must not accept new bookings through any path,
  // including manual dashboard creation (mirrors the public createBooking flow).
  assertBusinessCanReceiveBookings(business.subscriptionStatus)

  const parsed = createBookingFromDashboardSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId, isActive: true },
  })
  if (!service) {
    throw new Error('Servicio no disponible')
  }

  const totalPrice = service.price
  const depositRequired = service.depositAmount
  const finalAmount = service.price
  const endDateTime = addMinutes(data.startDateTime, service.durationMinutes)

  // Derive payment mode: new explicit mode takes precedence, fallback to legacy markDepositPaid
  const rawPaymentMode = data.paymentMode
  const markDepositPaid = data.markDepositPaid ?? false
  const paymentMode: 'none' | 'deposit_paid' | 'full_paid' =
    rawPaymentMode ?? (markDepositPaid ? 'deposit_paid' : 'none')

  const paymentMethod = data.paymentMethod ?? 'other'
  const displayMethod = PAYMENT_METHOD_MAP[paymentMethod] ?? paymentMethod

  // Validate paymentMethod when creating a payment
  if ((paymentMode === 'deposit_paid' || paymentMode === 'full_paid') && !data.paymentMethod) {
    throw new Error('Método de pago requerido')
  }

  // Reject deposit_paid when service has no required deposit
  if (paymentMode === 'deposit_paid' && depositRequired <= 0) {
    throw new Error('No se requiere abono para este servicio. Usa modo "Sin pago" o "Pago total".')
  }

  const noDepositNeeded = depositRequired <= 0
  const isFreeService = finalAmount <= 0

  // Payment mode determines if booking starts confirmed
  const shouldConfirm = paymentMode === 'full_paid' || paymentMode === 'deposit_paid' || noDepositNeeded

  const status = shouldConfirm ? BookingStatus.confirmed : BookingStatus.pending_payment

  const initialPaymentStatus = isFreeService
    ? BookingPaymentStatus.fully_paid
    : BookingPaymentStatus.unpaid

  const booking = await prisma.$transaction(async (tx) => {
    await assertSlotIsAvailable({
      tx,
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      endDateTime,
      timezone: business.timezone || 'America/Santiago',
      // La dueña puede anotar walk-ins que empiezan ahora mismo
      leadTimeMinutes: 0,
    })

    let customer: { id: string; name: string; phone: string; email: string | null }

    if (data.customerId) {
      const existing = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      })
      if (!existing) {
        throw new Error('Cliente no encontrado')
      }
      customer = existing
    } else {
      const result = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
        birthDate: birthDateToUtcDate(data.customerBirthDate),
      })
      customer = result.customer
    }

    const bookingNumber = await assignBookingNumber(tx, businessId)

    const newBooking = await tx.booking.create({
      data: {
        businessId,
        serviceId: data.serviceId,
        customerId: customer.id,
        startDateTime: data.startDateTime,
        endDateTime,
        status,
        totalPrice,
        depositRequired,
        depositPaid: 0,
        remainingBalance: finalAmount,
        finalAmount,
        paymentStatus: initialPaymentStatus,
        internalNotes: data.internalNotes || null,
        holdExpiresAt: status === BookingStatus.pending_payment ? addMinutes(new Date(), 60) : null,
        bookingNumber,
      },
      include: { service: true, customer: true },
    })

    // Aplicar promo por código (server-authoritative) dentro de la misma tx.
    // Si el código es inválido/agotado, applyPromotionInTx lanza y TODA la
    // transacción (booking + canje + incremento + pagos) hace rollback.
    // Precedencia: paquete prepago gana sobre código.
    let discountRes: { discountAmount: number } | null = null
    if (!data.skipPackage) {
      discountRes = await applyPackageInTx(tx, {
        businessId, customerId: customer.id, serviceId: data.serviceId,
        bookingId: newBooking.id, totalPrice: service.price, source: 'dashboard_booking',
        createdByUserId: user.id,
      })
    }
    if (!discountRes) {
      discountRes = await applyPromotionInTx(tx, {
        businessId,
        code: parsed.data.promotionCode,
        serviceId: data.serviceId,
        customerId: customer.id,
        totalPrice: service.price,
        bookingId: newBooking.id,
        source: 'dashboard_booking',
        createdByUserId: user.id,
      })
    }

    // Montos efectivos: descontados cuando aplicó una promo, precio total si no.
    const discountAmount = discountRes?.discountAmount ?? 0
    const effFinal = service.price - discountAmount
    const effDeposit = Math.min(service.depositAmount, effFinal)

    // Si aplicó una promo, persistir el descuento y recalcular estado/montos con
    // los valores EFECTIVOS ANTES de las ramas de pago, porque applyApprovedPayment
    // recalcula remainingBalance/paymentStatus a partir del booking.finalAmount /
    // booking.depositRequired ya persistidos.
    let bookingResult = newBooking
    if (discountRes) {
      const effNoDeposit = effDeposit <= 0
      const effFree = effFinal <= 0
      // Mantener la semántica actual: full_paid/deposit_paid o sin abono => confirmed.
      const effShouldConfirm = paymentMode === 'full_paid' || paymentMode === 'deposit_paid' || effNoDeposit
      const effStatus = effShouldConfirm ? BookingStatus.confirmed : BookingStatus.pending_payment
      const effPaymentStatus = effFree ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid
      const effHold = effStatus === BookingStatus.pending_payment ? addMinutes(new Date(), 60) : null
      bookingResult = await tx.booking.update({
        where: { id: newBooking.id },
        data: {
          discountAmount,
          finalAmount: effFinal,
          depositRequired: effDeposit,
          remainingBalance: effFinal,
          status: effStatus,
          paymentStatus: effPaymentStatus,
          holdExpiresAt: effHold,
        },
        include: { service: true, customer: true },
      })
    }

    if (paymentMode === 'deposit_paid' && effDeposit > 0) {
      const { applyApprovedPayment } = await import('@/server/services/finance')

      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.deposit,
          provider: 'manual',
          providerPaymentId: null,
          amount: effDeposit,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: effDeposit,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    if (paymentMode === 'full_paid' && effFinal > 0) {
      const { applyApprovedPayment } = await import('@/server/services/finance')

      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.full_payment,
          provider: 'manual',
          providerPaymentId: null,
          amount: effFinal,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: effFinal,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.full_payment,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    return bookingResult
    // 15s: la tx hace creación de reserva + aplicación de promo + creación de pago
    // + applyApprovedPayment (con upserts de ledger); el default de 5s queda corto.
  }, { timeout: 15_000 })

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)

  return booking
}

export async function cancelBooking(bookingId: string, reason?: string) {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true, customer: true },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (booking.status === 'completed') {
    throw new Error('No se puede cancelar una reserva ya completada')
  }

  if (booking.status === 'cancelled') {
    throw new Error('Esta reserva ya está cancelada')
  }

  await prisma.$transaction(async (tx) => {
    await cancelBookingInTx(tx, booking, { reason })
  })

  if (booking.customer?.email) {
    await sendNotificationSafely('booking cancelled', async () =>
      sendBookingCancelledNotification({
        businessName: business.name,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email,
        serviceName: booking.service!.name,
        startDateTime: booking.startDateTime,
        businessTimezone: business.timezone || 'America/Santiago',
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { cancelled: true }
}

export async function rescheduleBooking(bookingId: string, newStartDateTime: Date) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true, customer: true },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  if (['completed', 'cancelled', 'no_show', 'expired'].includes(booking.status)) {
    throw new Error('No se puede reprogramar una reserva en este estado')
  }

  const service = booking.service
  if (!service) {
    throw new Error('Servicio no encontrado')
  }

  const previousStartDateTime = booking.startDateTime

  await prisma.$transaction(async (tx) => {
    await rescheduleBookingInTx(tx, {
      booking,
      newStartDateTime,
      durationMinutes: service.durationMinutes,
      timezone: business.timezone || 'America/Santiago',
      // Reagendar desde el dashboard no exige anticipación (la dueña manda)
      leadTimeMinutes: 0,
    })
  })

  if (booking.customer?.email) {
    await sendNotificationSafely('booking rescheduled', async () =>
      sendBookingRescheduledNotification({
        businessName: business.name,
        bookingNumber: booking.bookingNumber,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        businessWhatsapp: business.whatsapp,
        businessAddress: business.addressText,
        businessTimezone: business.timezone || 'America/Santiago',
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email,
        customerPhone: booking.customer!.phone,
        serviceName: service.name,
        previousStartDateTime,
        newStartDateTime,
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { rescheduled: true }
}
