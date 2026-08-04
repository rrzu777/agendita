import { describe, it, expect } from 'vitest'
import { assertBookingPayable, BookingNotPayableError } from '@/lib/bookings/payments'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'

/** `unpaid` por default: es el único caso que el cron barre, o sea el único en
 *  el que el plazo vencido cierra el cobro. Los casos con plata adentro lo pisan. */
function reserva(fields: {
  status: BookingStatus
  holdExpiresAt: Date | null
  paymentStatus?: BookingPaymentStatus
}) {
  return { paymentStatus: BookingPaymentStatus.unpaid, ...fields }
}

/** Todo lo que NO barre el cron. Derivado del enum a propósito: un valor nuevo
 *  entra solo y hay que decidirlo, en vez de quedar sin cubrir en silencio. */
const CON_PLATA_ADENTRO = Object.values(BookingPaymentStatus).filter(
  (s) => s !== BookingPaymentStatus.unpaid,
)

describe('assertBookingPayable', () => {
  it('allows pending_payment with future hold', () => {
    const booking = reserva({
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 min from now
    })
    expect(() => assertBookingPayable(booking)).not.toThrow()
  })

  it('allows confirmed booking', () => {
    const booking = reserva({
      status: BookingStatus.confirmed,
      holdExpiresAt: null,
    })
    expect(() => assertBookingPayable(booking)).not.toThrow()
  })

  it('rejects expired hold on pending_payment', () => {
    const booking = reserva({
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() - 1000 * 60), // 1 min ago
    })
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
    expect(() => assertBookingPayable(booking)).toThrow('El tiempo para pagar esta reserva ha expirado')
  })

  // El plazo vencido cierra el cobro porque el cron va a expirar la reserva. Con
  // plata adentro el cron la saltea (`paymentStatus: 'unpaid'` en su where), así
  // que el motivo desaparece y el cobro tiene que seguir abierto: si no, la
  // reserva que pagó tarde y perdió el horario queda sin ninguna salida.
  it.each(CON_PLATA_ADENTRO)(
    'permite el plazo vencido cuando paymentStatus es %s: el cron no la va a barrer',
    (paymentStatus) => {
      const booking = reserva({
        status: BookingStatus.pending_payment,
        holdExpiresAt: new Date(Date.now() - 1000 * 60),
        paymentStatus,
      })
      expect(() => assertBookingPayable(booking)).not.toThrow()
    },
  )

  it('allows expired hold on pending_payment when allowExpiredHold is set', () => {
    // El verificador de transferencia ya re-validó el cupo por su cuenta; puede
    // pedir explícitamente saltar el chequeo de hold vencido en vez de escribir
    // un holdExpiresAt falso solo para esquivarlo.
    const booking = reserva({
      status: BookingStatus.pending_payment,
      holdExpiresAt: new Date(Date.now() - 1000 * 60),
    })
    expect(() => assertBookingPayable(booking, { allowExpiredHold: true })).not.toThrow()
  })

  it('still rejects terminal statuses even with allowExpiredHold', () => {
    // allowExpiredHold NO revive estados terminales — solo salta el hold vencido.
    const booking = reserva({ status: BookingStatus.expired, holdExpiresAt: null })
    expect(() => assertBookingPayable(booking, { allowExpiredHold: true })).toThrow(
      BookingNotPayableError,
    )
  })

  it('rejects expired status', () => {
    const booking = reserva({
      status: BookingStatus.expired,
      holdExpiresAt: null,
    })
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects cancelled status', () => {
    const booking = reserva({
      status: BookingStatus.cancelled,
      holdExpiresAt: null,
    })
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects no_show status', () => {
    const booking = reserva({
      status: BookingStatus.no_show,
      holdExpiresAt: null,
    })
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })

  it('rejects completed status', () => {
    const booking = reserva({
      status: BookingStatus.completed,
      holdExpiresAt: null,
    })
    expect(() => assertBookingPayable(booking)).toThrow(BookingNotPayableError)
  })
})
