import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { BookingData } from '@/components/booking/wizard'

const getAvailableTimeSlots = vi.hoisted(() => vi.fn())
vi.mock('@/server/actions/availability', () => ({ getAvailableTimeSlots }))

const { StepTime } = await import('@/components/booking/step-time')

const base = {
  serviceId: 'svc-1', serviceName: 'Corte', professionalId: null, professionalName: '',
  date: new Date('2026-06-15T15:00:00Z'), timeSlot: null,
} as unknown as BookingData

describe('los horarios que pide el paso de la hora', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    getAvailableTimeSlots.mockReset()
    getAvailableTimeSlots.mockResolvedValue({ ok: true, data: [] })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  async function montar(data: BookingData) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<StepTime businessId="biz-1" timezone="America/Santiago" data={data} onSelect={() => {}} onBack={() => {}} />)
    })
  }

  /**
   * Es el punto de la feature: con persona los horarios salen de SU agenda. Si este
   * argumento vuelve a ser `null`, la pantalla ofrece las horas del negocio y la
   * reserva se cae recién al pagar, contra el horario de verdad.
   */
  it('los pide a nombre de la persona elegida', async () => {
    await montar({ ...base, professionalId: 'p-1', professionalName: 'Juan' })
    expect(getAvailableTimeSlots).toHaveBeenCalledWith('biz-1', 'svc-1', base.date, 'p-1')
  })

  it('sin persona, los del negocio', async () => {
    await montar(base)
    expect(getAvailableTimeSlots).toHaveBeenCalledWith('biz-1', 'svc-1', base.date, null)
  })

  it('nombra a la persona junto al servicio y la fecha', async () => {
    getAvailableTimeSlots.mockResolvedValue({ ok: true, data: [{ start: new Date('2026-06-15T18:00:00Z'), end: new Date('2026-06-15T18:30:00Z') }] })
    await montar({ ...base, professionalId: 'p-1', professionalName: 'Juan' })
    expect(container.textContent).toContain('Corte · Juan')
  })
})
