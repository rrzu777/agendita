import { describe, it, expect } from 'vitest'
import { bankTransferBlockHtml, bankTransferBlockText } from '@/lib/notifications/templates'

const bt = {
  accountHolder: 'Ana Díaz', rut: '11.111.111-1', bankName: 'Banco X', accountType: 'corriente',
  accountNumber: '123456', email: 'ana@x.cl', instructions: 'Poné tu nombre',
  deadline: { kind: 'window' as const, at: new Date('2026-07-15T18:00:00Z') }, confirmationUrl: 'https://bella.agendita.cl/book/confirmation?bookingId=b1',
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

  // Con el techo puesto por la cita, la fecha del plazo ES el final del turno
  // que el mismo email cuenta arriba: imprimirla le da a la clienta un dato
  // nuevo que en realidad ya leyó. Las palabras se entienden solas.
  it('cuando el techo es la cita lo dice así, sin repetir la fecha del turno', () => {
    const cita = { ...bt, deadline: { kind: 'appointment' as const } }
    const html = bankTransferBlockHtml(cita, '$8.000 CLP', 'America/Santiago')
    const text = bankTransferBlockText(cita, '$8.000 CLP', 'America/Santiago').join('\n')
    expect(html).toContain('tenés hasta tu cita para transferir')
    expect(text).toContain('Plazo: hasta tu cita')
    expect(html).not.toContain('de julio')
    expect(text).not.toContain('de julio')
  })

  it('sin plazo no aparece la línea', () => {
    const html = bankTransferBlockHtml({ ...bt, deadline: null }, '$8.000 CLP', 'America/Santiago')
    expect(html).not.toContain('Plazo')
  })
})
