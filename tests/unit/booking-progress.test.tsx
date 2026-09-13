import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BookingProgress } from '@/components/booking/booking-progress'

describe('BookingProgress', () => {
  it('siempre explica las seis etapas del recorrido', () => {
    const html = renderToStaticMarkup(
      <BookingProgress currentStep="service" professionalMode="pending" />,
    )

    expect(html).toContain('Paso 1 de 6')
    for (const label of ['Servicios', 'Profesional', 'Fecha y hora', 'Tus datos', 'Pago y políticas', 'Confirmación']) {
      expect(html).toContain(label)
    }
  })

  it('representa el paso profesional auto-resuelto sin alterar el paso actual', () => {
    const html = renderToStaticMarkup(
      <BookingProgress currentStep="date" professionalMode="automatic" />,
    )

    expect(html).toContain('Paso 3 de 6')
    expect(html).toContain('Asignado automáticamente')
    expect(html).toContain('aria-current="step"')
  })
})
