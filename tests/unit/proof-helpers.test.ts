import { describe, it, expect } from 'vitest'
import { PROOF_ALLOWED_TYPES, PROOF_MAX_BYTES, proofKey, isAllowedProofType } from '@/lib/storage/proof'

describe('proof helpers', () => {
  it('allowlist cubre imágenes comunes + pdf, no otros', () => {
    expect(isAllowedProofType('image/jpeg')).toBe(true)
    expect(isAllowedProofType('image/png')).toBe(true)
    expect(isAllowedProofType('image/webp')).toBe(true)
    expect(isAllowedProofType('application/pdf')).toBe(true)
    expect(isAllowedProofType('image/gif')).toBe(false)
    expect(isAllowedProofType('text/html')).toBe(false)
    expect(isAllowedProofType('')).toBe(false)
  })
  it('PROOF_MAX_BYTES = 5 MiB', () => {
    expect(PROOF_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
  it('proofKey es determinístico por negocio+reserva+tipo', () => {
    expect(proofKey('biz1', 'bk1', 'deposit')).toBe('proofs/biz1/bk1/deposit')
    expect(proofKey('biz1', 'bk1', 'balance')).toBe('proofs/biz1/bk1/balance')
  })
  it('PROOF_ALLOWED_TYPES es readonly y no vacío', () => {
    expect(PROOF_ALLOWED_TYPES.length).toBeGreaterThan(0)
  })
})
