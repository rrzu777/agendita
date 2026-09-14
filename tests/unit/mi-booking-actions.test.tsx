import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { refreshMock, cancelBookingMock } = vi.hoisted(() => ({ refreshMock: vi.fn(), cancelBookingMock: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }))
vi.mock('@/server/actions/my-bookings', () => ({ cancelMyBooking: cancelBookingMock }))

import { BookingActions } from '@/app/mi/[slug]/booking-actions'
import { rescheduleBlockedReason } from '@/lib/bookings/hold'
import { ClientBusinessShell } from '@/components/client/client-shell'

describe('BookingActions', () => {
  it('canManage: true → botón Cancelar reserva + link Reprogramar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" serviceName="Manicure" startsAtLabel="lunes 14 de septiembre, 10:00" canManage cutoffHours={24} rescheduleBlockedReason={null} />,
    )
    expect(html).toContain('Cancelar reserva')
    expect(html).toContain('Reprogramar')
    expect(html).toContain('href="/mi/salon-ana/reservas/b1/reprogramar"')
  })

  it('canManage: false, cutoffHours 24 → mensaje de ventana, sin botones', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" serviceName="Manicure" startsAtLabel="lunes 14 de septiembre, 10:00" canManage={false} cutoffHours={24} rescheduleBlockedReason={null} />,
    )
    expect(html.toLowerCase()).toContain('hasta 24 horas')
    expect(html.toLowerCase()).toContain('contacta al negocio')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
  })

  it('canManage: false, cutoffHours 0 → mensaje ya no se puede modificar', () => {
    const html = renderToStaticMarkup(
      <BookingActions bookingId="b1" slug="salon-ana" serviceName="Manicure" startsAtLabel="lunes 14 de septiembre, 10:00" canManage={false} cutoffHours={0} rescheduleBlockedReason={null} />,
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
        serviceName="Manicure"
        startsAtLabel="lunes 14 de septiembre, 10:00"
        canManage
        cutoffHours={24}
        rescheduleBlockedReason={rescheduleBlockedReason(
          {
            status: 'pending_payment',
            paymentStatus: 'unpaid',
            holdExpiresAt: new Date(Date.now() - 60_000),
            approvalExpiresAt: null,
          },
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

  it('confirma la cancelación en un alert dialog contextual y restaura el foco', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(
      <BookingActions bookingId="b1" slug="salon-ana" serviceName="Manicure" startsAtLabel="lunes 14 de septiembre, 10:00" canManage cutoffHours={24} rescheduleBlockedReason={null} />,
    ))

    const trigger = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancelar reserva')!
    trigger.focus()
    await act(async () => trigger.click())

    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain('Manicure')
    expect(dialog?.textContent).toContain('lunes 14 de septiembre, 10:00')
    expect(dialog?.textContent).toContain('horario volverá a quedar disponible')
    expect(document.activeElement?.textContent).toBe('Conservar reserva')

    await act(async () => {
      (document.activeElement as HTMLButtonElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(trigger)

    await act(async () => root.unmount())
    host.remove()
  })

  it('keeps an announced, focused cancellation result after refresh removes the booking actions', async () => {
    cancelBookingMock.mockResolvedValueOnce({ ok: true })
    let removeBooking: (() => void) | undefined
    let refreshRequested = false
    refreshMock.mockImplementationOnce(() => { refreshRequested = true })
    function Harness() {
      const [visible, setVisible] = useState(true)
      removeBooking = () => setVisible(false)
      return (
        <ClientBusinessShell business={{ name: 'Mimos', logoUrl: null, brandColor: null, visualStyle: 'balanced', category: 'nails' }} bookingHref="/book/mimos">
          {visible && <BookingActions bookingId="b1" slug="mimos" serviceName="Manicure" startsAtLabel="lunes 14 de septiembre, 10:00" canManage cutoffHours={24} rescheduleBlockedReason={null} />}
        </ClientBusinessShell>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Harness />))
    const trigger = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Cancelar reserva')!
    await act(async () => trigger.click())
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Cancelar reserva' && button !== trigger)!
    await act(async () => {
      confirm.click()
      await Promise.resolve()
    })
    // Flush Radix's deferred close-autofocus after React commits the closure.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(cancelBookingMock).toHaveBeenCalledWith('b1')
    expect(refreshRequested).toBe(true)
    const notice = host.querySelector('[role="status"]')
    expect(notice?.textContent).toContain('Reserva cancelada')
    expect(document.activeElement).toBe(notice)

    await act(async () => removeBooking?.())
    expect(host.textContent).not.toContain('Reprogramar')
    expect(notice?.textContent).toContain('Manicure')
    expect(notice?.textContent).toContain('lunes 14 de septiembre, 10:00')
    expect(document.activeElement).toBe(notice)

    await act(async () => root.unmount())
    host.remove()
  })
})
