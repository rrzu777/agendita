import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * El estado cerrado del control (el abierto necesita interacción y fetch; su
 * lógica de servidor está cubierta en reassign-booking.test.ts).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/server/actions/bookings', () => ({
  getReassignTargets: vi.fn(),
  reassignBooking: vi.fn(),
}))

import { ReassignControl } from '@/components/dashboard/reassign-control'

describe('ReassignControl', () => {
  it('con persona el botón dice Reasignar', () => {
    const html = renderToStaticMarkup(
      <ReassignControl bookingId="bk-1" currentName="RaulBarbero" />,
    )

    expect(html).toContain('Reasignar')
    expect(html).not.toContain('>Asignar')
  })

  it('sin persona dice Asignar: una cita vieja sin dueña también se reparte', () => {
    const html = renderToStaticMarkup(
      <ReassignControl bookingId="bk-1" currentName={null} />,
    )

    expect(html).toContain('Asignar')
    expect(html).not.toContain('Reasignar')
  })
})
