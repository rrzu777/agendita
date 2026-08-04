import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const mockCreateBooking = vi.hoisted(() => vi.fn())
const mockGetBankTransferInfo = vi.hoisted(() => vi.fn())
const mockDeclareBankTransfer = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/bookings', () => ({ createBooking: mockCreateBooking }))
// Sin esto se carga el módulo `'use server'` de verdad con su cadena entera
// (Prisma, next/cache, auth): cientos de ms que se pagan por nada.
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/payments', () => ({
  initiatePayment: vi.fn(),
  verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: vi.fn().mockResolvedValue({ available: false, provider: null, isMock: false }),
}))
vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }),
}))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: mockGetBankTransferInfo,
  declareBankTransfer: mockDeclareBankTransfer,
  createProofUploadUrl: vi.fn(),
}))

const TZ = 'America/Santiago'
const INICIO = new Date('2026-08-03T14:00:00Z')
const FIN = new Date('2026-08-03T15:00:00Z')

const bank = {
  accountHolder: 'María P',
  rut: '1-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: null,
  instructions: null,
  holdHours: 24,
  requireProof: false,
}

const bookingData = {
  serviceId: 'svc-1',
  serviceName: 'Manicure',
  servicePrice: 20000,
  serviceDuration: 60,
  serviceDeposit: 5000,
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
 * El paso de transferencia se lleva la reserva adentro. Antes vivía en un
 * `useState` aparte y la pantalla la pedía al renderizar
 * (`if (bankInfo && transferBooking)`), así que un paso sin sus datos caía al
 * FORMULARIO DE PAGO de una reserva ya creada, con el horario ya tomado. Lo que
 * sostiene esto hoy es el tipo; lo que este test cuida es que el camino de
 * verdad —crear, declarar— siga llegando a donde tiene que llegar, ahora que la
 * reserva viaja por parámetro y no por estado.
 */
describe('StepPayment — la reserva viaja adentro del paso', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('avisar la transferencia lleva a "en verificación" con el código de ESA reserva', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    mockGetBankTransferInfo.mockResolvedValue(bank)
    mockCreateBooking.mockResolvedValue({
      ok: true,
      data: { id: 'b-42', bookingNumber: 7, holdExpiresAt: null, endDateTime: FIN },
    })
    mockDeclareBankTransfer.mockResolvedValue({ ok: true, data: {} })

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <StepPayment
          data={bookingData}
          updateData={vi.fn()}
          businessId="biz-1"
          manualHoldHours={24}
          timezone={TZ}
          currency="CLP"
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />,
      )
    })
    await act(async () => {})
    await act(async () => {
      container.querySelector<HTMLInputElement>('#accept-terms')!.click()
    })
    await act(async () => { clickPorTexto(container, 'Continuar con transferencia') })
    await act(async () => {})

    expect(container.textContent).toContain('BancoEstado')

    await act(async () => { clickPorTexto(container, 'Ya transferí') })
    await act(async () => {})

    expect(mockDeclareBankTransfer).toHaveBeenCalledWith('b-42', {})
    expect(container.textContent).toContain('Transferencia en verificación')
    expect(container.textContent).toContain('#7')
    // Y NO el formulario de pago: esa reserva ya existe y ya tiene el horario.
    expect(container.textContent).not.toContain('Continuar con transferencia')

    await act(async () => { root.unmount() })
    // Timeout propio: montar el wizard entero se come varios segundos y el
    // default de 5 s de la suite lo vuelve un dado bajo carga.
  }, 20_000)
})
