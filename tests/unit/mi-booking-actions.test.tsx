import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/my-bookings', () => ({ cancelMyBooking: vi.fn() }))

import { BookingActions } from '@/app/mi/[slug]/booking-actions'
import { rescheduleBlockedReason } from '@/lib/bookings/hold'

describe('BookingActions', () => {
  it('canManage: true → botón Cancelar reserva + link Reprogramar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage cutoffHours={24} rescheduleBlockedReason={null} />,
    )
    expect(html).toContain('Cancelar reserva')
    expect(html).toContain('Reprogramar')
    expect(html).toContain('href="/mi/salon-ana/reservas/b1/reprogramar"')
  })

  it('canManage: false, cutoffHours 24 → mensaje de ventana, sin botones', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage={false} cutoffHours={24} rescheduleBlockedReason={null} />,
    )
    expect(html.toLowerCase()).toContain('hasta 24 horas')
    expect(html.toLowerCase()).toContain('contacta al negocio')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
  })

  it('canManage: false, cutoffHours 0 → mensaje ya no se puede modificar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" canManage={false} cutoffHours={0} rescheduleBlockedReason={null} />,
    )
    expect(html.toLowerCase()).toContain('ya no se puede modificar')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
  })

  // La fila de arriba ya decía "Expirada" (`statusLabel` adelanta el hold
  // muerto) y acá abajo había un "Reprogramar" que ADEMÁS funcionaba: la
  // reserva se movía y el cron la mataba dentro de la hora.
  it('plazo vencido: sin link de Reprogramar, con el motivo escrito', () => {
    const html = renderToStaticMarkup(
      <BookingActions
        bookingId="b1"
        slug="salon-ana"
        canManage
        cutoffHours={24}
        rescheduleBlockedReason={rescheduleBlockedReason(
          { status: 'pending_payment', paymentStatus: 'unpaid', holdExpiresAt: new Date(Date.now() - 60_000) },
          'customer',
          new Date(),
        )}
      />,
    )
    expect(html).not.toContain('href="/mi/salon-ana/reservas/b1/reprogramar"')
    expect(html.toLowerCase()).toContain('venció el plazo')
    // Y no la acusa de no haber pagado: el cron barre también la transferencia
    // ya declarada, así que este texto le puede caer a quien transfirió en fecha.
    expect(html).not.toContain('para pagar')
    // Cancelar se queda: es lo único que sobre una reserva condenada hace lo que
    // dice, y libera el horario sin esperar al cron.
    expect(html).toContain('Cancelar reserva')
  })
})
