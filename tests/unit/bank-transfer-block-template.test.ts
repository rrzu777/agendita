import { describe, it, expect } from 'vitest'
import { bankTransferBlockHtml, bankTransferBlockText } from '@/lib/notifications/templates'

const bt = {
  accountHolder: 'Ana Díaz', rut: '11.111.111-1', bankName: 'Banco X', accountType: 'corriente',
  accountNumber: '123456', email: 'ana@x.cl', instructions: 'Poné tu nombre',
  deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://bella.agendita.cl/book/confirmation?bookingId=b1',
}

describe('bankTransferBlock', () => {
  it('html incluye datos, plazo y link', () => {
    const html = bankTransferBlockHtml(bt, '$8.000 CLP', 'America/Santiago')
    expect(html).toContain('Ana Díaz'); expect(html).toContain('123456')
    expect(html).toContain('Plazo'); expect(html).toContain(bt.confirmationUrl)
  })
  it('text incluye datos y link', () => {
    const text = bankTransferBlockText(bt, '$8.000 CLP', 'America/Santiago').join('\n')
    expect(text).toContain('Banco X'); expect(text).toContain(bt.confirmationUrl)
  })
})
