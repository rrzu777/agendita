import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BookingLegalAcceptance } from '@/components/booking/booking-legal-acceptance'
import { BookingSummary } from '@/components/booking/booking-summary'

describe('booking review UI', () => {
  it('renders the promoted total and requested deposit variant', () => {
    const html = renderToStaticMarkup(
      <BookingSummary
        serviceName="Manicure"
        startsAt={new Date('2026-08-05T14:00:00Z')}
        timezone="America/Santiago"
        price={20_000}
        currency="CLP"
        promotion={{ discount: 2_000, finalPrice: 18_000 }}
        deposit={{ label: 'Abono requerido', amount: 5_000 }}
      />,
    )

    expect(html).toContain('Manicure')
    expect(html).toContain('Descuento')
    expect(html).toContain('−$2.000')
    expect(html).toContain('Precio final')
    expect(html).toContain('$18.000')
    expect(html).toContain('Abono requerido')
    expect(html).toContain('$5.000')
  })

  it('keeps the legal checkbox controlled by its parent', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onAcceptedChange = vi.fn()

    await act(async () => {
      root.render(
        <BookingLegalAcceptance
          policy="Puedes cancelar hasta 24 horas antes."
          accepted={false}
          onAcceptedChange={onAcceptedChange}
        />,
      )
    })

    const checkbox = container.querySelector<HTMLInputElement>('#accept-terms')!
    expect(checkbox.checked).toBe(false)
    expect(container.textContent).toContain('Puedes cancelar hasta 24 horas antes.')

    await act(async () => {
      checkbox.click()
    })

    expect(onAcceptedChange).toHaveBeenCalledWith(true)

    await act(async () => {
      root.unmount()
    })
  })
})
