import { describe, it, expect } from 'vitest'
import { addMinutes } from 'date-fns'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { recomputeBookingAmountsAfterDiscount } from '@/lib/booking/recompute'

const NOW = new Date('2026-07-03T12:00:00Z')

describe('recomputeBookingAmountsAfterDiscount', () => {
  it('descuento total: queda todo en cero, confirmada y pagada', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 20000, now: NOW,
    })
    expect(result.discountAmount).toBe(20000)
    expect(result.finalAmount).toBe(0)
    expect(result.depositRequired).toBe(0)
    expect(result.remainingBalance).toBe(0)
    expect(result.status).toBe(BookingStatus.confirmed)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(result.holdExpiresAt).toBeNull()
  })

  it('descuento parcial que deja saldo mayor al depósito: pending_payment con hold +15min', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 5000, now: NOW,
    })
    expect(result.discountAmount).toBe(5000)
    expect(result.finalAmount).toBe(15000)
    expect(result.depositRequired).toBe(10000)
    expect(result.remainingBalance).toBe(15000)
    expect(result.status).toBe(BookingStatus.pending_payment)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(result.holdExpiresAt).toEqual(addMinutes(NOW, 15))
  })

  it('descuento parcial que baja el final por debajo del depósito: depositRequired === finalAmount', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 15000, now: NOW,
    })
    expect(result.finalAmount).toBe(5000)
    expect(result.depositRequired).toBe(5000)
    expect(result.remainingBalance).toBe(5000)
    expect(result.status).toBe(BookingStatus.pending_payment)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(result.holdExpiresAt).toEqual(addMinutes(NOW, 15))
  })

  it('usa new Date() por defecto cuando no se inyecta now', () => {
    const before = new Date()
    const result = recomputeBookingAmountsAfterDiscount({ price: 20000, depositAmount: 10000, discountAmount: 5000 })
    const after = new Date()
    expect(result.holdExpiresAt!.getTime()).toBeGreaterThanOrEqual(addMinutes(before, 15).getTime())
    expect(result.holdExpiresAt!.getTime()).toBeLessThanOrEqual(addMinutes(after, 15).getTime())
  })
})
