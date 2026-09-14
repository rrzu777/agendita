import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDrawer } from '@/components/dashboard/booking-drawer'
import type { CalendarBooking } from '@/components/dashboard/booking-card'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
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

  it.each(['confirmed', 'pending_confirmation'] as const)('owns the 44px target boundary inside the portal for %s actions', (status) => {
    const rendered = renderDrawer({ ...booking, status, holdExpiresAt: null })
    root = rendered.root
    const sheet = document.querySelector('[data-slot="sheet-content"]')!
    expect(rendered.container.contains(sheet)).toBe(false)
    expect(sheet.classList.contains('[&_button]:min-h-11')).toBe(true)
    expect(sheet.classList.contains('[&_button]:min-w-11')).toBe(true)
    expect(sheet.classList.contains('[&_a]:min-h-11')).toBe(true)
    expect(sheet.classList.contains('[&_a]:min-w-11')).toBe(true)
    expect(sheet.textContent).toContain(status === 'confirmed' ? 'Reprogramar' : 'Aceptar')
    expect(sheet.textContent).toContain('Cerrar')
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

  it.each(['pending_payment', 'pending_confirmation', 'expired', 'cancelled', 'completed', 'no_show'])('mantiene contacto neutral en %s sin confirmación ni recordatorio falsos', (status) => {
    const rendered = renderDrawer({ ...booking, status, holdExpiresAt: null })
    root = rendered.root
    const contact = document.querySelector('[data-slot="booking-contact-actions"]')!

    expect(contact.textContent).toContain('Contactar por WhatsApp')
    expect(contact.textContent).toContain('Copiar resumen')
    expect(contact.textContent).not.toContain('Enviar confirmación')
    expect(contact.textContent).not.toContain('Enviar recordatorio')
    expect(contact.textContent).not.toContain('Copiar recordatorio')
  })

  it('ofrece confirmación y recordatorio sólo cuando la reserva está confirmada y próxima', () => {
    const rendered = renderDrawer({ ...booking, status: 'confirmed', holdExpiresAt: null })
    root = rendered.root
    const contact = document.querySelector('[data-slot="booking-contact-actions"]')!

    expect(contact.textContent).toContain('Enviar confirmación')
    expect(contact.textContent).toContain('Enviar recordatorio')
    expect(contact.textContent).toContain('Copiar recordatorio')
  })

  it('retira el recordatorio cuando una reserva confirmada ya comenzó', () => {
    const rendered = renderDrawer({ ...booking, status: 'confirmed', startDateTime: '2026-06-30T17:00:00.000Z', holdExpiresAt: null })
    root = rendered.root
    const contact = document.querySelector('[data-slot="booking-contact-actions"]')!

    expect(contact.textContent).toContain('Enviar confirmación')
    expect(contact.textContent).not.toContain('Enviar recordatorio')
    expect(contact.textContent).not.toContain('Copiar recordatorio')
  })

  it('muestra una sola vez el aviso cuando la reserva no tiene teléfono', () => {
    const rendered = renderDrawer({ ...booking, customer: { ...booking.customer!, phone: null as never } })
    root = rendered.root
    expect(document.body.textContent?.match(/Sin teléfono registrado/g)).toHaveLength(1)
  })
})
