import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StepConfirmation } from '@/components/booking/step-confirmation'
import type { BookingData } from '@/components/booking/wizard'

const data = {
  serviceId: 'svc-1',
  serviceName: 'Corte',
  servicePrice: 20000,
  serviceDeposit: 0,
  date: new Date('2026-08-01T12:00:00Z'),
  timeSlot: { start: new Date('2026-08-01T12:00:00Z'), end: new Date('2026-08-01T13:00:00Z') },
  customerName: 'Ana',
  customerPhone: '+56911111111',
  customerEmail: '',
} as unknown as BookingData

describe('StepConfirmation booking number', () => {
  it('renders #<number> when present', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation data={data} bookingId="clabc12345" bookingNumber={4738} mode="paid" promo={null} />,
    )
    expect(html).toContain('#4738')
  })

  it('falls back to the cuid slice when number is null', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation data={data} bookingId="clabc12345" bookingNumber={null} mode="paid" promo={null} />,
    )
    expect(html).toContain('#clabc123')
  })
})
