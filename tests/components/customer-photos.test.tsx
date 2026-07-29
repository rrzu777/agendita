import { describe, it, expect, vi } from 'vitest'
import { renderWithVocabulary } from '../helpers/vocabulary'

// El componente sólo importa server actions para llamarlas en respuesta a un
// evento; en un render estático no se ejecuta ninguna, pero el módulo real
// arrastra Prisma, así que se stubea entero.
vi.mock('@/server/actions/customer-photos', () => ({
  attachCustomerPhoto: vi.fn(),
  createCustomerPhotoUploadUrl: vi.fn(),
  deleteCustomerPhoto: vi.fn(),
  getPhotos: vi.fn(),
  updateCustomerPhotoCaption: vi.fn(),
}))

import { CustomerPhotos } from '@/components/dashboard/customer-photos'

const photo = {
  id: 'photo-1',
  bookingId: null,
  caption: 'Color 7.3',
  createdAt: '2026-07-20T15:00:00.000Z',
  url: '/dashboard/photos/photo-1',
}

describe('CustomerPhotos', () => {
  it('muestra las fotos por la ruta del panel, nunca por una URL del bucket', () => {
    const html = renderWithVocabulary(
      'nails',
      <CustomerPhotos target={{ customerId: 'c1' }} initialPhotos={[photo]} uploadEnabled />,
    )
    expect(html).toContain('/dashboard/photos/photo-1')
    expect(html).not.toContain('r2.cloudflarestorage.com')
    expect(html).toContain('Color 7.3')
  })

  it('sin fotos avisa en vez de dejar la grilla vacía', () => {
    const html = renderWithVocabulary(
      'nails',
      <CustomerPhotos target={{ customerId: 'c1' }} initialPhotos={[]} uploadEnabled />,
    )
    expect(html).toContain('Sin fotos todavía')
  })

  it('sin R2 configurado no ofrece subir, pero sigue mostrando lo que hay', () => {
    const html = renderWithVocabulary(
      'nails',
      <CustomerPhotos
        target={{ customerId: 'c1' }}
        initialPhotos={[photo]}
        uploadEnabled={false}
      />,
    )
    expect(html).not.toContain('Agregar fotos')
    expect(html).toContain('/dashboard/photos/photo-1')
  })

  it('si la carga falló muestra el error, no "sin fotos"', () => {
    const html = renderWithVocabulary(
      'nails',
      <CustomerPhotos
        target={{ customerId: 'c1' }}
        initialPhotos={[]}
        initialError="La subida de fotos no está disponible."
        uploadEnabled
      />,
    )
    expect(html).toContain('La subida de fotos no está disponible.')
    expect(html).not.toContain('Sin fotos todavía')
  })

  it('la advertencia de privacidad respeta el léxico del rubro', () => {
    const femenino = renderWithVocabulary(
      'nails',
      <CustomerPhotos target={{ customerId: 'c1' }} initialPhotos={[]} uploadEnabled />,
    )
    expect(femenino).toContain('la clienta no')

    const neutro = renderWithVocabulary(
      'barber',
      <CustomerPhotos target={{ customerId: 'c1' }} initialPhotos={[]} uploadEnabled />,
    )
    expect(neutro).toContain('el cliente no')
  })
})
