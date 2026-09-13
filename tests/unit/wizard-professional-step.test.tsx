import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Service } from '@prisma/client'
import { getVocabulary } from '@/lib/vocabulary'
import { ANYONE_LABEL, type FunnelProfessional } from '@/lib/professionals/eligible'
import { serializeWizardState, wizardStorageKey } from '@/lib/bookings/wizard-storage'
import { wizardServiceFields } from '@/lib/bookings/wizard-selection'
import type { BookingData } from '@/components/booking/wizard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/bookings', () => ({ createBooking: vi.fn() }))
vi.mock('@/server/actions/payments', () => ({
  initiatePayment: vi.fn(), verifyAndConfirmPayment: vi.fn(),
  getOnlinePaymentAvailability: vi.fn().mockResolvedValue({ ok: true, data: { available: false } }),
}))
vi.mock('@/server/actions/packages', () => ({
  getActivePackagesForCustomer: vi.fn().mockResolvedValue({ ok: true, data: { remaining: 0 } }),
}))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  getBankTransferInfo: vi.fn().mockResolvedValue(null), declareBankTransfer: vi.fn(),
}))
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/availability', () => ({
  getAvailabilityPreview: vi.fn(() => new Promise(() => {})),
  getAvailableTimeSlotsResult: vi.fn().mockResolvedValue({ ok: true, data: { slots: [], emptyReason: 'unknown' } }),
}))

const { BookingWizard } = await import('@/components/booking/wizard')

const SERVICIO = {
  id: 'svc-1', name: 'Corte', description: null, price: 12000, depositAmount: 0,
  durationMinutes: 30, pastelColor: '#f4dbca', isActive: true, sortOrder: 0,
  modalities: ['on_site'],
} as unknown as Service

function persona(id: string, name: string): FunnelProfessional {
  return { id, name, bio: null, modalities: ['on_site'], serviceIds: ['svc-1'] }
}

