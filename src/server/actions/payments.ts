'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import {
  getDefaultProvider,
  resolveOnlinePaymentAvailability,
  getOnlinePaymentProviderForBusiness,
  resolveOnlinePaymentAvailabilityForBusiness,
} from '@/lib/payments/factory'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { createMpPreferenceForPayment, getPaymentAppUrl } from '@/lib/payments/create-preference'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { sendBookingConfirmedNotification, sendNotificationSafely } from '@/lib/notifications'
import { logger } from '@/lib/logger'

const initiatePaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive().optional(),
  currency: z.string().min(2).max(3).optional(),
  description: z.string().min(1).max(255).optional(),
})

const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
})

/**
 * Flujo público: inicia un pago online para una reserva.
 * Recibe bookingId del frontend; el monto autoritativo se resuelve
 * desde la reserva + servicio en DB.
 *
 * Si el pago online no está disponible (provider no configurado,
 * configurado como manual, o no implementado), retorna error claro
 * sin crear registros de pago.
 *
 * Para proveedores con redirect (Mercado Pago), pre-crea un Payment
 * local para usarlo como external_reference y evita duplicados
 * por doble click.
 */
async function _initiatePayment(data: {
  bookingId: string
  amount?: number
  currency?: string
  description?: string
}) {
  const limit = await checkRateLimit('initiate-payment', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = initiatePaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    include: {
      service: true,
      business: {
        select: { slug: true, subdomain: true, currency: true, id: true },
      },
      customer: {
        select: { email: true },
      },
    },
  })

  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }

  // Per-business availability: verificar si este negocio tiene pago online
  const businessAvailability = await resolveOnlinePaymentAvailabilityForBusiness(booking.businessId)
  if (!businessAvailability.available) {
    throw new UserError(
      businessAvailability.reason ||
      'Este negocio aun no tiene pago online habilitado. Coordina el pago directamente con el negocio.',
    )
  }

  // No iniciar pago si la reserva no está en estado pagable o hold expirado.
  // Import fuera del try: si el import fallara, su mensaje interno NO debe
  // colarse como UserError. Catch acotado a la llamada de assertBookingPayable
  // en sí, que solo lanza BookingNotPayableError con mensaje seguro
  // (Spanish, user-facing).
  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : 'No se puede iniciar pago para esta reserva')
  }

  if (booking.remainingBalance <= 0 || booking.paymentStatus === 'fully_paid') {
    throw new UserError('La reserva ya está pagada')
  }

  // Monto autoritativo desde la base de datos (no confiamos en el frontend)
  const amount = Math.min(booking.depositRequired, booking.remainingBalance)
  if (amount <= 0) {
    throw new UserError('No se requiere pago para esta reserva')
  }
  const currency = booking.business.currency || 'CLP'
  const description = `Abono para ${booking.service?.name || 'servicio'}`

  const provider = await getOnlinePaymentProviderForBusiness(booking.businessId)

  // Mercado Pago (redirect-based): pre-crear Payment local antes de llamar al provider.
  // El Payment.id se usa como external_reference en la preferencia de MP.
  if (provider.name === 'mercado_pago') {
    // Evitar múltiples Payment pending por doble click: reusar si ya existe
    // uno pending para este booking + deposit.
    const existingPending = await prisma.payment.findFirst({
      where: {
        bookingId: data.bookingId,
        paymentType: PaymentType.deposit,
        provider: 'mercado_pago',
        status: 'pending',
      },
    })

    let localPaymentId: string
    if (existingPending) {
      localPaymentId = existingPending.id
    } else {
      const payment = await prisma.payment.create({
        data: {
          businessId: booking.businessId,
          bookingId: data.bookingId,
          customerId: booking.customerId,
          provider: PaymentProvider.mercado_pago,
          providerPaymentId: null,
          amount,
          currency,
          status: PaymentStatus.pending,
          paymentType: PaymentType.deposit,
        },
      })
      localPaymentId = payment.id
    }

    const result = await createMpPreferenceForPayment(provider, {
      amount,
      currency,
      bookingId: data.bookingId,
      description,
      returnUrl: getBookingConfirmationUrl(booking.business, data.bookingId),
      webhookUrl: `${getPaymentAppUrl()}/api/webhooks/mercado-pago`,
      localPaymentId,
      customerEmail: booking.customer?.email ?? null,
      metadata: {
        bookingId: data.bookingId,
        businessId: booking.businessId,
        paymentType: 'deposit',
        localPaymentId,
      },
    })

    logger.payment.initiated(localPaymentId, data.bookingId, booking.businessId)

    revalidatePath('/dashboard/payments')
    return result
  }

  // Flujo original para mock y otros providers sin redirect
  const result = await provider.createPayment({
    amount,
    currency,
    bookingId: data.bookingId,
    description,
    returnUrl: getBookingConfirmationUrl(booking.business, data.bookingId),
    webhookUrl: `${getPaymentAppUrl()}/api/webhooks/${provider.name}`,
  })

  await prisma.payment.create({
    data: {
      id: result.paymentId,
      businessId: booking.businessId,
      bookingId: data.bookingId,
      customerId: booking.customerId,
      provider: provider.name as PaymentProvider,
      providerPaymentId: result.providerPaymentId,
      amount,
      currency,
      status: result.status as PaymentStatus,
      paymentType: PaymentType.deposit,
    },
  })

  logger.payment.initiated(result.paymentId, data.bookingId, booking.businessId)

  revalidatePath('/dashboard/payments')
  return result
}

