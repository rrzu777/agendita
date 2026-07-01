import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/dashboard/block-time-modal', () => ({
  BlockTimeModal: () => null,
}))
vi.mock('@/components/dashboard/booking-drawer', () => ({
  BookingDrawer: () => null,
}))

import { CalendarViews } from '@/components/dashboard/calendar-views'

const baseProps = {
  timeBlocks: [],
  todayKey: '2026-06-30',
  timezone: 'America/Santiago',
  businessCurrency: 'CLP',
  businessAddress: null,
}

const booking = {
  id: 'b1',
  startDateTime: '2026-06-30T17:00:00.000Z',
  endDateTime: '2026-06-30T18:00:00.000Z',
  status: 'confirmed',
  customer: { name: 'Ana' },
  service: { name: 'Corte', pastelColor: '#FFB3BA' },
}

describe('CalendarViews — relleno de color (día)', () => {
  it('pinta el bloque con el color del servicio y texto legible', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="day" date="2026-06-30" bookings={[booking]} />,
    ).toLowerCase()
    expect(html).toContain('background-color:#ffb3ba')
    expect(html).toContain('color:#1f2937')
    expect(html).toContain('ana')
  })
})

describe('CalendarViews — relleno de color (mes)', () => {
  it('pinta la filita de reserva con el color del servicio', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="month" date="2026-06-30" bookings={[booking]} />,
    ).toLowerCase()
    expect(html).toContain('background-color:#ffb3ba')
  })
})
