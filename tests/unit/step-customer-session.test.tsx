import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepCustomer } from '@/components/booking/step-customer'
import type { BookingData } from '@/components/booking/wizard'

const data: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 0, serviceColor: '', date: null, timeSlot: null,
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: null,
}
const noop = vi.fn()

describe('StepCustomer con sesión', () => {
  it('sin sesión: muestra el banner "¿Ya tienes cuenta?"', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={{ ...data, customerName: '', customerPhone: '', customerEmail: '' }} sessionEmail={null} onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('¿Ya tienes cuenta?')
    expect(html).toContain('Ingresa')
  })

  it('con sesión: muestra "Reservando como" + "No soy yo" y NO el banner', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={data} sessionEmail="maria@example.com" onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('Reservando como maria@example.com')
    expect(html).toContain('No soy yo')
    expect(html).not.toContain('¿Ya tienes cuenta?')
  })
})
