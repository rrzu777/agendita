import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'
import { prisma } from '@/lib/db'
import { declareBankTransfer, attachProof } from '@/server/actions/bank-transfer-public'
import { btDeclaredId } from '@/lib/bank-transfer/declared'
import {
  seedDeclaredTransfer,
  cleanupBankTransferSeed,
  BT_VERIFY_BIZ,
} from './helpers/bank-transfer-seed'

requireTestDatabase()

// Flujo público: identidad = bookingId (cuid) + rate limit. Mockeamos rate limit
// y notificaciones, e inyectamos un ProofStorage falso vía `opts.storage` para
// que CI nunca toque R2 real. El HEAD es la validación server-authoritative
// (existencia + tamaño ≤ límite + tipo permitido) que se hace ANTES de la tx.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/notifications', async (orig) => ({
  ...(await orig<typeof import('@/lib/notifications')>()),
  sendMultiNotificationSafely: vi.fn(),
}))

const okHead = {
  presignUpload: vi.fn(),
  presignDownload: vi.fn(),
  head: vi.fn().mockResolvedValue({ contentLength: 1000, contentType: 'image/png' }),
}
const bigHead = {
  presignUpload: vi.fn(),
  presignDownload: vi.fn(),
  head: vi.fn().mockResolvedValue({ contentLength: 99_000_000, contentType: 'image/png' }),
}

// El helper crea la reserva-transferencia (pending_payment, paymentMethod
// 'bank_transfer', hold vigente); `declared:false` la deja SIN el Payment.
function seedTransferBooking() {
  return seedDeclaredTransfer({ declared: false })
}

describe('declare con proofKey', () => {
  // El negocio sembrado es compartido: reseteamos el gate antes de cada test.
  // updateMany (no update) para no romper si aún no se sembró el negocio.
  beforeEach(async () => {
    await prisma.business.updateMany({
      where: { id: BT_VERIFY_BIZ },
      data: { requireTransferProof: false },
    })
  })
  afterAll(async () => {
    await cleanupBankTransferSeed()
  })

  it('guarda proofKey/proofContentType tras HEAD ok', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await declareBankTransfer(bookingId, { proofKey: key, proofContentType: 'image/png', storage: okHead })
    const p = await prisma.payment.findFirst({
      where: { bookingId, providerPaymentId: btDeclaredId(bookingId) },
    })
    expect(p?.proofKey).toBe(key)
    expect(p?.proofContentType).toBe('image/png')
  })

  it('rechaza si el HEAD reporta tamaño > 5MB', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await expect(
      declareBankTransfer(bookingId, { proofKey: key, proofContentType: 'image/png', storage: bigHead }),
    ).rejects.toThrow()
  })

  it('rechaza un proofKey que no corresponde a la reserva', async () => {
    const { bookingId } = await seedTransferBooking()
    await expect(
      declareBankTransfer(bookingId, {
        proofKey: 'proofs/otro/otro/deposit',
        proofContentType: 'image/png',
        storage: okHead,
      }),
    ).rejects.toThrow()
  })

  it('gate requireTransferProof: rechaza declare sin proofKey', async () => {
    const { bookingId } = await seedTransferBooking()
    await prisma.business.update({
      where: { id: BT_VERIFY_BIZ },
      data: { requireTransferProof: true },
    })
    await expect(declareBankTransfer(bookingId, {})).rejects.toThrow()
  })

  it('gate requireTransferProof: acepta declare con proof válido', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    await prisma.business.update({
      where: { id: BT_VERIFY_BIZ },
      data: { requireTransferProof: true },
    })
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await declareBankTransfer(bookingId, { proofKey: key, proofContentType: 'image/png', storage: okHead })
    const p = await prisma.payment.findFirst({
      where: { bookingId, providerPaymentId: btDeclaredId(bookingId) },
    })
    expect(p?.proofKey).toBe(key)
  })

  it('declare sin proof (gate off) no guarda proofKey', async () => {
    const { bookingId } = await seedTransferBooking()
    await declareBankTransfer(bookingId, {})
    const p = await prisma.payment.findFirst({
      where: { bookingId, providerPaymentId: btDeclaredId(bookingId) },
    })
    expect(p?.proofKey).toBeNull()
  })
})

describe('attachProof', () => {
  afterAll(async () => {
    await cleanupBankTransferSeed()
  })

  it('adjunta a un Payment ya declarado (pending)', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    await declareBankTransfer(bookingId, {})
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await attachProof(bookingId, 'deposit', { proofKey: key, proofContentType: 'image/png', storage: okHead })
    const p = await prisma.payment.findFirst({
      where: { bookingId, providerPaymentId: btDeclaredId(bookingId) },
    })
    expect(p?.proofKey).toBe(key)
    expect(p?.proofContentType).toBe('image/png')
  })

  it('rechaza si no hay transferencia declarada pendiente', async () => {
    const { bookingId, businessId } = await seedTransferBooking()
    const key = `proofs/${businessId}/${bookingId}/deposit`
    await expect(
      attachProof(bookingId, 'deposit', { proofKey: key, proofContentType: 'image/png', storage: okHead }),
    ).rejects.toThrow()
  })
})
