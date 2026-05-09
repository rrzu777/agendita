'use server'

import { store, Booking, Customer } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getBookings() {
  return store.bookings.sort((a, b) => 
    new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime()
  )
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
}) {
  let customer = store.customers.find(c => c.phone === data.customerPhone)
  if (!customer) {
    customer = {
      id: `cust-${Date.now()}`,
      businessId: 'mock-business-1',
      name: data.customerName,
      phone: data.customerPhone,
      email: data.customerEmail || null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    store.customers.push(customer)
  }

  const booking: Booking = {
    id: `bk-${Date.now()}`,
    businessId: 'mock-business-1',
    serviceId: data.serviceId,
    customerId: customer.id,
    startDateTime: data.startDateTime,
    endDateTime: data.endDateTime,
    status: 'pending_payment',
    totalPrice: data.totalPrice,
    depositRequired: data.depositRequired,
    depositPaid: 0,
    remainingBalance: data.finalAmount,
    discountAmount: 0,
    finalAmount: data.finalAmount,
    paymentStatus: 'unpaid',
    customerNotes: null,
    internalNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  store.bookings.push(booking)
  revalidatePath('/dashboard/bookings')
  return booking
}

export async function updateBookingStatus(id: string, status: Booking['status']) {
  const index = store.bookings.findIndex(b => b.id === id)
  if (index === -1) throw new Error('Booking not found')
  store.bookings[index].status = status
  revalidatePath('/dashboard/bookings')
  return store.bookings[index]
}

export async function confirmPayment(bookingId: string, amount: number) {
  const booking = store.bookings.find(b => b.id === bookingId)
  if (!booking) throw new Error('Booking not found')
  
  booking.depositPaid = amount
  booking.remainingBalance = booking.finalAmount - amount
  booking.paymentStatus = amount >= booking.finalAmount ? 'fully_paid' : 'deposit_paid'
  booking.status = 'confirmed'
  booking.updatedAt = new Date()
  
  revalidatePath('/dashboard/bookings')
  return booking
}
