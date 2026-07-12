import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BusinessProfile } from '@/components/public/business-profile'
import type { PublicBusiness } from '@/lib/business/public'

const business: PublicBusiness = {
  id: 'biz_1',
  name: 'Salon Ana',
  category: 'other',
  slug: 'salon-ana',
  subdomain: 'salon-ana',
  customDomain: null,
  ownerUserId: 'user_1',
  logoUrl: null,
  profileImageUrl: null,
  bio: 'El mejor salón de la ciudad',
  whatsapp: null,
  instagram: null,
  addressText: null,
  city: 'Santiago',
  country: 'CL',
  currency: 'CLP',
  timezone: 'America/Santiago',
  bookingWindowDays: 90,
  slotStepMinutes: 30,
  selfServiceCutoffHours: 24,
  bookingNumberSeq: 1000,
  isActive: true,
  planId: null,
  subscriptionStatus: 'trialing',
  trialEndsAt: null,
  onboardingCompletedAt: null,
  onboardingStep: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  services: [],
  availability: [],
  reviews: [],
  _count: { reviews: 0 },
} as unknown as PublicBusiness

describe('BusinessProfile — CTA de cuenta', () => {
  it('sin prop accountCta no renderiza nada nuevo', () => {
    const html = renderToStaticMarkup(<BusinessProfile business={business} />)
    expect(html).not.toContain('Mi cuenta')
    expect(html).not.toContain('>Ingresar<')
  })

  it('anon: link Ingresar hacia /ingresar?next=/ir/[slug]', () => {
    const html = renderToStaticMarkup(
      <BusinessProfile business={business} accountCta={{ label: 'Ingresar', href: '/ingresar?next=%2Fir%2Fsalon-ana' }} />,
    )
    expect(html).toContain('Ingresar')
    expect(html).toContain('/ingresar?next=%2Fir%2Fsalon-ana')
  })

  it('logueada: link Mi cuenta', () => {
    const html = renderToStaticMarkup(
      <BusinessProfile business={business} accountCta={{ label: 'Mi cuenta', href: '/mi/salon-ana' }} />,
    )
    expect(html).toContain('Mi cuenta')
    expect(html).toContain('/mi/salon-ana')
  })
})
