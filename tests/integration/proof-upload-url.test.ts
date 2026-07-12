import { describe, it, expect, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { createProofUploadUrl } from '@/server/actions/bank-transfer-public'
import { seedDeclaredTransfer, cleanupBankTransferSeed } from './helpers/bank-transfer-seed'

requireTestDatabase()

// Flujo público: identidad = bookingId (cuid) + rate limit. Mockeamos el rate
// limit y le inyectamos un ProofStorage falso vía `deps.storage` para que CI
// nunca toque R2 real. La semilla reutiliza seedDeclaredTransfer (negocio +
// bankTransferAccount isEnabled + booking pending_payment, paymentMethod
// 'bank_transfer').
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const fakeStorage = {
  presignUpload: vi.fn().mockResolvedValue('https://signed/put'),
  presignDownload: vi.fn(),
  head: vi.fn(),
}

// El helper solo necesita la reserva-transferencia; no hace falta el Payment declarado.
function seedTransferBooking() {
  return seedDeclaredTransfer({ declared: false })
}

describe('createProofUploadUrl', () => {
  afterAll(async () => {
    await cleanupBankTransferSeed()
  })

  it('devuelve uploadUrl + key para una reserva-transferencia elegible', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const res = await createProofUploadUrl(bookingId, 'deposit', 'image/png', { storage: fakeStorage })
    expect(res.key).toBe(`proofs/${businessId}/${bookingId}/deposit`)
    expect(res.uploadUrl).toBe('https://signed/put')
    expect(fakeStorage.presignUpload).toHaveBeenCalledWith(`proofs/${businessId}/${bookingId}/deposit`, 'image/png')
  })

  it('rechaza content-type no permitido', async () => {
    const { bookingId } = await seedTransferBooking()
    await expect(
      createProofUploadUrl(bookingId, 'deposit', 'image/gif', { storage: fakeStorage }),
    ).rejects.toThrow()
  })

  it('rechaza si R2 no está disponible (deps.storage=null)', async () => {
    const { bookingId } = await seedTransferBooking()
    await expect(
      createProofUploadUrl(bookingId, 'deposit', 'image/png', { storage: null }),
    ).rejects.toThrow()
  })
})
