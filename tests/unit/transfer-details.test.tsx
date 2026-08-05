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
      <TransferDetails bank={bank} amount={5000} currency="CLP" deadlinePhrase="las 15:00" declaring={false} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).toContain('BancoEstado')
    expect(html).toContain('12345678')
    expect(html).toContain('nombre en el asunto')
    expect(html).toContain('Ya transferí')
    expect(html).toContain('5.000')
    expect(html).toContain('Tenés hasta')
    expect(html).toContain('las 15:00')
  })

  // El plazo llega redactado, no como fecha: cuando el techo es la cita la
  // frase es "tu cita" y la pantalla la tiene que poder decir tal cual.
  it('dice el plazo con las palabras que le pasan, sin re-formatear', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} currency="CLP" deadlinePhrase="tu cita" declaring={false} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).toContain('Tenés hasta')
    expect(html).toContain('tu cita')
    expect(html).toContain('Si no recibimos el pago, la reserva puede vencer.')
    expect(html).not.toContain('Después de eso el horario se libera.')
  })

  it('sin deadline no muestra plazo y el botón declara ocupado', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={5000} currency="CLP" deadlinePhrase={null} declaring={true} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).not.toContain('Tenés hasta')
    expect(html).toContain('Avisando')
  })
})
