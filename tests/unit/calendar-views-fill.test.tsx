import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/components/dashboard/block-time-modal', () => ({
  BlockTimeModal: () => null,
}))
vi.mock('@/components/dashboard/booking-drawer', () => ({
  BookingDrawer: () => null,
}))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({
  EditBlockDialog: () => null,
}))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))

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

describe('CalendarViews — accesibilidad de estado (día)', () => {
  it('el botón de una reserva cancelada expone el estado en su aria-label', () => {
    const cancelled = { ...booking, id: 'b2', status: 'cancelled' }
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="day" date="2026-06-30" bookings={[cancelled]} />,
    )
    expect(html).toContain('aria-label="Cancelada')
  })
})

describe('CalendarViews — estado visible en mes', () => {
  it('una reserva completada se ve atenuada en la vista de mes', () => {
    // El filtro de MonthView oculta 'cancelled' y 'no_show' por completo, así que
    // se usa 'completed' (kind 'done', opacity 0.85) para verificar que la opacidad
    // por estado sí se aplica en las filas de la vista de mes.
    const completed = { ...booking, id: 'b3', status: 'completed' }
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="month" date="2026-06-30" bookings={[completed]} />,
    )
    expect(html).toContain('opacity:0.85')
  })
})

const timeBlock = {
  id: 'block-1',
  startDateTime: '2026-06-30T17:00:00.000Z',
  endDateTime: '2026-06-30T18:00:00.000Z',
  reason: 'Almuerzo',
}

describe('CalendarViews — bloqueo interactivo (día)', () => {
  it('el bloqueo se renderiza como botón con aria-label descriptivo', () => {
    const html = renderToStaticMarkup(
      <CalendarViews {...baseProps} view="day" date="2026-06-30" bookings={[]} timeBlocks={[timeBlock]} />,
    )
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Bloqueo: Almuerzo"')
  })
})

describe('CalendarViews — reserva clicable en vista de mes (stretched link)', () => {
  it('la celda mantiene un link de fondo y la reserva es un botón independiente', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error props mínimos de prueba
      <CalendarViews {...baseProps} view="month" date="2026-06-30" bookings={[booking]} />,
    )
    expect(html).toContain('view=day')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('pointer-events-auto')
    expect(html).toContain('aria-label="Ana —')
  })
})