export const initiatePayment = action(_initiatePayment)

/**
 * Server action para que el frontend público consulte la disponibilidad de pago online.
 * Si recibe businessId, resuelve por negocio (multi-tenant).
 * Si no, usa la configuración global (modo legacy/deprecado).
 * Nunca lanza: siempre retorna un objeto con { available, provider, reason?, isMock }.
 *
 * Deliberadamente SIN action(): no hay throw que sanear (nunca lanza, por
 * diseño) y ya devuelve un shape estructurado propio — envolverla en
 * ActionResult solo agregaría un nivel de anidación sin beneficio. Mismo
 * patrón que getBankTransferInfo (bank-transfer-public.ts), con quien
 * comparte el Promise.all en step-payment.tsx.
 */
export async function getOnlinePaymentAvailability(businessId?: string) {
  if (businessId) {
    return resolveOnlinePaymentAvailabilityForBusiness(businessId)
  }
  return resolveOnlinePaymentAvailability()
}

/**
 * Flujo público: verifica un pago con el proveedor y, si está aprobado,
 * aplica el monto a la reserva. No requiere sesión.
 * Idempotente: si el pago ya está aprobado, retorna éxito sin duplicar.
 *
 * Para proveedores con redirect (mercado_pago), la confirmación ocurre
 * via webhook. Esta función no debe confirmar pagos por redirect.
 */
async function _verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const limit = await checkRateLimit('verify-payment', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = verifyPaymentSchema.safeParse({ paymentId, bookingId })
  if (!parsed.success) {
    throw new UserError('Datos de verificación inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  })
  if (!payment) throw new UserError('Pago no encontrado')

  // El pago debe pertenecer a la reserva indicada
  if (payment.bookingId !== bookingId) {
    throw new UserError('El pago no corresponde a esta reserva')
  }
  if (!payment.booking) {
    throw new UserError('El pago no está asociado a una reserva')
  }

  // Validar que payment y booking pertenecen al mismo negocio
  if (payment.businessId !== payment.booking.businessId) {
    throw new UserError('Inconsistencia de negocio en el pago')
  }

  // Proveedores con redirect (mercado_pago): la confirmación ocurre via webhook.
  // No confirmar desde redirect de success.
  if (payment.provider === 'mercado_pago') {
    return {
      success: false,
      message: 'Tu pago está siendo procesado por Mercado Pago. Recibirás una confirmación cuando se apruebe.',
    }
  }

  // No confirmar si la reserva no es pagable (expired, cancelled, etc. o hold vencido).
  // Import fuera del try, mismo motivo que en _initiatePayment: el catch queda
  // acotado solo a la llamada de assertBookingPayable.
  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(payment.booking)
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva' }
  }

  const provider = getDefaultProvider()
  let approved = false

  if (payment.providerPaymentId) {
    const verification = await provider.verifyPayment({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    })
    if (verification.status === 'approved') approved = true
  }

  // Mock auto-approval: only in dev/test, never in production
  if (payment.provider === 'mock') {
    if (process.env.NODE_ENV !== 'production') {
      approved = true
    } else if (process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION === 'true') {
      approved = true
    }
  }

  if (!approved) {
    return { success: false, message: 'Pago no aprobado' }
  }

  const result = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')
    return applyApprovedPayment({
      tx,
      bookingId,
      businessId: payment.businessId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    })
  })

  if (!result || !result.booking) throw new UserError('Reserva no encontrada')

  if (result.wasConfirmed) {
    logger.payment.approved(payment.id, bookingId, payment.businessId)
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, payment.businessId),
    )
  }

  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(result.booking.businessId)
  return { success: true }
}

