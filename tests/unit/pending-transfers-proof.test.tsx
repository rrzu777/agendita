import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({ confirmBankTransfer: vi.fn(), rejectBankTransfer: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ buildWhatsappUrl: () => 'https://wa.me/x' }))

import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

const base = {
  paymentId: 'pay-123',
  bookingId: 'b1',
  customerName: 'Ana',
  customerPhone: null,
  serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T12:00:00Z'),
  amount: 10000,
  declaredAt: new Date('2026-08-01T10:00:00Z'),
  kind: 'deposit' as const,
  proofKey: null,
  proofContentType: null,
}

describe('PendingTransfersSection · Ver comprobante', () => {
  it('renderiza el enlace al comprobante cuando hay proofKey', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection
        items={[{ ...base, proofKey: 'proofs/b/pay-123/deposit', proofContentType: 'image/png' }]}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
      />,
    )
    expect(html).toContain('Ver comprobante')
    expect(html).toContain('/dashboard/transfers/proof/pay-123')
  })

  it('NO renderiza el enlace cuando falta proofKey', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection
        items={[{ ...base, proofKey: null, proofContentType: null }]}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
      />,
    )
    expect(html).not.toContain('Ver comprobante')
    expect(html).not.toContain('/dashboard/transfers/proof/')
  })
})
