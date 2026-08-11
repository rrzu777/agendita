import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'

const mockCreateBooking = vi.hoisted(() => vi.fn())
const mockInitiatePayment = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/bookings', () => ({ createBooking: mockCreateBooking }))
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/payments', () => ({
  initiatePayment: mockInitiatePayment,
  verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: vi.fn().mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false }),
}))
vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }),
}))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: vi.fn().mockResolvedValue(null),
  declareBankTransfer: vi.fn(),
  createProofUploadUrl: vi.fn(),
}))

const bookingData = {
  serviceId: 'svc-1',
  serviceName: 'Manicure',
  servicePrice: 20_000,
  serviceDuration: 60,
  serviceDeposit: 5_000,
  serviceColor: '',
  serviceModalities: ['on_site' as const],
  serviceModality: 'on_site' as const,
  serviceAddress: '',
  date: new Date('2026-08-12T00:00:00Z'),
  timeSlot: { start: new Date('2026-08-12T14:00:00Z'), end: new Date('2026-08-12T15:00:00Z') },
  customerName: 'Maria',
  customerPhone: '+56912345678',
  customerEmail: 'maria@test.com',
  customerNotes: '',
  professional: { kind: 'none' as const },
  professionalName: '',
  idempotencyKey: null,
}

describe('StepPayment push grant redirect handoff', () => {
  afterEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('stores the server-issued grant before handing control to Mercado Pago', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    mockCreateBooking.mockResolvedValue({
      ok: true,
      data: {
        id: 'booking-1',
        pushGrant: 'server-signed-grant',
        pushMode: 'guest',
        bookingNumber: 7,
        status: 'pending_payment',
        modality: 'on_site',
        serviceAddress: null,
        meetingUrl: null,
        professional: null,
        cancellationCutoffHours: 24,
        cancellationPolicySnapshot: null,
        depositRequired: 5_000,
        depositPaid: 0,
      },
    })
    // A same-document fragment avoids jsdom's unsupported full navigation while
    // still exercising the redirect branch and the ordering before assignment.
    mockInitiatePayment.mockResolvedValue({
      ok: true,
      data: { paymentId: 'payment-1', redirectUrl: '#mercado-pago' },
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <StepPayment
          data={bookingData}
          updateData={vi.fn()}
          businessId="business-1"
          selfServiceCutoffHours={24}
          cancellationPolicyRevision="policy-revision-1"
          manualHoldHours={24}
          timezone="America/Santiago"
          currency="CLP"
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})
    await act(async () => container.querySelector<HTMLInputElement>('#accept-terms')!.click())
    await clickButton(container, 'Pagar abono', { match: 'contains' })

    expect(sessionStorage.getItem('agendita:push-grant:booking-1')).toBe('server-signed-grant')
    expect(mockCreateBooking).toHaveBeenCalledWith(
      expect.objectContaining({ cancellationPolicyRevision: 'policy-revision-1' }),
      'business-1',
    )

    await act(async () => root.unmount())
  }, 20_000)

  it('continues to Mercado Pago without persisting a disabled null grant', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    mockCreateBooking.mockResolvedValue({
      ok: true,
      data: {
        id: 'booking-without-push',
        pushGrant: null,
        pushMode: null,
        bookingNumber: 8,
        status: 'pending_payment',
        modality: 'on_site',
        serviceAddress: null,
        meetingUrl: null,
        professional: null,
        cancellationCutoffHours: 24,
        cancellationPolicySnapshot: null,
        depositRequired: 5_000,
        depositPaid: 0,
      },
    })
    mockInitiatePayment.mockResolvedValue({
      ok: true,
      data: { paymentId: 'payment-2', redirectUrl: '#mercado-pago-without-push' },
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <StepPayment
          data={bookingData}
          updateData={vi.fn()}
          businessId="business-1"
          selfServiceCutoffHours={24}
          cancellationPolicyRevision="policy-revision-1"
          manualHoldHours={24}
          timezone="America/Santiago"
          currency="CLP"
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})
    await act(async () => container.querySelector<HTMLInputElement>('#accept-terms')!.click())
    await clickButton(container, 'Pagar abono', { match: 'contains' })

    expect(mockInitiatePayment).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('agendita:push-grant:booking-without-push')).toBeNull()
    expect(window.location.hash).toBe('#mercado-pago-without-push')

    await act(async () => root.unmount())
  }, 20_000)
})
