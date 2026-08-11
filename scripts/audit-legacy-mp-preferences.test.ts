import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { classifyLegacyPayment, parseArgs, auditLegacyPreferences } = require('./audit-legacy-mp-preferences.cjs')

describe('legacy Mercado Pago preference audit', () => {
  it('requires an explicit cutoff and enforces a bounded batch', () => {
    expect(() => parseArgs([])).toThrow(/--before/)
    expect(() => parseArgs(['--before', '2026-08-11T00:00:00Z', '--limit', '101'])).toThrow(/between 1 and 100/)
  })

  it('classifies only safe pending ownership for local reissue', () => {
    expect(classifyLegacyPayment({ bookingId: 'b', packagePurchaseId: null, accountConnected: true, status: 'pending', providerPaymentId: null })).toBe('reissue')
    expect(classifyLegacyPayment({ bookingId: 'b', packagePurchaseId: 'p', accountConnected: true, status: 'pending', providerPaymentId: null })).toBe('manual_review')
    expect(classifyLegacyPayment({ bookingId: 'b', packagePurchaseId: null, accountConnected: false, status: 'pending', providerPaymentId: null })).toBe('manual_review')
    expect(classifyLegacyPayment({ bookingId: 'b', packagePurchaseId: null, accountConnected: true, status: 'approved', providerPaymentId: 'mp' })).toBe('no_action')
  })

  it('is DB-only and mutation-free by default', async () => {
    const prisma = {
      payment: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    }
    await expect(auditLegacyPreferences(prisma, {
      before: new Date('2026-08-11T00:00:00Z'), limit: 50, apply: false,
    })).resolves.toEqual({ reissue: 0, manual_review: 0, no_action: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
