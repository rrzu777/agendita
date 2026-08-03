import { describe, expect, it } from 'vitest'
import { CustomerList } from '@/app/dashboard/customers/customer-list'
import { renderWithVocabulary } from '../helpers/vocabulary'

// Regresión del barrido de "Cliente" masculino (la 4ª trampa del vocabulario):
// la sección Clientes era la superficie que un salón de uñas veía todos los días
// en masculino. Se prueba contra los DOS léxicos para que un hardcode en
// cualquiera de las dos direcciones falle.
describe('la sección Clientes habla en el género del rubro', () => {
  it('vacía, un salón de uñas ve "Sin clientas"', () => {
    const html = renderWithVocabulary(
      'nails',
      <CustomerList customers={[]} error={null} currency="CLP" />,
    )
    expect(html).toContain('Sin clientas')
    expect(html).toContain('Las clientas aparecerán aquí')
    expect(html).not.toContain('clientes')
  })

  it('vacía, una barbería ve "Sin clientes"', () => {
    const html = renderWithVocabulary(
      'barber',
      <CustomerList customers={[]} error={null} currency="CLP" />,
    )
    expect(html).toContain('Sin clientes')
    expect(html).toContain('Los clientes aparecerán aquí')
    expect(html).not.toContain('clientas')
  })
})
