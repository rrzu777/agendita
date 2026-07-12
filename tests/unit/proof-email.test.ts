import { describe, it, expect } from 'vitest'
import {
  bankTransferDeclaredBusinessHtml,
  bankTransferDeclaredBusinessText,
  balanceTransferDeclaredBusinessHtml,
  balanceTransferDeclaredBusinessText,
} from '@/lib/notifications/templates'
import type { BankTransferDeclaredEmailData } from '@/lib/notifications/types'

const base: BankTransferDeclaredEmailData = {
  businessName: 'Salón Test',
  businessTimezone: 'America/Santiago',
  customerName: 'Ana',
  serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T15:00:00Z'),
  amount: 10000,
  currency: 'CLP',
  bookingNumber: 42,
}

describe('email declaró con comprobante (abono)', () => {
  it('incluye la línea de comprobante cuando hasProof', () => {
    const html = bankTransferDeclaredBusinessHtml({ ...base, hasProof: true })
    expect(html.toLowerCase()).toContain('adjuntó comprobante')
    const text = bankTransferDeclaredBusinessText({ ...base, hasProof: true })
    expect(text.toLowerCase()).toContain('adjuntó comprobante')
  })
  it('omite la línea cuando no hay comprobante', () => {
    const html = bankTransferDeclaredBusinessHtml({ ...base, hasProof: false })
    expect(html.toLowerCase()).not.toContain('adjuntó comprobante')
    const htmlUndef = bankTransferDeclaredBusinessHtml(base)
    expect(htmlUndef.toLowerCase()).not.toContain('adjuntó comprobante')
    const text = bankTransferDeclaredBusinessText({ ...base, hasProof: false })
    expect(text.toLowerCase()).not.toContain('adjuntó comprobante')
  })
})

describe('email declaró con comprobante (saldo)', () => {
  it('incluye la línea de comprobante cuando hasProof', () => {
    const html = balanceTransferDeclaredBusinessHtml({ ...base, hasProof: true })
    expect(html.toLowerCase()).toContain('adjuntó comprobante')
    const text = balanceTransferDeclaredBusinessText({ ...base, hasProof: true })
    expect(text.toLowerCase()).toContain('adjuntó comprobante')
  })
  it('omite la línea cuando no hay comprobante', () => {
    const html = balanceTransferDeclaredBusinessHtml({ ...base, hasProof: false })
    expect(html.toLowerCase()).not.toContain('adjuntó comprobante')
    const text = balanceTransferDeclaredBusinessText(base)
    expect(text.toLowerCase()).not.toContain('adjuntó comprobante')
  })
})
