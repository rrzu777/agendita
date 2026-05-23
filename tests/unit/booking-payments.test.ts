import { describe, it, expect } from 'vitest'
import { assertBookingPayable, BookingNotPayableError } from '@/lib/booking-payments'
import { BookingStatus } from '@prisma/client'

describe('assertBookingPayable', () => {
  it('allows pending_payment with future hold', () => {
    const booking = {
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 min from now
    }
    expect(() => assertBookingPayable(booking)).not.toThrow()
  })

  it('allows confirmed booking', () => {
    const booking = {
      status: BookingStatus.confirmed,
      holdExpiresAt: null,
    }
    expect(() => assertBookingPayable(booking)).not.toThrow()
  })

  it('rejects expired hold on pending_payment', () => {
    const booking = {
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() - 1000 * 60), // 1 min ago
    }
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
    expect(() => assertBookingPayable(booking)).toThrow('El tiempo para pagar esta reserva ha expirado')
  })

  it('rejects expired status', () => {
    const booking = {
      status: BookingStatus.expired,
      holdExpiresAt: null,
    }
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects cancelled status', () => {
    const booking = {
      status: BookingStatus.cancelled,
      holdExpiresAt: null,
    }
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects no_show status', () => {
    const booking = {
      status: BookingStatus.no_show,
      holdExpiresAt: null,
    }
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects completed status', () => {
    const booking = {
      status: BookingStatus.completed,
      holdExpiresAt: null,
    }
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })
})
