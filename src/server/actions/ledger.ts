'use server'

import { store, LedgerEntry } from '@/lib/data/mock-store'
import { revalidatePath } from 'next/cache'

export async function getLedgerEntries() {
  return store.ledgerEntries.sort((a, b) => 
    new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}

export async function createLedgerEntry(data: Omit<LedgerEntry, 'id' | 'createdAt'>) {
  const entry: LedgerEntry = {
    ...data,
    id: `led-${Date.now()}`,
    createdAt: new Date(),
  }
  store.ledgerEntries.push(entry)
  revalidatePath('/dashboard/payments')
  return entry
}

export async function getFinancialSummary() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  
  const incomeToday = store.ledgerEntries
    .filter(e => e.direction === 'income' && new Date(e.occurredAt) >= today)
    .reduce((sum, e) => sum + e.amount, 0)
  
  const incomeMonth = store.ledgerEntries
    .filter(e => e.direction === 'income' && new Date(e.occurredAt) >= thisMonth)
    .reduce((sum, e) => sum + e.amount, 0)
  
  const totalDeposited = store.payments
    .filter(p => p.status === 'approved' && p.paymentType === 'deposit')
    .reduce((sum, p) => sum + p.amount, 0)
  
  const totalPending = store.bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
    .reduce((sum, b) => sum + b.remainingBalance, 0)
  
  const totalRefunded = store.ledgerEntries
    .filter(e => e.type === 'refund_issued')
    .reduce((sum, e) => sum + e.amount, 0)
  
  return {
    incomeToday,
    incomeMonth,
    totalDeposited,
    totalPending,
    totalRefunded,
    totalBookings: store.bookings.length,
    completedBookings: store.bookings.filter(b => b.status === 'completed').length,
    cancelledBookings: store.bookings.filter(b => b.status === 'cancelled').length,
  }
}
