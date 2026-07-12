import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({ confirmBankTransfer: vi.fn(), rejectBankTransfer: vi.fn() }))
// El componente importa buildWhatsappUrl del index de notifications: mockear
// el módulo para no arrastrar email-provider al entorno unit.
vi.mock('@/lib/notifications', () => ({ buildWhatsappUrl: () => 'https://wa.me/x' }))

import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

const base = {
  paymentId: 'p1',
  bookingId: 'b1',
  customerName: 'Ana',
  customerPhone: null,
  serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T12:00:00Z'),
  amount: 10000,
  declaredAt: new Date('2026-08-01T10:00:00Z'),
}

describe('PendingTransfersSection con kinds', () => {
  it('item de abono muestra badge Abono; item de saldo muestra badge Saldo', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection
        items={[
          { ...base, kind: 'deposit' },
          { ...base, paymentId: 'p2', kind: 'balance' },
        ]}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
      />,
    )
    expect(html).toContain('Abono')
    expect(html).toContain('Saldo')
  })

  it('renderiza el botón Rechazar para items de saldo sin fallar', () => {
    // El copy de rechazo vive en window.confirm (no en el HTML estático), así
    // que acá solo se verifica que el componente renderiza items de tipo
    // 'balance' sin fallar y sigue exponiendo el botón Rechazar.
    const html = renderToStaticMarkup(
      <PendingTransfersSection
        items={[{ ...base, kind: 'balance' }]}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
      />,
    )
    expect(html).toContain('Rechazar')
    expect(html).toContain('Saldo')
  })
})