describe('el wizard con equipo', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
    window.history.replaceState({}, '', '/')
  })

  function montar(professionals: FunnelProfessional[], services = [SERVICIO]) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <BookingWizard
          cancellationPolicyRevision="revision-1"
          selfServiceCutoffHours={24}
          manualHoldHours={24}
          businessId="biz-1"
          slug="test-biz"
          business={{ name: 'Barbería', addressText: null, whatsapp: null }}
          timezone="America/Santiago"
          currency="CLP"
          services={services}
          professionals={professionals}
          professionalWords={getVocabulary('barber')}
          session={null}
        />,
      )
    })
  }

  function elegirServicio() {
    const boton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Corte'))
    if (boton?.getAttribute('aria-pressed') !== 'true') act(() => boton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Continuar')?.click())
  }

  it('sin equipo mantiene las seis etapas visibles y salta a fecha con profesional auto-resuelto', () => {
    const scroll = vi.fn()
    HTMLElement.prototype.scrollIntoView = scroll
    montar([])
    expect(container.textContent).toContain('Paso 1 de 6')
    elegirServicio()
    expect(container.textContent).toContain('Paso 3 de 6')
    expect(container.textContent).toContain('Asignado automáticamente')
    expect(container.textContent).toContain('Fecha')
    expect(document.activeElement).toBe(container.querySelector('#booking-step-content'))
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })

  /**
   * El salto es la parte frágil: cuando la clienta elige el servicio, `steps` todavía
   * se calculó con el servicio ANTERIOR —el estado de React no cambió aún— así que
   * un "siguiente" por índice salteaba el paso que acababa de aparecer. Este test
   * falla si alguien lo vuelve a atar al índice.
   */
  it('con dos personas aparece el paso y la barra pasa a seis', () => {
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    elegirServicio()
    expect(container.textContent).toContain('Paso 2 de 6')
    expect(container.textContent).toContain('Elige tu barbero')
    expect(container.textContent).toContain('Juan')
    expect(container.textContent).toContain('Sofía')
  })

  // Que la reserva igual quede a su nombre y que su nombre aparezca al elegir la
  // hora lo cubren `professional-choice` y `step-time-professional`: acá sólo
  // importa que el paso NO se meta cuando no hay nada que preguntar.
  it('con una sola elegible no aparece el paso', () => {
    montar([persona('p-1', 'Juan')])
    elegirServicio()
    expect(container.textContent).toContain('Paso 3 de 6')
    expect(container.textContent).not.toContain('Elige tu barbero')
  })

  /**
   * Cambiar de servicio no le hace re-elegir persona a quien vuelve al mismo equipo:
   * si Sofía también hace el servicio nuevo, sigue marcada. La regla de "¿sobrevive
   * la elección?" es una sola y vive en `professionalFields`, la misma que usa el
   * restore — antes el wizard tenía la suya, que soltaba a la persona siempre.
   */
  it('la persona elegida sobrevive al cambio de servicio si también lo hace', () => {
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    elegirServicio()
    const sofia = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Sofía'))
    act(() => sofia?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // Atrás hasta el servicio y lo vuelve a elegir (mismo equipo elegible).
    act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Atrás')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Atrás')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    elegirServicio()

    expect(container.textContent).toContain('Elige tu barbero')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Sofía')
  })

  /**
   * "Cualquiera disponible" es una respuesta como cualquier otra: avanza igual, y
   * llega hasta el paso de la hora, que es donde cambia lo que se ofrece (la unión
   * del equipo en vez de la agenda de una).
   */
  it('elegir "cualquiera" requiere Continuar, y queda marcada al volver', () => {
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    elegirServicio()
    const cualquiera = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(ANYONE_LABEL))
    act(() => cualquiera?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('Paso 2 de 6')
    act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continuar')?.click())
    expect(container.textContent).toContain('Paso 3 de 6')

    act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Atrás')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain(ANYONE_LABEL)
  })

  /**
   * Con una sola elegible "cualquiera" ES esa persona, así que el paso no aparece y
   * la opción tampoco: ofrecerla sería preguntar entre una sola respuesta.
   */
  it('con una sola elegible tampoco se ofrece "cualquiera"', () => {
    montar([persona('p-1', 'Juan')])
    elegirServicio()
    expect(container.textContent).not.toContain(ANYONE_LABEL)
  })

  it('elegir persona sólo marca; Continuar lleva a la fecha', () => {
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    elegirServicio()
    const boton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Sofía'))
    act(() => boton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('Paso 2 de 6')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Sofía')
    act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continuar')?.click())
    expect(container.textContent).toContain('Paso 3 de 6')
    expect(container.textContent).toContain('Fecha')
  })
  it.each(['p-2', 'foreign', 'p-2&professional=p-1'])('validates the professional deep link %s without removing the choice', (value) => {
    window.history.replaceState({}, '', '/?professional=' + value)
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    elegirServicio()
    expect(container.textContent).toContain('Elige tu barbero')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain(value === 'p-2' ? 'Sofía' : ANYONE_LABEL)
  })
  it('aplica juntos los deep links válidos de servicio y profesional sin avanzar', () => {
    window.history.replaceState({}, '', '/?service=svc-1&professional=p-2')
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    expect(container.textContent).toContain('Paso 1 de 6')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Corte')
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Continuar')?.click())
    expect(container.textContent).toContain('Paso 2 de 6')
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Sofía')
  })
  it.each(['svc-1', 'foreign', 'svc-1&service=foreign'])('allowlists the service deep link %s without blocking multiselect', (value) => {
    window.history.replaceState({}, '', '/?service=' + value)
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')])
    const selected = container.querySelector('[aria-pressed="true"]')
    expect(Boolean(selected?.textContent.includes('Corte'))).toBe(value === 'svc-1')
  })
  it('a restored explicit choice wins over the original professional link after a cart edit', () => {
    const extra = { ...SERVICIO, id: 'nasal', name: 'Nasal' }
    const services = [SERVICIO, extra]
    const saved = { ...wizardServiceFields(['svc-1'], services), serviceModality: 'on_site', professional: { kind: 'person', id: 'p-2' }, professionalName: 'Sofía', date: null, timeSlot: null, customerName: '', customerPhone: '', customerEmail: '', customerNotes: '', serviceAddress: '', idempotencyKey: null } as BookingData
    sessionStorage.setItem(wizardStorageKey('biz-1'), serializeWizardState(saved)!)
    window.history.replaceState({}, '', '/?professional=p-1&continuar=1')
    montar([persona('p-1', 'Juan'), persona('p-2', 'Sofía')].map(p => ({ ...p, serviceIds: ['svc-1', 'nasal'] })), services)
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Atrás')?.click())
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Atrás')?.click())
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Nasal'))?.click())
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Continuar')?.click())
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Sofía')
  })
})
