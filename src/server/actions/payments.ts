'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import {
  getDefaultProvider,
  isOnlinePaymentAvailable,
  getOnlinePaymentProvider,
  resolveOnlinePaymentAvailability,
  getOnlinePaymentProviderForBusiness,
} from '@/lib/payments/factory'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
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
export async function initiatePayment(data: {
  bookingId: string
  amount?: number
  currency?: string
  description?: string
}) {
  const limit = await checkRateLimit('initiate-payment', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = initiatePaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Guard: no crear pagos si el checkout online no está disponible
  if (!isOnlinePaymentAvailable()) {
    throw new Error(
      'Pago online no disponible. Contacta al negocio para coordinar el pago.',
    )
  }

  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    include: {
      service: true,
      business: {
        select: { slug: true, subdomain: true, currency: true },
      },
      customer: {
        select: { email: true },
      },
    },
  })

  if (!booking) {
    throw new Error('Reserva no encontrada')
  }

  // No iniciar pago si la reserva no está en estado pagable o hold expirado
  try {
    const { assertBookingPayable } = await import('@/lib/booking-payments')
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede iniciar pago para esta reserva')
  }

  if (booking.remainingBalance <= 0 || booking.paymentStatus === 'fully_paid') {
    throw new Error('La reserva ya está pagada')
  }

  // Monto autoritativo desde la base de datos (no confiamos en el frontend)
  const amount = Math.min(booking.depositRequired, booking.remainingBalance)
  const currency = booking.business.currency || 'CLP'
  const description = `Abono para ${booking.service?.name || 'servicio'}`

  const provider = await getOnlinePaymentProviderForBusiness(booking.businessId)
  const baseUrl = getBusinessPublicUrl(booking.business)

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

    const result = await provider.createPayment({
      amount,
      currency,
      bookingId: data.bookingId,
      description,
      returnUrl: `${baseUrl}/book/confirmation?bookingId=${data.bookingId}`,
      webhookUrl: `${baseUrl}/api/webhooks/mercado-pago`,
      localPaymentId,
      customerEmail: booking.customer?.email ?? null,
      metadata: {
        bookingId: data.bookingId,
        businessId: booking.businessId,
        paymentType: 'deposit',
        localPaymentId,
      },
    })

    // Guardar rawPayload con datos de la preferencia (preferenceId, init_point)
    await prisma.payment.update({
      where: { id: localPaymentId },
      data: { rawPayload: result.rawResponse as Prisma.InputJsonValue },
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
    returnUrl: `${baseUrl}/book/confirmation?bookingId=${data.bookingId}`,
    webhookUrl: `${baseUrl}/api/webhooks/${provider.name}`,
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

/**
 * Server action para que el frontend público consulte la disponibilidad de pago online.
 * Nunca lanza: siempre retorna un objeto con { available, provider, reason?, isMock }.
 */
export async function getOnlinePaymentAvailability() {
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
export async function verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const limit = await checkRateLimit('verify-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = verifyPaymentSchema.safeParse({ paymentId, bookingId })
  if (!parsed.success) {
    throw new Error('Datos de verificación inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  })
  if (!payment) throw new Error('Pago no encontrado')

  // El pago debe pertenecer a la reserva indicada
  if (payment.bookingId !== bookingId) {
    throw new Error('El pago no corresponde a esta reserva')
  }

  // Validar que payment y booking pertenecen al mismo negocio
  if (payment.businessId !== payment.booking.businessId) {
    throw new Error('Inconsistencia de negocio en el pago')
  }

  // Proveedores con redirect (mercado_pago): la confirmación ocurre via webhook.
  // No confirmar desde redirect de success.
  if (payment.provider === 'mercado_pago') {
    return {
      success: false,
      message: 'Tu pago está siendo procesado por Mercado Pago. Recibirás una confirmación cuando se apruebe.',
    }
  }

  // No confirmar si la reserva no es pagable (expired, cancelled, etc. o hold vencido)
  try {
    const { assertBookingPayable } = await import('@/lib/booking-payments')
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

  if (!result || !result.booking) throw new Error('Reserva no encontrada')

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
export async function createManualPayment(data: {
  bookingId: string
  amount: number
  currency: string
  paymentType?: string
  paymentMethod: string
}) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-manual-payment', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createManualPaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: data.bookingId, businessId },
  })
  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  const { assertBookingPayable } = await import('@/lib/booking-payments')
  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No se puede registrar pago para esta reserva')
  }

  if (data.amount > booking.remainingBalance) {
    throw new Error('El monto excede el saldo pendiente')
  }

  // Derivar paymentType en servidor — el cliente NO es fuente de verdad.
  const derivedType = deriveManualPaymentType(booking, data.amount)

  // Si el cliente envió un paymentType diferente al derivado, rechazar
  // para evitar clasificación incorrecta del ledger.
  if (data.paymentType && data.paymentType !== derivedType) {
    throw new Error(
      `Tipo de pago incompatible: el sistema derivó '${derivedType}' pero recibió '${data.paymentType}'. ` +
      'El tipo se calcula automáticamente según el monto y estado de la reserva.',
    )
  }

  if (derivedType === 'full_payment' && data.amount < booking.remainingBalance) {
    throw new Error('Un pago total debe cubrir el saldo completo')
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
