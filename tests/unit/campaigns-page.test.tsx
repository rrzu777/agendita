import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUserWithBusiness = vi.hoisted(() => vi.fn())
const mockGetCampaigns = vi.hoisted(() => vi.fn())
const mockListCampaignPromotions = vi.hoisted(() => vi.fn())
const mockGetServices = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: mockGetCurrentUserWithBusiness,
}))

vi.mock('@/server/actions/campaigns', () => ({
  getCampaigns: mockGetCampaigns,
  listCampaignPromotions: mockListCampaignPromotions,
}))

vi.mock('@/server/actions/services', () => ({
  getServices: mockGetServices,
}))

// LANDMINE del repo: sin este mock renderToStaticMarkup explota con useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

describe('CampanasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: { timezone: 'America/Santiago', currency: 'CLP' },
    })
    mockGetCampaigns.mockResolvedValue([])
    mockListCampaignPromotions.mockResolvedValue([])
    mockGetServices.mockResolvedValue([])
  })

  it('renders title, CTA and empty state when there are no campaigns', async () => {
    const { default: CampanasPage } = await import('@/app/dashboard/campanas/page')

    const element = await CampanasPage()
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Campañas')
    expect(html).toContain('Nueva campaña')
    expect(html).toContain('Todavía no creaste ninguna campaña')
  })

  it('renders campaign name, segment label and recipient count', async () => {
    mockGetCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        name: 'Campaña invierno',
        segmentType: 'frequent',
        createdAt: new Date('2026-07-01T12:00:00Z'),
        promotion: { name: 'Promo 20%' },
        _count: { recipients: 5 },
      },
    ])

    const { default: CampanasPage } = await import('@/app/dashboard/campanas/page')

    const element = await CampanasPage()
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Campaña invierno')
    expect(html).toContain('Frecuentes')
    expect(html).toContain('Promo 20%')
    expect(html).toContain('5')
  })
})
