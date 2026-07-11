import { describe, expect, it } from 'vitest'
import { canSelfManage, SELF_MANAGEABLE_STATUSES } from '@/lib/bookings/self-service'

const NOW = new Date('2026-07-11T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000)

describe('canSelfManage', () => {
  it('permite cuando falta más que la ventana', () => {
    expect(canSelfManage(hoursFromNow(25), 24, NOW)).toBe(true)
  })
  it('bloquea cuando falta menos que la ventana', () => {
    expect(canSelfManage(hoursFromNow(23), 24, NOW)).toBe(false)
  })
  it('borde exacto: exactamente 24h NO alcanza (la regla es estrictamente mayor)', () => {
    expect(canSelfManage(hoursFromNow(24), 24, NOW)).toBe(false)
  })
  it('0 = sin límite, pero solo para reservas futuras', () => {
    expect(canSelfManage(hoursFromNow(0.5), 0, NOW)).toBe(true)
    expect(canSelfManage(hoursFromNow(-1), 0, NOW)).toBe(false)
  })
  it('reserva pasada nunca es gestionable', () => {
    expect(canSelfManage(hoursFromNow(-2), 24, NOW)).toBe(false)
  })
})

describe('SELF_MANAGEABLE_STATUSES', () => {
  it('solo pending_payment y confirmed (únicos con transición válida a cancelled)', () => {
    expect(SELF_MANAGEABLE_STATUSES).toEqual(['pending_payment', 'confirmed'])
  })
})
