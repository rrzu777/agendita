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

  it('allows expired hold on pending_payment when allowExpiredHold is set', () => {
    // El verificador de transferencia ya re-validó el cupo por su cuenta; puede
    // pedir explícitamente saltar el chequeo de hold vencido en vez de escribir
    // un holdExpiresAt falso solo para esquivarlo.
    const booking = {
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() - 1000 * 60),
    }
    expect(() => assertBookingPayable(booking, { allowExpiredHold: true })).not.toThrow()
  })

  it('still rejects terminal statuses even with allowExpiredHold', () => {
    // allowExpiredHold NO revive estados terminales — solo salta el hold vencido.
    const booking = { status: BookingStatus.expired, holdExpiresAt: null }
    expect(() => assertBookingPayable(booking, { allowExpiredHold: true })).toThrow(
      BookingNotPayableError,
    )
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
