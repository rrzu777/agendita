import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const mockCreateBooking = vi.hoisted(() => vi.fn())
const mockGetBankTransferInfo = vi.hoisted(() => vi.fn())

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
  declareBankTransfer: vi.fn(),
  createProofUploadUrl: vi.fn(),
}))

const TZ = 'America/Santiago'
// La cita: hoy a las 10:00 hora de Santiago, de una hora.
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

/** Click de verdad sobre el botón cuyo texto matchea. */
function clickPorTexto(container: HTMLElement, texto: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(texto))
  if (!el) throw new Error(`No encontré el botón "${texto}"`)
  el.click()
}

/**
 * La ventana de la transferencia son HORAS (24 por default), así que contra una
 * cita cercana el plazo cae después de la cita. Esta pantalla es la que se lo
 * promete a la clienta, y prometía la fecha cruda del hold.
 */
describe('StepPayment — el plazo que promete la pantalla de transferencia', () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // Sólo el reloj: `toFake: ['Date']` deja andar los timers de verdad, que es
    // de lo que dependen los efectos del wizard para resolver.
    vi.useFakeTimers({ toFake: ['Date'] })
    // Dos horas antes de la cita: el hold de 24 h se pasa de largo.
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('no se pasa de la cita: dice "tu cita", no el día siguiente', async () => {
    const { StepPayment } = await import('@/components/booking/step-payment')
    mockGetBankTransferInfo.mockResolvedValue(bank)
    mockCreateBooking.mockResolvedValue({
      ok: true,
      data: {
        id: 'b1',
        bookingNumber: 7,
        // Lo que escribe createBooking: ahora + holdHours, sin mirar la cita.
        holdExpiresAt: new Date('2026-08-04T12:00:00Z'),
        endDateTime: FIN,
      },
    })

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
    // Sin pago online y con cuenta bancaria configurada la pantalla ya está en
    // el camino de transferencia: no hay selector que elegir.
    await act(async () => {})
    await act(async () => {
      const check = container.querySelector<HTMLInputElement>('#accept-terms')!
      check.click()
    })
    await act(async () => { clickPorTexto(container, 'Continuar con transferencia') })
    await act(async () => {})

    // Que la pantalla haya avanzado no es decorado: sin esto la reserva se crea
    // igual —hold corriendo, mail saliendo— y la clienta se queda mirando el
    // mismo botón.
    expect(container.textContent).toContain('BancoEstado')
    expect(container.textContent).toContain('Tenés hasta tu cita')
    // El día siguiente es lo que decía antes, y es justamente lo que no puede decir.
    expect(container.textContent).not.toContain('4 de agosto')
    expect(container.textContent).not.toContain('04-08-2026')

    await act(async () => { root.unmount() })
    // Timeout propio: montar el wizard entero se come varios segundos y el
    // default de 5 s de la suite lo vuelve un dado bajo carga.
  }, 20_000)
})
