'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PaymentProvider, PaymentStatus, PaymentType, BookingStatus } from '@prisma/client'
import { getDefaultProvider } from '@/lib/payments/factory'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { applyPaymentToBooking } from '@/lib/booking-payments'

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

  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    include: {
      service: true,
      business: {
        select: { slug: true, subdomain: true, currency: true },
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

  const provider = getDefaultProvider()
  const baseUrl = getBusinessPublicUrl(booking.business)
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

  revalidatePath('/dashboard/payments')
  return result
}

/**
 * Flujo público: verifica un pago con el proveedor y, si está aprobado,
 * aplica el monto a la reserva. No requiere sesión.
 * Idempotente: si el pago ya está aprobado, retorna éxito sin duplicar.
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

  if (payment.provider === 'mock') {
    if (process.env.NODE_ENV !== 'production') {
      approved = true
    }
  }

  if (!approved) {
    return { success: false, message: 'Pago no aprobado' }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Idempotencia transaccional: solo marcar aprobado si aún no lo está
    const updateResult = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: 'approved' } },
      data: { status: 'approved', paidAt: new Date() },
    })

    if (updateResult.count === 0) {
      // Ya estaba aprobado por otro request concurrente
      return tx.booking.findUnique({ where: { id: bookingId } })
    }

    return applyPaymentToBooking(tx, bookingId, payment.amount, paymentId)
  })

  if (!updated) throw new Error('Reserva no encontrada')

  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(updated.businessId)
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
  paymentType: z.enum(['deposit', 'final_payment', 'full_payment']),
  paymentMethod: z.string().min(1),
})

/**
 * Flujo privado (dashboard): registra un pago manual, crea el registro
 * Payment y actualiza la reserva + ledger en una transacción.
 * No confía en customerId ni businessId del cliente.
 */
export async function createManualPayment(data: {
  bookingId: string
  amount: number
  currency: string
  paymentType: string
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

  if (data.paymentType === 'full_payment' && data.amount < booking.remainingBalance) {
    throw new Error('Un pago total debe cubrir el saldo completo')
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        businessId,
        bookingId: data.bookingId,
        customerId: booking.customerId,
        paymentType: data.paymentType as PaymentType,
        provider: 'manual',
        providerPaymentId: null,
        amount: data.amount,
        currency: data.currency,
        status: 'approved',
        paymentMethod: data.paymentMethod,
        paidAt: new Date(),
      },
    })

    const updatedBooking = await applyPaymentToBooking(tx, data.bookingId, data.amount, payment.id)

    return { payment, booking: updatedBooking }
  })

  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard/bookings')
  await revalidateBusinessPublicPaths(businessId)
  return result.payment
}
