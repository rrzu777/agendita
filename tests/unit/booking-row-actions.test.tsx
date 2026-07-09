import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'

describe('CancelBookingButton controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <CancelBookingButton bookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Cancelar')
  })

  it('still renders the trigger by default', () => {
    const html = renderToStaticMarkup(<CancelBookingButton bookingId="b1" />)
    expect(html).toContain('Cancelar')
  })
})

const payableBooking = {
  id: 'b1',
  bookingNumber: 4738,
  status: 'confirmed',
  depositPaid: 15000,
  depositRequired: 15000,
  finalAmount: 45000,
  remainingBalance: 30000,
  service: { name: 'Manicura' },
  customer: { name: 'Ana' },
}

describe('ManualPaymentDialog controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <ManualPaymentDialog bookings={[payableBooking as never]} defaultBookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Registrar pago')
    expect(html).not.toContain('Cobrar')
  })
})

function rowBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', bookingNumber: 4738, status: 'confirmed',
    depositPaid: 15000, depositRequired: 15000, finalAmount: 45000,
    remainingBalance: 30000, service: { name: 'Manicura' }, customer: { name: 'Ana' },
    ...overrides,
  }
}

describe('BookingRowActions', () => {
  it('shows Completar as primary + kebab for a confirmed booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking() as never} businessCurrency="CLP" />)
    expect(html).toContain('Completar')
    expect(html).toContain('Más acciones')
  })

  it('shows Cobrar as primary for a pending_payment booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'pending_payment' }) as never} businessCurrency="CLP" />)
    expect(html).toContain('Cobrar')
  })

  it('renders nothing actionable for a terminal booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'completed', remainingBalance: 0 }) as never} businessCurrency="CLP" />)
    expect(html).not.toContain('Completar')
    expect(html).not.toContain('Cobrar')
    expect(html).not.toContain('Más acciones')
  })
})
