import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

// Sin esto, el ManualPaymentDialog de adentro explota al llamar useRouter().
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { BookingCard } from '@/app/dashboard/bookings/page'

const HORA = 60 * 60 * 1000
// El reloj con el que la página deriva el estado. Uno solo para todos los
// casos: los plazos de abajo se arman contra ÉL, no contra `Date.now()`.
const NOW = new Date()

function makeBooking(holdExpiresAt: Date | null) {
  return {
    id: 'bk-1',
    bookingNumber: 4738,
    startDateTime: new Date('2026-08-05T14:00:00Z'),
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    depositPaid: 0,
    depositRequired: 10000,
    finalAmount: 10000,
    totalPrice: 10000,
    remainingBalance: 10000,
    holdExpiresAt,
    modality: 'on_site' as const,
    service: { name: 'Corte' },
    professional: null,
    customer: { name: 'Ana', phone: '+56911111111', email: null },
    payments: [],
  }
}

function render(holdExpiresAt: Date | null) {
  return renderToStaticMarkup(
    <BookingCard
      booking={makeBooking(holdExpiresAt)}
      businessCurrency="CLP"
      businessTimezone="America/Santiago"
      businessAddress={null}
      now={NOW}
    />,
  )
}

// El espejo, del lado de la dueña, de lo que mi-business-detail-page.test.tsx
// verifica del lado de la clienta.
describe('BookingCard y el plazo vencido', () => {
  it('con el plazo vivo sigue diciendo Pendiente de pago y deja cobrar', () => {
    const html = render(new Date(NOW.getTime() + HORA))
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
    expect(html).toContain('Registrar pago')
  })

  it('con el plazo vencido cambia el badge, saca el cobro y explica la salida', () => {
    const html = render(new Date(NOW.getTime() - HORA))
    expect(html).toContain('Plazo vencido')
    expect(html).not.toContain('Pendiente de pago')
    expect(html).not.toContain('Registrar pago')
    expect(html).toContain('Revivir')
  })

  it('no dice "Expirada": ese estado en el panel viene con su propio botón', () => {
    // Reusar la palabra haría que dos cosas opuestas se vean iguales — una
    // expirada de verdad ofrece Revivir en la misma fila; ésta todavía no.
    const html = render(new Date(NOW.getTime() - HORA))
    expect(html).not.toContain('>Expirada<')
  })

  it('sin plazo no inventa nada', () => {
    const html = render(null)
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
  })
})
