import { describe, it, expect } from 'vitest'
import {
  packagePurchasedCustomerHtml, packagePurchasedCustomerText,
  packageSoldBusinessHtml, packageSoldBusinessText,
} from './templates'

const data = {
  businessName: 'Studio Ana', businessCategory: 'nails' as const, customerName: 'Ana',
  productName: 'Pack 5 sesiones', totalSessions: 6, pricePaid: 50000,
  businessCurrency: 'CLP', cardLink: 'https://app/mi/demo',
}

describe('templates de paquete', () => {
  it('customer html incluye producto, sesiones y link', () => {
    const html = packagePurchasedCustomerHtml(data)
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('6')
    expect(html).toContain('https://app/mi/demo')
  })
  it('customer text incluye producto', () => {
    expect(packagePurchasedCustomerText(data)).toContain('Pack 5 sesiones')
  })
  it('business html incluye la clientela y el producto', () => {
    const html = packageSoldBusinessHtml(data)
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('Clienta')
  })
  it('business text incluye la clientela', () => {
    expect(packageSoldBusinessText(data)).toContain('Clienta: Ana')
  })
  // El aviso al negocio nombra a la clientela con el término del rubro, que viaja
  // en el mismo data que businessName — no como un string suelto del caller.
  it('business deriva la etiqueta del rubro del negocio', () => {
    const barber = { ...data, businessCategory: 'barber' as const }
    expect(packageSoldBusinessHtml(barber)).toContain('Cliente')
    expect(packageSoldBusinessHtml(barber)).not.toContain('Clienta')
    expect(packageSoldBusinessText(barber)).toContain('Cliente: Ana')
  })
})
