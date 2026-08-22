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

vi.mock('@/server/actions/customer-photos', () => ({
  getPhotos: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  attachCustomerPhoto: vi.fn(),
  createCustomerPhotoUploadUrl: vi.fn(),
  deleteCustomerPhoto: vi.fn(),
  updateCustomerPhotoCaption: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const baseDetail = {
  id: 'cust-1',
  name: 'Maria Perez',
  phone: '+56912345678',
  email: 'maria@test.com',
  notes: null,
  birthDate: null,
  marketingOptOutAt: null,
  bookingCount: 2,
  lastBookingAt: new Date('2026-06-01T14:00:00Z'),
  totalPaidApproved: 30000,
  pendingBalance: 12000,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  lastAttendedBy: null,
  bookings: [],
  payments: [],
}

// El nombre no es substring de ningún otro texto de la página.
function bookingEntry(professionalName: string | null) {
  return {
    id: 'bk-1',
    bookingNumber: 4738,
    serviceName: 'Corte',
    startDateTime: new Date('2026-05-01T14:00:00Z'),
    status: 'completed',
    professionalName,
    totalPrice: 20000,
    remainingBalance: 0,
    finalAmount: 20000,
  }
}

async function renderPage() {
  const { default: CustomerDetailPage } = await import('@/app/dashboard/customers/[id]/page')
  const element = await CustomerDetailPage({ params: Promise.resolve({ id: 'cust-1' }) })
  return renderToStaticMarkup(element)
}

describe('CustomerDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: { timezone: 'America/Santiago', currency: 'CLP' },
    })
    mockGetCustomerDetail.mockResolvedValue(baseDetail)
  })

  it('shows total value as paid plus pending balance', async () => {
    const html = await renderPage()

    expect(html).toContain('Total')
    expect(html).toContain('$42.000')
    expect(html).toContain('Total pagado')
    expect(html).toContain('$30.000')
    expect(html).toContain('Saldo pendiente')
    expect(html).toContain('$12.000')
  })

  it('dice quién la atendió la última vez', async () => {
    mockGetCustomerDetail.mockResolvedValue({ ...baseDetail, lastAttendedBy: 'RaulBarbero' })

    const html = await renderPage()

    expect(html).toContain('Atendió la última vez')
    expect(html).toContain('RaulBarbero')
  })

  it('sin persona no promete nada', async () => {
    const html = await renderPage()

    expect(html).not.toContain('Atendió la última vez')
  })

  it('permite crear una reserva con la clienta preseleccionada sin poner PII en la URL', async () => {
    const html = await renderPage()

    expect(html).toContain('href="/dashboard/bookings/new?customerId=cust-1"')
    expect(html).not.toContain('customerName=')
    expect(html).not.toContain('customerPhone=')
    expect(html).not.toContain('disabled="" title="Proximamente desde el panel"')
  })

  it('el historial dice quién atiende cada cita, y calla cuando no hay persona', async () => {
    mockGetCustomerDetail.mockResolvedValue({
      ...baseDetail,
      bookings: [bookingEntry('RaulBarbero'), { ...bookingEntry(null), id: 'bk-2' }],
    })

    const html = await renderPage()

    expect(html).toContain('Atiende: RaulBarbero')
    // Una sola vez por vista (mobile card + tabla desktop = 2 en total), no en
    // la fila sin persona.
    expect(html.split('Atiende').length - 1).toBe(2)
  })
})