export const verifyAndConfirmPayment = action(_verifyAndConfirmPayment)

// read raw a propósito (sin callers hoy — helpers server-side para futura
// página de detalle de pagos; ForbiddenError ya extiende UserError).
export async function getPayments() {
  const { businessId } = await requireBusiness()
  return prisma.payment.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPaymentsByBooking(bookingId: string) {
  const { businessId } = await requireBusiness()
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }
  return prisma.payment.findMany({
    where: { bookingId },
  })
}

const createManualPaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  paymentType: z.enum(['deposit', 'final_payment', 'full_payment']).optional(),
  paymentMethod: z.string().min(1),
})

/**
 * Flujo privado (dashboard): registra un pago manual, crea el registro
 * Payment y actualiza la reserva + ledger en una transacción.
 * No confía en customerId ni businessId del cliente.
 * Delega el recálculo financiero a applyApprovedPayment.
 *
 * paymentType se deriva server-side según estado de la reserva y monto.
 * El cliente puede enviarlo para debug UI, pero se ignora si no coincide
 * con la derivación, para evitar clasificaciones incorrectas del ledger.
 */
async function _createManualPayment(data: {
  bookingId: string
  amount: number
  currency: string
  paymentType?: string
  paymentMethod: string
}) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-manual-payment', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createManualPaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: data.bookingId, businessId },
  })
  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  // Catch acotado a assertBookingPayable: solo lanza BookingNotPayableError con
  // mensaje seguro (Spanish, user-facing) — no arrastra errores internos.
  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    // allowCompleted: recobro post-chargeback y cobro de saldo tras atender
    // (spec FU-B4b-3 §6) — el guard de monto de abajo (remainingBalance) sigue
    // siendo el gate real: completed sin saldo rechaza igual.
    assertBookingPayable(booking, { allowCompleted: true })
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : 'No se puede registrar pago para esta reserva')
  }

  if (data.amount > booking.remainingBalance) {
    throw new UserError('El monto excede el saldo pendiente')
  }

  // Derivar paymentType en servidor — el cliente NO es fuente de verdad.
  const derivedType = deriveManualPaymentType(booking, data.amount)

  // Si el cliente envió un paymentType diferente al derivado, rechazar
  // para evitar clasificación incorrecta del ledger.
  if (data.paymentType && data.paymentType !== derivedType) {
    throw new UserError(
      `Tipo de pago incompatible: el sistema derivó '${derivedType}' pero recibió '${data.paymentType}'. ` +
      'El tipo se calcula automáticamente según el monto y estado de la reserva.',
    )
  }

  if (derivedType === 'full_payment' && data.amount < booking.remainingBalance) {
    throw new UserError('Un pago total debe cubrir el saldo completo')
  }

  const result = await prisma.$transaction(async (tx) => {
    const { applyApprovedPayment } = await import('@/server/services/finance')

    const payment = await tx.payment.create({
      data: {
        businessId,
        bookingId: data.bookingId,
        customerId: booking.customerId,
        paymentType: derivedType as PaymentType,
        provider: 'manual',
        providerPaymentId: null,
        amount: data.amount,
        currency: data.currency,
        status: 'pending',
        paymentMethod: data.paymentMethod,
        paidAt: null,
      },
    })

    const { booking: updatedBooking, wasConfirmed } = await applyApprovedPayment({
      tx,
      bookingId: data.bookingId,
      businessId,
      amount: data.amount,
      currency: data.currency,
      provider: 'manual',
      providerPaymentId: null,
      paymentType: derivedType as PaymentType,
      paymentMethod: data.paymentMethod,
      paymentId: payment.id,
      allowCompleted: true,
    })

    // Volver a leer el Payment actualizado para retornar datos frescos (status approved, paidAt, etc.)
    const refreshedPayment = await tx.payment.findUnique({ where: { id: payment.id } })

    return { payment: refreshedPayment ?? payment, booking: updatedBooking, wasConfirmed }
  })

  if (result.wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(data.bookingId, businessId),
    )
  }

  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)
  return result.payment
}

export const createManualPayment = action(_createManualPayment)
