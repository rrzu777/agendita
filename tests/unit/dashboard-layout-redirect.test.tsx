import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserWithBusiness, mockCount, mockRedirect } = vi.hoisted(() => ({
  mockGetUserWithBusiness: vi.fn(),
  mockCount: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: mockGetUserWithBusiness }))
vi.mock('@/lib/db', () => ({ prisma: { customer: { count: mockCount } } }))
vi.mock('@/components/dashboard/sidebar', () => ({ DashboardSidebar: () => null }))
vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

import DashboardLayout from '@/app/dashboard/layout'

describe('dashboard layout redirect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sesión → /login (sin cambios)', async () => {
    mockGetUserWithBusiness.mockResolvedValue(null)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
  })

  it('con sesión sin negocio pero con Customer vinculados → /mi', async () => {
    mockGetUserWithBusiness.mockResolvedValue({ user: { id: 'u1' }, business: null, role: null })
    mockCount.mockResolvedValue(2)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/mi')
  })

  it('con sesión sin negocio y sin Customer → /recover-business (sin cambios)', async () => {
    mockGetUserWithBusiness.mockResolvedValue({ user: { id: 'u1' }, business: null, role: null })
    mockCount.mockResolvedValue(0)
    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/recover-business')
  })
})
