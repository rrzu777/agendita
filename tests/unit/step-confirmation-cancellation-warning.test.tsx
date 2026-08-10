import { describe, expect, expectTypeOf, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepConfirmation } from '@/components/booking/step-confirmation'
import type { BookingData } from '@/components/booking/wizard'
import type { ComponentProps } from 'react'

const base = {
  serviceId: 's1',
  serviceName: 'Manicure',
  servicePrice: 20_000,
  serviceDeposit: 5_000,
  timeSlot: {
    start: new Date('2026-07-20T15:00:00Z'),
    end: new Date('2026-07-20T16:00:00Z'),
  },
  customerName: 'Maria',
  customerPhone: '+56911111111',
  customerEmail: 'maria@example.com',
} as BookingData

const common = {
  timezone: 'America/Santiago',
  currency: 'CLP',
  bookingId: 'bk-1',
  bookingNumber: 4738,
  mode: 'paid' as const,
  promo: null,
  sessionEmail: null,
  business: { name: 'Nails', addressText: null, whatsapp: null },
  where: {},
  confirmed: true,
  professionalName: '',
}

describe('StepConfirmation cancellation warning', () => {
  it('requiere los tres valores autoritativos en su contrato', () => {
    type Props = ComponentProps<typeof StepConfirmation>
    type RequiresAuthoritativeValues = Props extends Record<
      'cancellationCutoffHours' | 'depositRequired' | 'depositPaid',
      number
    > ? true : false

    expectTypeOf<RequiresAuthoritativeValues>().toEqualTypeOf<true>()
  })

  it('muestra un aviso amber para una reserva con abono y cutoff positivo', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...common} data={base} cancellationCutoffHours={24} depositRequired={5_000} depositPaid={0} />,
    )

    expect(html).toContain('Podés cancelar o reprogramar hasta 24 horas antes.')
    expect(html).toContain('el abono no se devuelve')
    expect(html).toContain('bg-amber')
  })

  it('usa singular para cutoff de una hora', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...common} data={base} cancellationCutoffHours={1} depositRequired={5_000} depositPaid={0} />,
    )
    expect(html).toContain('hasta 1 hora antes')
  })

  it('omite el aviso cuando no hay abono', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...common} data={{ ...base, serviceDeposit: 5_000 }} cancellationCutoffHours={24} depositRequired={0} depositPaid={0} />,
    )
    expect(html).not.toContain('el abono no se devuelve')
  })

  it('omite el aviso con cutoff cero', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...common} data={base} cancellationCutoffHours={0} depositRequired={5_000} depositPaid={0} />,
    )
    expect(html).not.toContain('el abono no se devuelve')
  })

  it('muestra el aviso si el abono ya pagado es positivo aunque el requerido sea cero', () => {
    const html = renderToStaticMarkup(
      <StepConfirmation {...common} data={base} cancellationCutoffHours={24} depositRequired={0} depositPaid={5_000} />,
    )
    expect(html).toContain('el abono no se devuelve')
  })
})
