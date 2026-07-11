import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/my-bookings', () => ({ cancelMyBooking: vi.fn() }))

import { BookingActions } from '@/app/mi/[slug]/booking-actions'

describe('BookingActions', () => {
  it('canManage: true → botón Cancelar reserva + link Reprogramar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage cutoffHours={24} />,
    )
    expect(html).toContain('Cancelar reserva')
    expect(html).toContain('Reprogramar')
    expect(html).toContain('href="/mi/salon-ana/reservas/b1/reprogramar"')
  })

  it('canManage: false, cutoffHours 24 → mensaje de ventana, sin botones', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage={false} cutoffHours={24} />,
    )
    expect(html.toLowerCase()).toContain('hasta 24 horas')
    expect(html.toLowerCase()).toContain('contacta al negocio')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
  })

  it('canManage: false, cutoffHours 0 → mensaje ya no se puede modificar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage={false} cutoffHours={0} />,
    )
    expect(html.toLowerCase()).toContain('ya no se puede modificar')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
  })
})
