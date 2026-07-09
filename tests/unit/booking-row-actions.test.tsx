import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'

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
