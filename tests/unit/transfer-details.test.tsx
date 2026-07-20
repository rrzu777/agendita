import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransferDetails } from '@/components/booking/transfer-details'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const bank = {
  accountHolder: 'María P',
  rut: '1-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: null,
  instructions: 'nombre en el asunto',
  holdHours: 24,
  requireProof: false,
}

describe('TransferDetails', () => {
  it('muestra datos, monto y botón declarar', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} currency="CLP" deadline={new Date('2026-08-01T15:00:00Z')} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).toContain('BancoEstado')
    expect(html).toContain('12345678')
    expect(html).toContain('nombre en el asunto')
    expect(html).toContain('Ya transferí')
    expect(html).toContain('5.000')
    expect(html).toContain('Tenés hasta')
  })

  it('sin deadline no muestra plazo y el botón declara ocupado', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} currency="CLP" deadline={null} timezone="America/Santiago" declaring={true} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).not.toContain('Tenés hasta')
    expect(html).toContain('Avisando')
  })
})
