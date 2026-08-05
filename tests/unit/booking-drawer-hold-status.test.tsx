import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDrawer } from '@/components/dashboard/booking-drawer'
import type { CalendarBooking } from '@/components/dashboard/booking-card'

vi.mock('@/components/dashboard/booking-contact-buttons', () => ({
  BookingContactButtons: () => null,
}))
vi.mock('@/components/dashboard/cancel-booking-button', () => ({
  CancelBookingButton: () => <button type="button">Cancelar</button>,
}))
vi.mock('@/components/dashboard/customer-photos', () => ({
  CustomerPhotos: () => null,
}))

const NOW = new Date('2026-06-30T18:00:00.000Z')
const EXPIRED_HOLD = new Date('2026-06-30T17:00:00.000Z')

const booking: CalendarBooking = {
  id: 'booking-1',
  bookingNumber: 42,
  status: 'pending_payment',
  startDateTime: '2026-07-01T18:00:00.000Z',
  endDateTime: '2026-07-01T19:00:00.000Z',
  service: { name: 'Manicure' },
  professional: null,
  customer: { name: 'Ana', phone: '+56911111111', email: null },
  totalPrice: 20000,
  depositPaid: 0,
  depositRequired: 5000,
  finalAmount: 20000,
  remainingBalance: 20000,
  paymentStatus: 'unpaid',
  holdExpiresAt: EXPIRED_HOLD,
  approvalExpiresAt: null,
  payments: [],
  modality: 'on_site',
  serviceAddress: null,
  meetingUrl: null,
}

function renderDrawer(nextBooking: CalendarBooking) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <BookingDrawer
        booking={nextBooking}
        open
        onOpenChange={() => {}}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
        businessAddress={null}
        photoUploadEnabled={false}
        hasTeam={false}
        now={NOW}
      />,
    )
  })

  return { root, container }
}

describe('BookingDrawer — holds vencidos', () => {
  let root: Root | null = null

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
  })

  it('prioriza el pago MP en vuelo y mantiene bloqueada la reprogramación', () => {
    const rendered = renderDrawer({
      ...booking,
      payments: [{ provider: 'mercado_pago', status: 'pending', providerPaymentId: 'mp-1' }],
    })
    root = rendered.root

    expect(document.body.textContent).toContain('Pendiente de pago')
    expect(document.body.textContent).toContain('Mercado Pago está procesando este pago.')
    expect(document.body.textContent).toContain('reprogramarla no la mantendría viva')
    expect(document.body.textContent).not.toContain('Plazo vencido')
    expect(document.body.textContent).not.toContain('Reprogramar')
  })

  it('muestra plazo vencido sin pago en vuelo y explica por qué no ofrece reprogramar', () => {
    const rendered = renderDrawer(booking)
    root = rendered.root

    expect(document.body.textContent).toContain('Plazo vencido')
    expect(document.body.textContent).toContain('Venció el plazo de esta reserva')
    expect(document.body.textContent).toContain('usá Revivir')
    expect(document.body.textContent).not.toContain('Mercado Pago está procesando este pago.')
    expect(document.body.textContent).not.toContain('Reprogramar')
  })
})
