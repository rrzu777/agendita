import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAnalyticsStore, type AnalyticsStore } from '@/lib/analytics/client-store'
import { clickButton } from '../helpers/react-dom'

const mockCreateBooking = vi.hoisted(() => vi.fn())
const mockPreviewPromotion = vi.hoisted(() => vi.fn())
const onlineAvailability = vi.hoisted(() => vi.fn())
const initiate = vi.hoisted(() => vi.fn())
const bankInfo = vi.hoisted(() => vi.fn())
const packages = vi.hoisted(() => vi.fn())
let capture: AnalyticsStore
vi.mock('@/components/analytics/public-analytics', () => ({ usePublicAnalytics: () => ({ ready: true, startAttempt: (kind: 'partial' | 'complete') => capture.startAttempt(kind), track: (...args: Parameters<AnalyticsStore['track']>) => capture.track(...args), changeSelection: (data: Parameters<AnalyticsStore['changeSelection']>[0]) => capture.changeSelection(data), revision: () => capture.snapshot()?.revision ?? 1, bookingCredential: () => capture.bookingCredential(), completeAttempt: () => capture.completeAttempt() }) }))
beforeEach(() => {
  vi.clearAllMocks()
  onlineAvailability.mockResolvedValue({ available: false, provider: null, isMock: false })
  bankInfo.mockResolvedValue(null)
  packages.mockResolvedValue({ ok: true, data: { remaining: 0 } })
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  capture = createAnalyticsStore({ businessId: 'biz-1', origin: 'https://test.local', storage, preferences: storage })
  capture.chooseConsent(true); capture.open(); capture.startAttempt('complete')
  capture.mutate((state) => { state.streams.find((s) => s.key === state.active)!.receipt = { id: crypto.randomUUID(), credential: 'signed-fixture', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), retentionExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() } })
})

vi.mock('@/server/actions/bookings', () => ({ createBooking: mockCreateBooking }))
// Sin este mock se carga el módulo `'use server'` de verdad, con su cadena
// entera (Prisma, next/cache, auth): son cientos de ms por archivo, y con el
// pool de workers peleado es la diferencia con el timeout de 5 s.
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: mockPreviewPromotion }))
vi.mock('@/server/actions/payments', () => ({
  initiatePayment: initiate,
  verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: onlineAvailability,
}))
vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: packages,
}))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: bankInfo,
  declareBankTransfer: vi.fn(),
  createProofUploadUrl: vi.fn(),
}))

const TZ = 'America/Santiago'
const INICIO = new Date('2026-08-03T14:00:00Z')
const FIN = new Date('2026-08-03T15:00:00Z')

/** Sin abono: la pantalla que se ve es "Confirmar reserva" y el botón crea la
 *  reserva de una, sin pasar por ningún checkout. */
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
  date: new Date('2026-08-03T00:00:00Z'),
  timeSlot: { start: INICIO, end: FIN },
  customerName: 'Maria',
  customerPhone: '+56912345678',
  customerEmail: 'maria@test.com',
  customerNotes: '',
  professional: { kind: 'none' as const },
  professionalName: '',
  idempotencyKey: null,
}

/**
 * El componente elige pantalla por `step` primero y por los datos después. La
 * clase de bug que eso evita ya pasó una vez (#159): una rama que sólo miraba
 * los datos tapaba a una que miraba el `step`, y la reserva se creaba mientras
 * la pantalla no se movía.
 *
 * `'success'` era el siguiente caso de la misma clase y no lo cubría nadie: no
 * tenía rama propia, así que caía en la pantalla de los datos —el formulario de
 * una reserva que YA existe—. Hoy no se ve porque `onSuccess()` desmonta el
 * paso en el mismo tick, o sea que la garantía la pone el PADRE. Acá el padre
 * no desmonta nada a propósito: es la única forma de mirar lo que este
 * componente decide solo.
 */
