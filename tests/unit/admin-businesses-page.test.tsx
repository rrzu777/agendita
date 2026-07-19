import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockPrisma = { business: { findMany: vi.fn() } }

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/user', () => ({
  getPlatformAdminUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}))

vi.mock('@/lib/auth/platform-admin', () => ({
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.business.findMany.mockResolvedValue([
      {
        id: 'biz-1',
        name: 'Salón Luna',
        slug: 'salon-luna',
        subdomain: null,
        subscriptionStatus: 'past_due',
        plan: { name: 'Plan Pro' },
        _count: { bookings: 12, payments: 3 },
      },
    ])
  })

  it('renders the past_due business with its real status label and no raw legacy <table>', async () => {
    const { default: AdminPage } = await import('@/app/admin/page')

    const html = renderToStaticMarkup(await AdminPage())

    expect(html).toContain('Salón Luna')
    expect(html).toContain('Pago pendiente')
    expect(html).toContain('Ver detalle')
    // The unified Table primitive (src/components/ui/table.tsx) legitimately renders a
    // real <table data-slot="table" ...> for the desktop view — same as every other
    // already-migrated table. What we actually want to rule out is the old hand-rolled
    // markup this page used before migration.
    expect(html).not.toContain('<table class="w-full text-sm">')
    expect(html).toContain('data-slot="table"')
  })
})
