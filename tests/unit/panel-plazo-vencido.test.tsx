import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

// Sin esto, el ManualPaymentDialog de adentro explota al llamar useRouter().
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
// El calendario arrastra modales que no son lo que se está probando acá.
vi.mock('@/components/dashboard/block-time-modal', () => ({ BlockTimeModal: () => null }))
vi.mock('@/components/dashboard/booking-drawer', () => ({ BookingDrawer: () => null }))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({ EditBlockDialog: () => null }))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))

import { BookingCard } from '@/app/dashboard/bookings/page'
import { CalendarViews } from '@/components/dashboard/calendar-views'
import { btDeclaredId } from '@/lib/bank-transfer/declared'

const HORA = 60 * 60 * 1000

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
    />,
  )
}

// El espejo, del lado de la dueña, de lo que mi-business-detail-page.test.tsx
// verifica del lado de la clienta.
describe('BookingCard y el plazo vencido', () => {
  it('con el plazo vivo sigue diciendo Pendiente de pago y deja cobrar', () => {
    const html = render(new Date(Date.now() + HORA))
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
    expect(html).toContain('Registrar pago')
  })

  it('con el plazo vencido cambia el badge, saca el cobro y explica la salida', () => {
    const html = render(new Date(Date.now() - HORA))
    expect(html).toContain('Plazo vencido')
    expect(html).not.toContain('Pendiente de pago')
    expect(html).not.toContain('Registrar pago')
    expect(html).toContain('Revivir')
  })

  it('no dice "Expirada": ese estado en el panel viene con su propio botón', () => {
    // Reusar la palabra haría que dos cosas opuestas se vean iguales — una
    // expirada de verdad ofrece Revivir en la misma fila; ésta todavía no.
    const html = render(new Date(Date.now() - HORA))
    expect(html).not.toContain('>Expirada<')
  })

  it('sin plazo no inventa nada', () => {
    const html = render(null)
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
  })
})

const CALENDAR_PROPS = {
  timeBlocks: [],
  selectedProfessionalId: null,
  view: 'day' as const,
  date: '2026-06-30',
  todayKey: '2026-06-30',
  timezone: 'America/Santiago',
  businessCurrency: 'CLP',
  businessAddress: null,
  photoUploadEnabled: false,
  professionals: [],
}

function chip(holdExpiresAt: Date | null, payments: Array<{ providerPaymentId?: string | null }> = []) {
  const booking = {
    id: 'b1',
    startDateTime: '2026-06-30T17:00:00.000Z',
    endDateTime: '2026-06-30T18:00:00.000Z',
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    holdExpiresAt,
    payments,
    customer: { name: 'Ana' },
    service: { name: 'Corte', pastelColor: '#FFB3BA' },
    professional: null,
  }
  return renderToStaticMarkup(
    // @ts-expect-error props mínimos de prueba
    <CalendarViews {...CALENDAR_PROPS} bookings={[booking]} />,
  )
}

describe('El chip del calendario y el plazo vencido', () => {
  it('con el plazo vivo el chip sigue entero', () => {
    const html = chip(new Date(Date.now() + HORA))
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
    expect(html).not.toContain('opacity:0.55')
  })

  it('con el plazo vencido lo dice y lo atenúa: ese horario ya se puede vender', () => {
    const html = chip(new Date(Date.now() - HORA))
    expect(html).toContain('Plazo vencido')
    expect(html).not.toContain('Pendiente de pago')
    expect(html).toContain('opacity:0.55')
    // Si faltara la etiqueta del estado derivado, acá aparecería la clave cruda.
    expect(html).not.toContain('hold_expired')
  })

  it('la transferencia declarada mantiene el chip entero aunque el plazo haya vencido', () => {
    const html = chip(new Date(Date.now() - HORA), [{ providerPaymentId: btDeclaredId('b1') }])
    expect(html).toContain('Pendiente de pago')
    expect(html).not.toContain('Plazo vencido')
  })
})
