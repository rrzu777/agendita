import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepConfirmation } from '@/components/booking/step-confirmation'
import type { BookingData } from '@/components/booking/wizard'

const base: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 0, serviceColor: '', date: null,
  timeSlot: { start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') },
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: null,
}
const props = { timezone: 'America/Santiago', bookingId: 'b1', bookingNumber: 4738, mode: 'paid' as const }

describe('StepConfirmation — CTA de cuenta', () => {
  it('sin sesión + con email: invita a crear cuenta con ese email', () => {
    const html = renderToStaticMarkup(<StepConfirmation {...props} data={base} sessionEmail={null} />)
    expect(html).toContain('Crea tu cuenta')
    expect(html).toContain('maria@example.com')
    expect(html).toContain('/ingresar?next=/mi')
  })

  it('sin sesión + sin email: NO muestra el CTA (evita el /mi vacío)', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...props} data={{ ...base, customerEmail: '' }} sessionEmail={null} />,
    )
    expect(html).not.toContain('Crea tu cuenta')
    expect(html).not.toContain('/ingresar')
  })

  it('con sesión: "Ver mis reservas" hacia /mi (home)', () => {
    const html = renderToStaticMarkup(<StepConfirmation {...props} data={base} sessionEmail="maria@example.com" />)
    expect(html).toContain('Ver mis reservas')
    expect(html).toContain('href="/mi"')
    expect(html).not.toContain('Crea tu cuenta')
  })
})
