import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockGetCurrentUserWithBusiness = vi.hoisted(() => vi.fn())
const mockServiceFindMany = vi.hoisted(() => vi.fn())
const mockProfessionalFindMany = vi.hoisted(() => vi.fn())
const mockCustomerFindFirst = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: mockGetCurrentUserWithBusiness,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    service: { findMany: mockServiceFindMany },
    professional: { findMany: mockProfessionalFindMany },
    customer: { findFirst: mockCustomerFindFirst },
  },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/server/actions/bookings', () => ({ createBookingFromDashboard: vi.fn() }))
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/customers', () => ({ searchCustomersForBooking: vi.fn() }))
vi.mock('@/lib/packages/use-package-availability', () => ({
  usePackageAvailability: () => ({ remaining: 0, usePackage: false, setUsePackage: vi.fn() }),
}))

describe('dashboard booking customer prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: {
        id: 'business-1',
        category: 'nails',
        timezone: 'America/Santiago',
        currency: 'CLP',
      },
    })
    mockServiceFindMany.mockResolvedValue([])
    mockProfessionalFindMany.mockResolvedValue([])
    mockCustomerFindFirst.mockResolvedValue({
      id: 'customer-1',
      name: 'Maria Perez',
      phone: '+56912345678',
      email: 'maria@example.com',
    })
  })

  it('re-reads the selected customer inside the authenticated business and preselects it', async () => {
    const { default: NewBookingPage } = await import('@/app/dashboard/bookings/new/page')

    const page = await NewBookingPage({
      searchParams: Promise.resolve({ customerId: 'customer-1' }),
    })
    const html = renderToStaticMarkup(page)

    expect(mockCustomerFindFirst).toHaveBeenCalledWith({
      where: { id: 'customer-1', businessId: 'business-1' },
      select: { id: true, name: true, phone: true, email: true },
    })
    expect(html).toContain('Maria Perez')
    expect(html).toContain('value="+56912345678"')
    expect(html).toContain('value="maria@example.com"')
    expect(html).not.toContain('Buscar por nombre o teléfono...')
  })

  it('ignores repeated customerId parameters instead of querying with ambiguous input', async () => {
    const { default: NewBookingPage } = await import('@/app/dashboard/bookings/new/page')

    const page = await NewBookingPage({
      searchParams: Promise.resolve({ customerId: ['customer-1', 'customer-2'] }),
    })
    const html = renderToStaticMarkup(page)

    expect(mockCustomerFindFirst).not.toHaveBeenCalled()
    expect(html).toContain('Buscar por nombre o teléfono...')
  })

  it('gives the remove-selection control an accessible name', async () => {
    const { NewBookingForm } = await import('@/app/dashboard/bookings/new/new-booking-form')
    const common = {
      services: [],
      professionals: [],
      businessId: 'business-1',
      timezone: 'America/Santiago',
      currency: 'CLP',
    }
    const maria = {
      id: 'customer-1',
      name: 'Maria Perez',
      phone: '+56912345678',
      email: 'maria@example.com',
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<NewBookingForm {...common} initialCustomer={maria} />))
      expect(container.querySelector('button[aria-label="Quitar cliente seleccionado"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('replaces stale client state when navigation resolves another customer or no customer', async () => {
    const { NewBookingForm } = await import('@/app/dashboard/bookings/new/new-booking-form')
    const common = {
      services: [],
      professionals: [],
      businessId: 'business-1',
      timezone: 'America/Santiago',
      currency: 'CLP',
    }
    const maria = {
      id: 'customer-1',
      name: 'Maria Perez',
      phone: '+56912345678',
      email: 'maria@example.com',
    }
    const ana = {
      id: 'customer-2',
      name: 'Ana Soto',
      phone: '+56987654321',
      email: null,
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(<NewBookingForm {...common} initialCustomer={maria} />))
      expect(container.querySelector<HTMLInputElement>('#customerName')?.value).toBe('Maria Perez')

      await act(async () => root.render(<NewBookingForm {...common} initialCustomer={ana} />))
      expect(container.querySelector<HTMLInputElement>('#customerName')?.value).toBe('Ana Soto')
      expect(container.querySelector<HTMLInputElement>('#customerPhone')?.value).toBe('+56987654321')

      await act(async () => root.render(<NewBookingForm {...common} initialCustomer={null} />))
      expect(container.querySelector<HTMLInputElement>('#customerName')?.value).toBe('')
      expect(container.querySelector<HTMLInputElement>('#booking-customer-search')?.placeholder).toBe(
        'Buscar por nombre o teléfono...',
      )
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
