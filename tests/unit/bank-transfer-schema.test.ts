import { describe, it, expect } from 'vitest'
import { bankTransferAccountSchema } from '@/lib/bank-transfer/schema'

const valid = {
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: 'Poner nombre y fecha en el asunto',
  holdHours: 24,
  verifyHours: 48,
}

describe('bankTransferAccountSchema', () => {
  it('acepta un input completo válido', () => {
    const r = bankTransferAccountSchema.safeParse(valid)
    expect(r.success).toBe(true)
  })

  it('acepta email vacío e instructions ausente (opcionales)', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, email: '', instructions: undefined })
    expect(r.success).toBe(true)
  })

  it('acepta verifyHours null (sin límite, opt-in explícito)', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, verifyHours: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.verifyHours).toBeNull()
  })

  it('rechaza holdHours fuera de rango (0 y 169)', () => {
    expect(bankTransferAccountSchema.safeParse({ ...valid, holdHours: 0 }).success).toBe(false)
    expect(bankTransferAccountSchema.safeParse({ ...valid, holdHours: 169 }).success).toBe(false)
  })

  it('rechaza campos obligatorios en blanco', () => {
    expect(bankTransferAccountSchema.safeParse({ ...valid, accountHolder: '  ' }).success).toBe(false)
    expect(bankTransferAccountSchema.safeParse({ ...valid, accountNumber: '' }).success).toBe(false)
  })

  it('coerciona holdHours/verifyHours que llegan como string del form', () => {
    const r = bankTransferAccountSchema.safeParse({ ...valid, holdHours: '24', verifyHours: '48' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.holdHours).toBe(24)
      expect(r.data.verifyHours).toBe(48)
    }
  })
})
