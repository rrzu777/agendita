import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'
import { BookingContactButtons } from '@/components/dashboard/booking-contact-buttons'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

// El reloj lo pone quien renderiza: estos componentes son cliente y salen en
// el HTML del servidor (ver `isManualPaymentAllowed`). Los plazos de los casos
// se arman contra ÉL — con `Date.now()` medirían contra otro reloj que el que
// recibe el componente, que es justo lo que este PR vino a impedir.
const NOW = new Date('2026-08-01T12:00:00Z')

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
      <ManualPaymentDialog bookings={[payableBooking as never]} now={NOW} defaultBookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
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
    // Requeridos por ManualPaymentBooking. Sin esto el fixture no es una reserva
    // que la app produzca, y el guard del plazo no se ejercita nunca. El `as
    // never` de los callers apaga el chequeo del compilador, así que acá no hay
    // más red que acordarse: los dos campos los lee el MISMO guard.
    holdExpiresAt: null,
    paymentStatus: 'unpaid',
    ...overrides,
  }
}

const HORA = 60 * 60 * 1000

// The conditional kebab items (Reprogramar / Registrar pago) aren't asserted here:
// Radix DropdownMenuContent renders into a portal that renderToStaticMarkup doesn't
// emit, so these tests cover the primary action + kebab trigger only, on purpose.
describe('BookingRowActions', () => {
  it('shows Completar as primary + kebab for a confirmed booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking() as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Completar')
    expect(html).toContain('Más acciones')
  })

  it('shows Cobrar as primary for a pending_payment booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'pending_payment' }) as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
  })

  it('keeps contact controls out of the fixed-width primary action area', () => {
    const html = renderToStaticMarkup(
      <BookingRowActions
        booking={rowBooking() as never}
        businessCurrency="CLP"
        contactMenu={<span>Confirmación</span>}
        now={NOW}
      />,
    )

    expect(html).toContain('data-slot="table-actions-primary"')
    expect(html).not.toMatch(/data-slot="table-actions-primary"[^]*Confirmación/)
  })

  // OJO: buscar 'disabled' pelado no sirve — las clases de Tailwind traen
  // `disabled:opacity-50` en TODOS los botones. La propiedad real es `disabled=""`.
  it('con el plazo vivo el Cobrar sigue habilitado', () => {
    const booking = rowBooking({ status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + HORA) })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
    expect(html).not.toContain('disabled=""')
  })

  it('con el plazo vencido deshabilita Cobrar y explica por qué', () => {
    // El server rechaza este cobro (assertBookingPayable). Antes el botón estaba
    // habilitado y el clic moría en un error; que ahora DESAPAREZCA sin decir
    // nada sería igual de malo, así que queda deshabilitado con el motivo.
    const booking = rowBooking({ status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() - HORA) })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('disabled=""')
    expect(html).toContain('Revivir')
    // Cancelar sigue disponible en el menú: la fila nunca queda muda.
    expect(html).toContain('Más acciones')
  })

  it('con el plazo vencido pero el abono adentro, Cobrar sigue habilitado', () => {
    // El plazo vencido cierra el cobro porque el cron va a expirar la reserva.
    // Con plata adentro el cron la saltea, así que deshabilitar el botón la
    // dejaba sin salida: ni cobrar, ni el Expirada que habilita Revivir.
    const booking = rowBooking({
      status: 'pending_payment',
      holdExpiresAt: new Date(NOW.getTime() - HORA),
      paymentStatus: 'deposit_paid',
    })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
    expect(html).not.toContain('disabled=""')
  })

  it('renders nothing actionable for a terminal booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'completed', remainingBalance: 0 }) as never} businessCurrency="CLP" now={NOW} />)
    expect(html).not.toContain('Completar')
    expect(html).not.toContain('Cobrar')
    expect(html).not.toContain('Más acciones')
  })

  it('uses inline contact controls for an expired booking, never menu items outside a menu', () => {
    const html = renderToStaticMarkup(
      <BookingRowActions
        booking={rowBooking({ status: 'expired' }) as never}
        businessCurrency="CLP"
        contactMenu={<BookingContactButtons variant="menu" booking={{
          customerName: 'Ana', customerPhone: '+56912345678', serviceName: 'Manicura', professionalName: null,
          startDateTime: NOW, businessTimezone: 'America/Santiago', businessCurrency: 'CLP', totalPrice: 0,
          depositPaid: 0, remainingBalance: 0, modality: 'on_site', businessAddress: 'Calle Uno 1',
        }} />}
        contactInline={<span>Contacto compacto</span>}
        now={NOW}
      />,
    )

    expect(html).toContain('Contacto compacto')
    expect(html).not.toContain('Enviar confirmación')
  })
})

describe('BookingContactButtons menu variant', () => {
  it('renders contact actions as actual dropdown menu items', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <DropdownMenu open>
          <DropdownMenuContent forceMount>
            <BookingContactButtons
              variant="menu"
              booking={{
                customerName: 'Ana',
                customerPhone: '+56912345678',
                serviceName: 'Manicura',
                professionalName: 'Paula',
                startDateTime: NOW,
                businessTimezone: 'America/Santiago',
                businessCurrency: 'CLP',
                totalPrice: 45000,
                depositPaid: 15000,
                remainingBalance: 30000,
                modality: 'on_site',
                businessAddress: 'Calle Uno 1',
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>,
      )
    })

    expect(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]')).toHaveLength(4)
    expect(document.body.textContent).toContain('Enviar confirmación')
    await act(async () => root.unmount())
  })
})
