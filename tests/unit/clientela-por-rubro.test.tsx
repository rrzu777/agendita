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
      <CustomerList customers={[]} nextCursor={null} stats={{ total: 0, withBookings: 0, withPendingBalance: 0 }} error={null} currency="CLP" />,
    )
    expect(html).toContain('Sin clientas')
    expect(html).toContain('Las clientas aparecerán aquí')
    expect(html).not.toContain('clientes')
  })

  it('vacía, una barbería ve "Sin clientes"', () => {
    const html = renderWithVocabulary(
      'barber',
      <CustomerList customers={[]} nextCursor={null} stats={{ total: 0, withBookings: 0, withPendingBalance: 0 }} error={null} currency="CLP" />,
    )
    expect(html).toContain('Sin clientes')
    expect(html).toContain('Los clientes aparecerán aquí')
    expect(html).not.toContain('clientas')
  })

  it('envía la búsqueda global por URL y conserva el término al paginar', () => {
    const html = renderWithVocabulary(
      'barber',
      <CustomerList
        customers={[{
          id: 'customer-1', name: 'Martín', phone: '+56912345678', email: 'martin@example.com', notes: null,
          birthDate: null, marketingOptOut: false, bookingCount: 1, lastBookingAt: null,
          totalPaidApproved: 0, pendingBalance: 0, createdAt: new Date('2026-08-01'),
        }]}
        nextCursor="customer-1"
        stats={{ total: 51, withBookings: 1, withPendingBalance: 0 }}
        error={null}
        currency="CLP"
        searchQuery="Martín"
      />,
    )

    expect(html).toContain('name="q"')
    expect(html).toContain('Buscar por nombre, teléfono o email en todo el historial')
    expect(html).toContain('q=Mart%C3%ADn&amp;cursor=customer-1')
  })
})
