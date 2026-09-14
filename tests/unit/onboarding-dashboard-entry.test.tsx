import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, redirect, serviceCount, availabilityCount } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
  serviceCount: vi.fn(),
  availabilityCount: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: auth }))
vi.mock('@/lib/db', () => ({ prisma: {
  service: { count: serviceCount },
  availabilityRule: { count: availabilityCount },
  paymentAccount: { count: vi.fn().mockResolvedValue(0) },
  packagePurchase: { count: vi.fn().mockResolvedValue(0) },
  booking: { findFirst: vi.fn().mockResolvedValue(null) },
} }))
vi.mock('@/server/actions/bookings', () => ({
  getDashboardBookingSummary: vi.fn().mockResolvedValue({ today: 0, total: 0, pendingTransfers: 0, upcoming: [] }),
}))
vi.mock('@/server/actions/ledger', () => ({
  getFinancialSummary: vi.fn().mockResolvedValue({ incomeMonth: 0 }),
}))
vi.mock('@/components/dashboard/header', () => ({
  DashboardHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('@/components/dashboard/dashboard-panel', () => ({
  DashboardPanel: ({ title, children }: { title: string; children?: ReactNode }) => <section><h2>{title}</h2>{children}</section>,
}))
vi.mock('@/components/dashboard/kpi-strip', () => ({ KpiStrip: () => null }))
vi.mock('@/components/dashboard/tours/tour-invitation', () => ({ TourInvitation: () => null }))
vi.mock('@/components/dashboard/pending-transfers-banner', () => ({ PendingTransfersBanner: () => null }))
vi.mock('@/components/dashboard/pending-package-transfers-banner', () => ({ PendingPackageTransfersBanner: () => null }))
vi.mock('@/components/dashboard/setup-checklist', () => ({
  SetupChecklist: ({ initialSetupIncomplete }: { initialSetupIncomplete?: boolean }) => initialSetupIncomplete
    ? <a href="/dashboard/onboarding">Continuar configuración inicial</a>
    : <span>Checklist operativo</span>,
}))
vi.mock('@/components/onboarding/onboarding-wizard', () => ({
  OnboardingWizard: () => <main>Configuración inicial</main>,
}))

import DashboardPage from '@/app/dashboard/page'
import OnboardingPage, { metadata as onboardingMetadata } from '@/app/dashboard/onboarding/page'

const business = {
  id: 'business-1',
  name: 'Mi negocio',
  category: 'other',
  currency: 'CLP',
  timezone: 'America/Santiago',
  onboardingCompletedAt: null as Date | null,
  onboardingStep: 0,
  slug: 'mi-negocio',
  subdomain: 'mi-negocio',
  city: 'Santiago',
  bio: null,
  addressText: null,
  whatsapp: null,
  instagram: null,
  depositPolicy: null,
  cancellationPolicy: null,
  bookingPolicy: null,
}

describe('Hoy onboarding entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceCount.mockResolvedValue(1)
    availabilityCount.mockResolvedValue(1)
  })

  it('renders Hoy for an incomplete business and offers optional initial setup', async () => {
    auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner', business })

    const html = renderToStaticMarkup(await DashboardPage())

    expect(html).toContain('Cabina del día')
    expect(html).toContain('href="/dashboard/onboarding"')
    expect(html).toContain('Continuar configuración inicial')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('hides the initial setup entry after explicit completion', async () => {
    auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner', business: { ...business, onboardingCompletedAt: new Date() } })

    const html = renderToStaticMarkup(await DashboardPage())

    expect(html).not.toContain('Continuar configuración inicial')
  })

  it('preserves the missing-user guard', async () => {
    auth.mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/login')
  })

  it('preserves the missing-business guard', async () => {
    auth.mockResolvedValue({ user: { id: 'owner' }, business: null })
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/recover-business')
  })
})

describe('initial setup route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceCount.mockResolvedValue(1)
    availabilityCount.mockResolvedValue(1)
  })

  it('lets the root metadata template append the Agendita suffix exactly once', () => {
    expect(onboardingMetadata).toEqual({ title: 'Configura tu negocio' })
  })

  it('redirects completed accounts back to Hoy', async () => {
    auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner', business: { ...business, onboardingCompletedAt: new Date() } })
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('preserves missing-user and missing-business guards', async () => {
    auth.mockResolvedValue(null)
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/login')

    auth.mockResolvedValue({ user: { id: 'owner' }, business: null })
    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/recover-business')
  })

  it('renders setup for incomplete accounts without completing it on GET', async () => {
    auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner', business })

    const html = renderToStaticMarkup(await OnboardingPage())

    expect(html).toContain('Configuración inicial')
    expect(redirect).not.toHaveBeenCalled()
  })
})
