import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const mockCreateBooking = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/bookings', () => ({ createBooking: mockCreateBooking }))
vi.mock('@/server/actions/payments', () => ({
  initiatePayment: vi.fn(),
  verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: vi.fn().mockResolvedValue({ available: false, provider: null, isMock: false }),
}))
vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }),
}))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: vi.fn().mockResolvedValue(null),
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

function clickPorTexto(container: HTMLElement, texto: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(texto))
  if (!el) throw new Error(`No encontré el botón "${texto}"`)
  el.click()
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
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
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
          data={bookingData}
          updateData={vi.fn()}
          businessId="biz-1"
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
    await act(async () => { clickPorTexto(container, 'Confirmar reserva') })
    await act(async () => {})

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(mockCreateBooking).toHaveBeenCalledTimes(1)
    // La reserva ya existe: ofrecer "Confirmar reserva" otra vez es ofrecer una
    // segunda reserva del mismo horario.
    expect(container.textContent).not.toContain('Confirmar reserva')
    expect(container.textContent).toContain('Procesando tu reserva')

    await act(async () => { root.unmount() })
  })
})
