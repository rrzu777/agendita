import { describe, expect, it, vi } from 'vitest'
import { claimApprovedProviderPayment } from './provider-incidents'

function txMock() {
  return {
    payment: { updateMany: vi.fn(), findUnique: vi.fn() },
    paymentProviderIncident: { upsert: vi.fn() },
  }
}

describe('claimApprovedProviderPayment', () => {
  it('claims an unbound local payment with a compare-and-set', async () => {
    const tx = txMock()
    tx.payment.updateMany.mockResolvedValue({ count: 1 })

    await expect(claimApprovedProviderPayment(tx as never, {
      paymentId: 'local-1', environment: 'sandbox', providerPaymentId: 'mp-1',
      payload: { id: 'mp-1', status: 'approved' },
    })).resolves.toEqual({ kind: 'claimed' })

    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'local-1', OR: [{ providerPaymentId: null }, { providerPaymentId: 'mp-1' }] },
    }))
    expect(tx.paymentProviderIncident.upsert).not.toHaveBeenCalled()
  })

  it('durably classifies a distinct concurrent approval for manual overpayment review', async () => {
    const tx = txMock()
    tx.payment.updateMany.mockResolvedValue({ count: 0 })
    tx.payment.findUnique.mockResolvedValue({ providerPaymentId: 'mp-winner' })
    tx.paymentProviderIncident.upsert.mockResolvedValue({ id: 'incident-1' })

    await expect(claimApprovedProviderPayment(tx as never, {
      paymentId: 'local-1', environment: 'sandbox', providerPaymentId: 'mp-second',
      payload: { id: 'mp-second', status: 'approved', payer: { email: 'secret@example.com' } } as never,
    })).resolves.toEqual({ kind: 'conflict', winnerProviderPaymentId: 'mp-winner' })

    expect(tx.paymentProviderIncident.upsert).toHaveBeenCalledWith({
      where: { environment_providerPaymentId: { environment: 'sandbox', providerPaymentId: 'mp-second' } },
      update: {},
      create: expect.objectContaining({
        paymentId: 'local-1', environment: 'sandbox', providerPaymentId: 'mp-second',
        dedupeKey: 'approved:sandbox:mp-second',
        kind: 'distinct_approved_overpayment', status: 'manual_review',
        payload: { id: 'mp-second', status: 'approved' },
      }),
    })
  })
})
