'use server'

import { store, Payment } from '@/lib/data/mock-store'
import { getDefaultProvider } from '@/lib/payments/factory'
import { revalidatePath } from 'next/cache'

export async function initiatePayment(data: {
  bookingId: string
  amount: number
  currency: string
  description: string
}) {
  const provider = getDefaultProvider()
  
  const result = await provider.createPayment({
    amount: data.amount,
    currency: data.currency,
    bookingId: data.bookingId,
    description: data.description,
    returnUrl: `${process.env.NEXT_PUBLIC_APP_DOMAIN || 'http://localhost:3000'}/book/confirmation`,
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_DOMAIN || 'http://localhost:3000'}/api/webhooks/${provider.name}`,
  })

  // Create payment record
  const payment: Payment = {
    id: result.paymentId,
    businessId: 'mock-business-1',
    bookingId: data.bookingId,
    customerId: '', // Would be filled from booking
    provider: provider.name as any,
    providerPaymentId: result.providerPaymentId,
    amount: data.amount,
    currency: data.currency,
    status: result.status as any,
    paymentType: 'deposit',
    paymentMethod: null,
    paidAt: null,
    rawPayload: result.rawResponse,
    createdAt: new Date(),
  }

  store.payments.push(payment)
  revalidatePath('/dashboard/payments')

  return result
}

export async function verifyAndConfirmPayment(paymentId: string, bookingId: string) {
  const provider = getDefaultProvider()
  const payment = store.payments.find(p => p.id === paymentId)
  
  if (!payment) throw new Error('Payment not found')

  // Verify payment with provider (server-side)
  if (payment.providerPaymentId) {
    const verification = await provider.verifyPayment({
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId,
    })

    if (verification.status === 'approved') {
      payment.status = 'approved'
      payment.paidAt = new Date()
      
      // Confirm booking payment
      const { confirmPayment } = await import('./bookings')
      await confirmPayment(bookingId, payment.amount)
      
      return { success: true }
    }
  }

  // For mock provider, auto-approve in development
  if (payment.provider === 'mock') {
    payment.status = 'approved'
    payment.paidAt = new Date()
    
    const { confirmPayment } = await import('./bookings')
    await confirmPayment(bookingId, payment.amount)
    
    return { success: true }
  }

  return { success: false, message: 'Payment not approved' }
}

export async function getPayments() {
  return store.payments.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function getPaymentsByBooking(bookingId: string) {
  return store.payments.filter(p => p.bookingId === bookingId)
}