describe('StepPayment — la pantalla la manda el step', () => {
  it('late opt-in at payment observes only the current visible branch with a partial attempt', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    capture.discardState(); capture.open()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const container = document.createElement('div'); const root = createRoot(container)
    try {
      await act(async () => root.render(<StepPayment data={bookingData} updateData={vi.fn()} businessId="biz-1" timezone={TZ} currency="CLP" cancellationPolicyRevision="revision-1" selfServiceCutoffHours={24} manualHoldHours={24} onSuccess={vi.fn()} onBack={vi.fn()} />))
      expect(capture.snapshot()?.active).toBeNull()
      visibility.mockReturnValue('visible')
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      const state = capture.snapshot()!
      expect(state.streams.find((s) => s.key === state.active)?.entryKind).toBe('partial')
      expect(state.queue.map((q) => q.event.type)).toEqual(['payment_branch_viewed'])
    } finally { await act(async () => root.unmount()); visibility.mockRestore() }
  })
  it.each(['transfer', 'checkout_failed', 'package', 'promotion_zero'] as const)('completes the attempt at Booking creation for %s, not at payment confirmation', async (kind) => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    if (kind === 'transfer') bankInfo.mockResolvedValue({ accountHolder: 'Fixture', rut: '1-9', bankName: 'Fixture', accountType: 'vista', accountNumber: '123', email: null, instructions: null, holdHours: 24, requireProof: false })
    if (kind === 'checkout_failed') { onlineAvailability.mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false }); initiate.mockResolvedValue({ ok: false, error: 'Checkout fixture failed' }) }
    if (kind === 'package') packages.mockResolvedValue({ ok: true, data: { remaining: 2 } })
    mockCreateBooking.mockResolvedValue({ ok: true, data: { id: 'booking-fixture', bookingNumber: 1, status: 'pending_payment', modality: 'on_site', serviceAddress: null, meetingUrl: null, professional: null, holdExpiresAt: null, endDateTime: FIN } })
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
    await act(async () => root.render(<StepPayment data={{ ...bookingData, serviceDeposit: 5000 }} updateData={vi.fn()} businessId="biz-1" timezone={TZ} currency="CLP" cancellationPolicyRevision="revision-1" selfServiceCutoffHours={24} manualHoldHours={24} onSuccess={vi.fn()} onBack={vi.fn()} />))
    if (kind === 'promotion_zero') {
      mockPreviewPromotion.mockResolvedValue({ ok: true, data: { ok: true, promotionId: 'promotion-fixture', discount: 20000, finalAmount: 0 } })
      const input = container.querySelector<HTMLInputElement>('#promo-code')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'PRIVATE100'); input.dispatchEvent(new Event('input', { bubbles: true })) })
      await clickButton(container, 'Aplicar')
    }
    const branch = capture.snapshot()?.queue.filter((q) => q.event.type === 'payment_branch_viewed').at(-1)?.event.data
    expect(branch).toMatchObject({ condition: kind === 'package' ? 'package' : kind === 'promotion_zero' ? 'promotion_zero' : 'deposit_required' })
    expect(capture.snapshot()?.queue.some((q) => q.event.type === 'payment_method_selected')).toBe(false)
    await act(async () => container.querySelector<HTMLInputElement>('#accept-terms')!.click())
    await clickButton(container, kind === 'transfer' ? 'Continuar con transferencia' : kind === 'checkout_failed' ? 'Pagar abono' : 'Confirmar reserva', { match: 'contains' })
    expect(mockCreateBooking.mock.calls[0][0].analytics).toMatchObject({ credential: 'signed-fixture' })
    expect(capture.snapshot()?.active).toBeNull()
    const events = capture.snapshot()!.queue.map((q) => q.event)
    expect(events.filter((e) => e.type === 'booking_submit_result').map((e) => e.data.result)).toEqual(['submitted'])
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE100|customerPhone|amount|20000|5000/)
    if (kind === 'checkout_failed') expect(container.textContent).toContain('Checkout fixture failed')
    if (kind === 'transfer') expect(container.textContent).toContain('Transferí el abono')
    await act(async () => root.unmount()); container.remove()
  })
  it('ignores an obsolete promotion preview after selection changes', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    let resolve!: (value: unknown) => void
    mockPreviewPromotion.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    const render = (serviceId: string) => root.render(<StepPayment data={{ ...bookingData, serviceId }} updateData={vi.fn()} businessId="biz-1" timezone={TZ} currency="CLP" cancellationPolicyRevision="revision-1" selfServiceCutoffHours={24} manualHoldHours={24} onSuccess={vi.fn()} onBack={vi.fn()} />)
    await act(async () => render('svc-1'))
    const input = container.querySelector<HTMLInputElement>('#promo-code')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'PRIVATE-CODE')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickButton(container, 'Aplicar')
    await act(async () => render('svc-2'))
    await act(async () => resolve({ ok: true, data: { ok: true, promotionId: 'promotion-1', discount: 20000, finalAmount: 0 } }))
    expect(container.textContent).not.toContain('Tu código cubre el total')
    expect(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Aplicar')?.disabled).toBe(false)
    expect(capture.snapshot()?.queue.some((q) => q.event.type === 'promotion_result')).toBe(false)
    await act(async () => root.unmount())
    container.remove()
  })
  it('con la reserva ya creada no vuelve a ofrecer el formulario', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    mockCreateBooking.mockResolvedValue({
      ok: true,
      data: {
        id: 'b1',
        bookingNumber: 7,
        status: 'confirmed',
        modality: 'on_site',
        serviceAddress: null,
        meetingUrl: null,
        professional: null,
      },
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    // Un padre que NO desmonta: si la exhaustividad dependiera sólo de él, acá
    // reaparecería el botón de confirmar sobre una reserva que ya se creó.
    const onSuccess = vi.fn()
    await act(async () => {
      root.render(
        <StepPayment
          cancellationPolicyRevision="revision-1"
          data={bookingData}
          updateData={vi.fn()}
          businessId="biz-1"
          selfServiceCutoffHours={24}
          manualHoldHours={24}
          timezone={TZ}
          currency="CLP"
          onSuccess={onSuccess}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})

    expect(container.textContent).toContain('Confirmar reserva')

    await act(async () => {
      container.querySelector<HTMLInputElement>('#accept-terms')!.click()
    })
    await clickButton(container, 'Confirmar reserva', { match: 'contains' })
    await act(async () => {})

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(mockCreateBooking).toHaveBeenCalledTimes(1)
    expect(mockCreateBooking.mock.calls[0][0].analytics).toMatchObject({ credential: 'signed-fixture' })
    expect(capture.snapshot()?.active).toBeNull()
    expect(capture.snapshot()?.queue.map((q) => q.event.type)).toEqual(expect.arrayContaining(['payment_branch_viewed', 'booking_submit_result']))
    // La reserva ya existe: ofrecer "Confirmar reserva" otra vez es ofrecer una
    // segunda reserva del mismo horario.
    expect(container.textContent).not.toContain('Confirmar reserva')
    expect(container.textContent).toContain('Procesando tu reserva')

    await act(async () => { root.unmount() })
    // Timeout propio: montar el wizard entero con `createRoot` se come varios
    // segundos, y con el pool de workers peleado el default de 5 s de la suite
    // convierte este test en un dado. No es lentitud del caso, es el arranque.
  }, 20_000)
})
