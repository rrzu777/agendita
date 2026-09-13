import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicBusiness } from '@/lib/business/public'
import { BusinessProfile } from '@/components/public/business-profile'

const business = {
  id: 'biz-1',
  name: 'Barber Profit',
  slug: 'barber-profit',
  category: 'barber',
  brandColor: '#35524A',
  visualStyle: 'contrast',
  logoUrl: 'https://example.test/logo.png',
  profileImageUrl: null,
  bio: 'Cortes y barba con atención personalizada.',
  whatsapp: '56911111111',
  instagram: null,
  addressText: null,
  currency: 'CLP',
  services: [],
  availability: [],
  reviews: [],
  _count: { reviews: 0 },
} as unknown as PublicBusiness

describe('public booking redesign', () => {
  it('usa identidad real del tenant sin inventar una verificacion', () => {
    const html = renderToStaticMarkup(<BusinessProfile business={business} />)

    expect(html).toContain('data-business-theme')
    expect(html).toContain('Barber Profit')
    expect(html).toContain('logo.png')
    expect(html.toLowerCase()).not.toContain('verificad')
    expect(html).not.toContain('lucide-badge-check')
  })

  it('explica la ausencia de oferta y evita una seccion vacia de reseñas', () => {
    const html = renderToStaticMarkup(<BusinessProfile business={business} />)

    expect(html).toContain('Aún no hay servicios publicados')
    expect(html).toContain('Los horarios aparecerán cuando el negocio publique su disponibilidad')
    expect(html).not.toContain('>Reseñas<')
    expect(html).toContain('Sin servicios disponibles')
  })
})
