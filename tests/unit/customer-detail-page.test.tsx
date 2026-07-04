import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUserWithBusiness = vi.hoisted(() => vi.fn())
const mockGetCustomerDetail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: mockGetCurrentUserWithBusiness,
}))

vi.mock('@/server/actions/customers', () => ({
  getCustomerDetail: mockGetCustomerDetail,
}))

vi.mock('@/server/actions/loyalty', () => ({
  getCustomerLoyalty: vi.fn().mockResolvedValue({ balance: 0, history: [], grants: [], catalog: [] }),
  getLoyaltyConfig: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/server/actions/packages', () => ({
  getCustomerPackages: vi.fn().mockResolvedValue([]),
  listPackageProducts: vi.fn().mockResolvedValue([]),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/app/dashboard/customers/[id]/edit-form', () => ({
  CustomerEditForm: () => <div>edit form</div>,
}))

vi.mock('@/app/dashboard/customers/[id]/notes-form', () => ({
  CustomerNotesForm: () => <div>notes form</div>,
}))

vi.mock('@/app/dashboard/customers/[id]/loyalty-panel', () => ({
  LoyaltyPanel: () => <div>loyalty panel</div>,
}))

vi.mock('@/app/dashboard/customers/[id]/package-panel', () => ({
  PackagePanel: () => <div>package panel</div>,
}))

describe('CustomerDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: { timezone: 'America/Santiago', currency: 'CLP' },
    })
    mockGetCustomerDetail.mockResolvedValue({
      id: 'cust-1',
      name: 'Maria Perez',
      phone: '+56912345678',
      email: 'maria@test.com',
      notes: null,
      birthDate: null,
      bookingCount: 2,
      lastBookingAt: new Date('2026-06-01T14:00:00Z'),
      totalPaidApproved: 30000,
      pendingBalance: 12000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      bookings: [],
      payments: [],
    })
  })

  it('shows total value as paid plus pending balance', async () => {
    const { default: CustomerDetailPage } = await import('@/app/dashboard/customers/[id]/page')

    const element = await CustomerDetailPage({ params: Promise.resolve({ id: 'cust-1' }) })
    const html = renderToStaticMarkup(element)

    expect(html).toContain('Total')
    expect(html).toContain('$42.000')
    expect(html).toContain('Total pagado')
    expect(html).toContain('$30.000')
    expect(html).toContain('Saldo pendiente')
    expect(html).toContain('$12.000')
  })
})
