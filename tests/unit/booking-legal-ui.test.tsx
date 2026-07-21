import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetOnlinePaymentAvailability = vi.hoisted(() => vi.fn())

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
  getBankTransferInfo: vi.fn().mockResolvedValue(null),
  declareBankTransfer: vi.fn(),
}))

const bookingData = {
  serviceId: 'svc-1',
  serviceName: 'Manicure',
  servicePrice: 20000,
  serviceDuration: 60,
  serviceDeposit: 0,
  serviceColor: '',
  date: new Date('2026-06-15T00:00:00Z'),
  timeSlot: { start: new Date('2026-06-15T14:00:00Z'), end: new Date('2026-06-15T15:00:00Z') },
  customerName: 'Maria',
  customerPhone: '+56912345678',
  customerEmail: 'maria@test.com',
  customerNotes: '',
  idempotencyKey: null,
}

describe('booking legal UI', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    mockGetOnlinePaymentAvailability.mockResolvedValue({ available: false, provider: null, isMock: false })
  })

  it('public booking payment step shows terms, privacy and refund links', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const html = renderToStaticMarkup(
      <StepPayment data={bookingData} updateData={vi.fn()} businessId="biz-1" timezone="America/Santiago" currency="CLP" onSuccess={vi.fn()} onBack={vi.fn()} />,
    )

    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/refund-policy"')
  })

  it('public booking payment step shows business cancellation policy when provided', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    const html = renderToStaticMarkup(
      <StepPayment
        data={bookingData}
        updateData={vi.fn()}
        businessId="biz-1" timezone="America/Santiago" currency="CLP"
        cancellationPolicy="Puedes cancelar hasta 24 horas antes."
        onSuccess={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(html).toContain('Puedes cancelar hasta 24 horas antes.')
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
          businessId="biz-1" timezone="America/Santiago" currency="CLP"
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
