import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { BookingCard } from '@/app/dashboard/bookings/page'

function makeBooking(bookingNumber: number | null) {
  return {
    id: 'clabc12345xyz',
    bookingNumber,
    startDateTime: new Date('2026-08-01T12:00:00Z'),
    status: 'confirmed',
    depositPaid: 10000,
    depositRequired: 10000,
    finalAmount: 20000,
    paymentStatus: 'deposit_paid',
    totalPrice: 20000,
    remainingBalance: 10000,
    service: { name: 'Corte' },
    customer: { name: 'Ana', phone: '+56911111111' },
  }
}

describe('BookingCard booking number', () => {
  it('renders #<number> when present', () => {
    const html = renderToStaticMarkup(
      <BookingCard booking={makeBooking(4738)} businessCurrency="CLP" businessTimezone="America/Santiago" businessAddress={null} />,
    )
    expect(html).toContain('#4738')
    expect(html).not.toContain('#clabc123')
  })

  it('falls back to the cuid slice when the number is null', () => {
    const html = renderToStaticMarkup(
      <BookingCard booking={makeBooking(null)} businessCurrency="CLP" businessTimezone="America/Santiago" businessAddress={null} />,
    )
    expect(html).toContain('#clabc123')
  })
})
