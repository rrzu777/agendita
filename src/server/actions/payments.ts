'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { getDefaultProvider } from '@/lib/payments/factory'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'

const initiatePaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  description: z.string().min(1).max(255),
})

const verifyPaymentSchema = z.object({
  paymentId: z.string().min(1),
  bookingId: z.string().min(1),
})

export async function initiatePayment(data: {
  bookingId: string
  amount: number
  currency: string
  description: string
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
    select: {
      customerId: true,
      businessId: true,
      business: {
        select: {
          slug: true,
          subdomain: true,
        },
      },
    },
  })

  if (!booking) {
    throw new Error('Booking not found')
  }

  const provider = getDefaultProvider()
  const baseUrl = getBusinessPublicUrl(booking.business)
  const result = await provider.createPayment({
    amount: data.amount,
    currency: data.currency,
    bookingId: data.bookingId,
    description: data.description,
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
      amount: data.amount,
      currency: data.currency,
      status: result.status as PaymentStatus,
      paymentType: PaymentType.deposit,
    },
  })

  revalidatePath('/dashboard/payments')
  return result
}

export async function verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const limit = await checkRateLimit('verify-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = verifyPaymentSchema.safeParse({ paymentId, bookingId })
  if (!parsed.success) {
    throw new Error('Datos de verificación inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new Error('Payment not found')

  const provider = getDefaultProvider()

  if (payment.providerPaymentId) {
    const verification = await provider.verifyPayment({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    })

    if (verification.status === 'approved') {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'approved', paidAt: new Date() },
      })

      const { confirmPayment } = await import('./bookings')
      await confirmPayment(bookingId, payment.amount)

      return { success: true }
    }
  }

  if (payment.provider === 'mock') {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'approved', paidAt: new Date() },
    })

    const { confirmPayment } = await import('./bookings')
    await confirmPayment(bookingId, payment.amount)

    return { success: true }
  }

  return { success: false, message: 'Payment not approved' }
}

export async function getPayments() {
  return prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPaymentsByBooking(bookingId: string) {
  return prisma.payment.findMany({
    where: { bookingId },
  })
}

const createManualPaymentSchema = z.object({
  businessId: z.string().min(1),
  bookingId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(2).max(3),
  paymentType: z.enum(['deposit', 'final_payment', 'full_payment']),
  paymentMethod: z.string().min(1),
})

export async function createManualPayment(data: {
  businessId: string
  bookingId: string
  customerId: string
  amount: number
  currency: string
  paymentType: string
  paymentMethod: string
}) {
  const limit = await checkRateLimit('create-manual-payment', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createManualPaymentSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const payment = await prisma.payment.create({
    data: {
      ...data,
      paymentType: data.paymentType as PaymentType,
      provider: 'manual',
      providerPaymentId: null,
      status: 'approved',
      paidAt: new Date(),
    },
  })

  revalidatePath('/dashboard/payments')
  return payment
}
