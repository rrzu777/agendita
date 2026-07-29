import { describe, it, expect } from 'vitest'
import {
  packagePurchasedCustomerHtml, packagePurchasedCustomerText,
  packageSoldBusinessHtml, packageSoldBusinessText,
} from './templates'

const data = {
  businessName: 'Studio Ana', customerName: 'Ana', productName: 'Pack 5 sesiones',
  totalSessions: 6, pricePaid: 50000, businessCurrency: 'CLP', cardLink: 'https://app/mi/demo',
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
    const html = packageSoldBusinessHtml({ ...data }, 'Clienta')
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
  })
  it('business text incluye la clientela', () => {
    expect(packageSoldBusinessText({ ...data }, 'Clienta')).toContain('Ana')
  })
  // El aviso al negocio nombra a la clientela con el término de su rubro.
  it('business usa la etiqueta que le pasa el rubro', () => {
    expect(packageSoldBusinessHtml({ ...data }, 'Cliente')).toContain('Cliente')
    expect(packageSoldBusinessHtml({ ...data }, 'Cliente')).not.toContain('Clienta')
    expect(packageSoldBusinessText({ ...data }, 'Cliente')).toContain('Cliente: Ana')
  })
})
