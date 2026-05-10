'use server'

import { store, Payment } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getPayments() {
  return store.payments.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function createPayment(data: Omit<Payment, 'id' | 'createdAt'>) {
  const payment: Payment = {
    ...data,
    id: `pay-${Date.now()}`,
    createdAt: new Date(),
  }
  store.payments.push(payment)
  revalidatePath('/dashboard/payments')
  return payment
}

export async function getPaymentsByBooking(bookingId: string) {
  return store.payments.filter(p => p.bookingId === bookingId)
}
