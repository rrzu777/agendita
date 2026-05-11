'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Booking, Customer } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  startDateTime: z.date(),
  endDateTime: z.date(),
  totalPrice: z.number().positive(),
  depositRequired: z.number().nonnegative(),
  finalAmount: z.number().positive(),
})

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  amount: z.number().positive(),
})

export async function getBookings(businessId?: string) {
  return prisma.booking.findMany({
    where: businessId ? { businessId } : undefined,
    orderBy: { startDateTime: 'desc' },
    include: {
      service: true,
      customer: true,
    },
  })
}

export async function createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  startDateTime: Date
  endDateTime: Date
  totalPrice: number
  depositRequired: number
  finalAmount: number
}, businessId: string = 'mock-business-1') {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Buscar o crear cliente
  let customer = await prisma.customer.findFirst({
    where: {
      phone: data.customerPhone,
      name: data.customerName,
      businessId,
    },
  })

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        businessId,
        name: data.customerName,
        phone: data.customerPhone,
        email: data.customerEmail || null,
      },
    })
  }

  const booking = await prisma.booking.create({
    data: {
      businessId,
      serviceId: data.serviceId,
      customerId: customer.id,
      startDateTime: data.startDateTime,
      endDateTime: data.endDateTime,
      status: BookingStatus.pending_payment,
      totalPrice: data.totalPrice,
      depositRequired: data.depositRequired,
      remainingBalance: data.finalAmount,
      finalAmount: data.finalAmount,
      paymentStatus: BookingPaymentStatus.unpaid,
    },
    include: {
      service: true,
      customer: true,
    },
  })

  revalidatePath('/dashboard/bookings')
  return booking
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const updated = await prisma.booking.update({
    where: { id },
    data: { status },
  })
  revalidatePath('/dashboard/bookings')
  return updated
}

export async function confirmPayment(bookingId: string, amount: number) {
  const limit = await checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, amount })
  if (!parsed.success) {
    throw new Error('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new Error('Booking not found')
  if (booking.status === BookingStatus.cancelled) throw new Error('Cannot confirm payment for cancelled booking')
  if (amount <= 0) throw new Error('Amount must be positive')

  const isFullPayment = amount >= booking.finalAmount

  const updated = await prisma.$transaction(async (tx) => {
    const updatedBooking = await tx.booking.update({
      where: { id: bookingId },
      data: {
        depositPaid: amount,
        remainingBalance: Math.max(0, booking.finalAmount - amount),
        paymentStatus: isFullPayment ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.deposit_paid,
        status: BookingStatus.confirmed,
      },
    })

    const payment = await tx.payment.create({
      data: {
        businessId: booking.businessId,
        bookingId,
        customerId: booking.customerId,
        provider: 'mock',
        amount,
        currency: 'CLP',
        status: 'approved',
        paymentType: isFullPayment ? 'full_payment' : 'deposit',
        paymentMethod: 'mock',
        paidAt: new Date(),
      },
    })

    await tx.ledgerEntry.create({
      data: {
        businessId: booking.businessId,
        bookingId,
        paymentId: payment.id,
        customerId: booking.customerId,
        type: isFullPayment ? 'full_payment_paid' : 'deposit_paid',
        direction: 'income',
        amount,
        currency: 'CLP',
        description: `${isFullPayment ? 'Pago total' : 'Abono'} para reserva ${booking.id.slice(-4)}`,
        occurredAt: new Date(),
      },
    })

    return updatedBooking
  })

  revalidatePath('/dashboard/bookings')
  return updated
}
