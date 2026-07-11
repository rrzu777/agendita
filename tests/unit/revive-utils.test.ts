import { describe, it, expect } from 'vitest'
import { getReviveReopenState } from '@/components/dashboard/revive-utils'
import { BANK_TRANSFER_METHOD } from '@/lib/bank-transfer/declared'

const future = new Date(Date.now() + 24 * 3_600_000)
const past = new Date(Date.now() - 24 * 3_600_000)

describe('getReviveReopenState', () => {
  it('futuro + transferencia + cuenta habilitada → canReopen', () => {
    const s = getReviveReopenState({ startDateTime: future, paymentMethod: BANK_TRANSFER_METHOD }, true)
    expect(s).toEqual({ canReopen: true, reason: null })
  })

  it('turno pasado gana sobre las otras razones', () => {
    const s = getReviveReopenState({ startDateTime: past, paymentMethod: null }, false)
    expect(s.canReopen).toBe(false)
    expect(s.reason).toContain('turno ya pasó')
  })

  it('futuro sin transferencia → razón de método', () => {
    const s = getReviveReopenState({ startDateTime: future, paymentMethod: null }, true)
    expect(s.canReopen).toBe(false)
    expect(s.reason).toContain('no eligió transferencia')
  })

  it('futuro + transferencia con cuenta deshabilitada → razón de Pagos', () => {
    const s = getReviveReopenState({ startDateTime: future, paymentMethod: BANK_TRANSFER_METHOD }, false)
    expect(s.canReopen).toBe(false)
    expect(s.reason).toContain('deshabilitada en Pagos')
  })

  it('acepta startDateTime como string ISO', () => {
    const s = getReviveReopenState({ startDateTime: future.toISOString(), paymentMethod: BANK_TRANSFER_METHOD }, true)
    expect(s.canReopen).toBe(true)
  })
})
