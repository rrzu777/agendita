import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({
  confirmBankTransfer: vi.fn(),
  rejectBankTransfer: vi.fn(),
}))

import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

// El reloj del servidor: la sección lo pide para no leer `Date.now()` adentro.
const NOW = new Date('2026-07-15T12:00:00Z')

const row = {
  paymentId: 'p1',
  bookingId: 'b1',
  customerName: 'Ana',
  customerPhone: '+56911112222',
  serviceName: 'Corte',
  startDateTime: new Date('2026-07-15T14:00:00Z'),
  amount: 8000,
  declaredAt: new Date('2026-07-15T09:00:00Z'),
  kind: 'deposit' as const,
  proofKey: null,
  proofContentType: null,
}

describe('PendingTransfersSection', () => {
  it('renders a pending transfer row with wa.me and actions', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection items={[row]} businessCurrency="CLP" businessTimezone="America/Santiago" now={NOW} />,
    )
    expect(html).toContain('Ana')
    expect(html).toContain('wa.me/')
    expect(html).toContain('Verificar')
    expect(html).toContain('Rechazar')
  })

  it('renders nothing when empty', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection items={[]} businessCurrency="CLP" businessTimezone="America/Santiago" now={NOW} />,
    )
    expect(html).toBe('')
  })
})
