import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({ confirmBankTransfer: vi.fn(), rejectBankTransfer: vi.fn() }))
// El componente importa buildWhatsappUrl del index de notifications: mockear
// el módulo para no arrastrar email-provider al entorno unit.
vi.mock('@/lib/notifications', () => ({ buildWhatsappUrl: () => 'https://wa.me/x' }))

import { PendingTransfersSection } from '@/components/dashboard/pending-transfers-section'

// El reloj del servidor: la sección lo pide para no leer `Date.now()` adentro.
const NOW = new Date('2026-08-01T12:00:00Z')

const base = {
  paymentId: 'p1',
  bookingId: 'b1',
  customerName: 'Ana',
  customerPhone: null,
  serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T12:00:00Z'),
  amount: 10000,
  declaredAt: new Date('2026-08-01T10:00:00Z'),
  proofKey: null,
  proofContentType: null,
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
        now={NOW}
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
        now={NOW}
      />,
    )
    expect(html).toContain('Rechazar')
    expect(html).toContain('Saldo')
  })

  /**
   * El "hace N min" sale del reloj que le pasan y no de `Date.now()`. Importa
   * porque esto lo renderiza el servidor y lo hidrata el navegador: con un
   * reloj propio, basta que cambie el minuto entre las dos cosas para que el
   * HTML y la hidratación difieran — hydration mismatch (React #418), que
   * tumba la página de Reservas entera, no esta línea.
   */
  it('el "declarado hace…" lo mide el reloj que recibe, no el de la máquina', () => {
    const html = renderToStaticMarkup(
      <PendingTransfersSection
        items={[{ ...base, kind: 'deposit' }]}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
        now={new Date('2026-08-01T10:30:00Z')}
      />,
    )
    expect(html).toContain('declarado hace 30 min')
  })
})
