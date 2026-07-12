import { describe, it, expect } from 'vitest'
import { packageDisputedBusinessHtml, packageDisputedBusinessText } from '@/lib/notifications/templates'

const data = {
  businessName: 'Studio Ana',
  customerName: 'Ana',
  productName: 'Pack 5 sesiones',
  amount: 50000,
  businessCurrency: 'CLP',
}

describe('template PackageDisputed (a la dueña)', () => {
  it('html incluye clienta, producto y monto; no exige datos de reserva', () => {
    const html = packageDisputedBusinessHtml(data)
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    // monto formateado (50.000 en es-CL / CLP); al menos los dígitos base
    expect(html).toMatch(/50\.?000/)
  })
  it('text incluye clienta y producto', () => {
    const text = packageDisputedBusinessText(data)
    expect(text).toContain('Ana')
    expect(text).toContain('Pack 5 sesiones')
  })
})
