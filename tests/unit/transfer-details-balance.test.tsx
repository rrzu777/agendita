import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TransferDetails } from '@/components/booking/transfer-details'

const bank = {
  accountHolder: 'Ana',
  rut: '1-1',
  bankName: 'X',
  accountType: 'corriente',
  accountNumber: '123',
  email: null,
  instructions: null,
  holdHours: 24,
  requireProof: false,
}

describe('TransferDetails variante saldo', () => {
  it('default sigue diciendo abono', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={8000} currency="CLP" deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" />,
    )
    expect(html).toContain('abono')
  })

  it('variante saldo dice saldo y no muestra plazo', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank} amount={8000} currency="CLP" deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" kind="balance" />,
    )
    expect(html).toContain('saldo')
    expect(html).not.toContain('abono')
  })
})
