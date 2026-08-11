import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetOnlinePaymentAvailability = vi.hoisted(() => vi.fn())
const mockGetBankTransferInfo = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/bookings', () => ({
  createBooking: vi.fn(),
}))

vi.mock('@/server/actions/payments', () => ({
  initiatePayment: vi.fn(),
  verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: mockGetOnlinePaymentAvailability,
}))

vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }),
}))

vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: mockGetBankTransferInfo,
  declareBankTransfer: vi.fn(),
}))

const cancellationWarning = 'Podés cancelar o reprogramar hasta 24 horas antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.'

const bookingData = {
  serviceId: 'svc-1',
  serviceName: 'Manicure',
  servicePrice: 20000,
  serviceDuration: 60,
  serviceDeposit: 0,
  serviceColor: '',
  serviceModalities: ['on_site' as const],
  serviceModality: 'on_site' as const,
  serviceAddress: '',
  date: new Date('2026-06-15T00:00:00Z'),
  timeSlot: { start: new Date('2026-06-15T14:00:00Z'), end: new Date('2026-06-15T15:00:00Z') },
  customerName: 'Maria',
  customerPhone: '+56912345678',
  customerEmail: 'maria@test.com',
  customerNotes: '',
  professional: { kind: 'none' as const },
  professionalName: '',
  idempotencyKey: null,
}

describe('booking legal UI', () => {
  beforeEach(() => {
    mockGetOnlinePaymentAvailability.mockResolvedValue({ available: false, provider: null, isMock: false })
    mockGetBankTransferInfo.mockResolvedValue(null)
  })

  it('public booking payment step shows terms, privacy and refund links', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const html = renderToStaticMarkup(
      <StepPayment data={bookingData} updateData={vi.fn()} businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP" onSuccess={vi.fn()} onBack={vi.fn()} />,
    )

    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/refund-policy"')
  }, 10_000)

  it('public booking payment step shows business cancellation policy when provided', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const html = renderToStaticMarkup(
      <StepPayment
        data={bookingData}
        updateData={vi.fn()}
        businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP"
        cancellationPolicy="Puedes cancelar hasta 24 horas antes."
        onSuccess={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(html).toContain('Puedes cancelar hasta 24 horas antes.')
  })

  it('shows the exact structured warning before additional conditions in the manual-deposit branch', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <StepPayment
          data={{ ...bookingData, serviceDeposit: 5_000 }}
          updateData={vi.fn()}
          businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP"
          cancellationPolicy="No llegar más de 10 minutos tarde."
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})

    expect(container.textContent).toContain(cancellationWarning)
    expect(container.textContent!.indexOf(cancellationWarning))
      .toBeLessThan(container.textContent!.indexOf('No llegar más de 10 minutos tarde.'))

    await act(async () => root.unmount())
  })

  it('shows the exact structured warning in the online-deposit branch', async () => {
    mockGetOnlinePaymentAvailability.mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false })
    const { StepPayment } = await import('@/components/booking/step-payment')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <StepPayment
          data={{ ...bookingData, serviceDeposit: 5_000 }}
          updateData={vi.fn()}
          businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP"
          cancellationPolicy="Condición adicional online."
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})

    expect(container.textContent).toContain(cancellationWarning)
    expect(container.textContent!.indexOf(cancellationWarning))
      .toBeLessThan(container.textContent!.indexOf('Condición adicional online.'))

    await act(async () => root.unmount())
  })

  it('does not show the deposit warning in the no-deposit branch', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const html = renderToStaticMarkup(
      <StepPayment
        data={bookingData}
        updateData={vi.fn()}
        businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP"
        cancellationPolicy="Condición adicional sin abono."
        onSuccess={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(html).not.toContain('el abono no se devuelve')
    expect(html).toContain('Condición adicional sin abono.')
  })

  it('falls back to manual confirmation when online payment availability check fails', async () => {
    mockGetOnlinePaymentAvailability.mockRejectedValue(new Error('network down'))
    const { StepPayment } = await import('@/components/booking/step-payment')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <StepPayment
          data={{ ...bookingData, serviceDeposit: 5000 }}
          updateData={vi.fn()}
          businessId="biz-1" selfServiceCutoffHours={24} manualHoldHours={24} timezone="America/Santiago" currency="CLP"
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).not.toContain('Verificando disponibilidad de pago')
    expect(container.textContent).toContain('No pudimos verificar pago online')
    expect(container.textContent).toContain('Confirmar reserva')

    await act(async () => {
      root.unmount()
    })
  })
})
