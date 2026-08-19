import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const {
  mockRequireBusinessRole,
  mockRequireSettingsPageAccess,
  mockPaymentProviderQuery,
  mockProfileForm,
  mockRedirect,
  AuthError,
  ForbiddenError,
} = vi.hoisted(() => ({
  mockRequireBusinessRole: vi.fn(),
  mockRequireSettingsPageAccess: vi.fn(),
  mockPaymentProviderQuery: vi.fn(),
  mockProfileForm: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
  AuthError: class AuthError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}))

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('@/lib/auth/server', () => ({
  AuthError,
  ForbiddenError,
  requireBusinessRole: mockRequireBusinessRole,
}))
vi.mock('@/lib/business/settings-access', () => ({ requireSettingsPageAccess: mockRequireSettingsPageAccess }))
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: mockPaymentProviderQuery,
}))
vi.mock('@/components/dashboard/settings/profile-settings-form', () => ({
  ProfileSettingsForm: (props: unknown) => {
    mockProfileForm(props)
    return null
  },
}))
vi.mock('@/components/dashboard/settings/reservation-settings-form', () => ({ ReservationSettingsForm: () => null }))
vi.mock('@/components/dashboard/settings/policy-settings-form', () => ({ PolicySettingsForm: () => null }))
vi.mock('@/components/dashboard/header', () => ({ DashboardHeader: () => null }))
vi.mock('@/components/dashboard/settings/settings-shell', () => ({ SettingsShell: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: React.ReactNode }) => children, CardContent: ({ children }: { children: React.ReactNode }) => children, CardHeader: ({ children }: { children: React.ReactNode }) => children, CardTitle: ({ children }: { children: React.ReactNode }) => children, CardDescription: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/dashboard/settings/payments/disconnect-button', () => ({ DisconnectButton: () => null }))
vi.mock('@/components/dashboard/settings/payments/bank-transfer-form', () => ({ BankTransferForm: () => null }))
vi.mock('@/server/actions/mercado-pago-connect', () => ({ getPaymentAccountStatus: vi.fn(), startMercadoPagoConnect: vi.fn() }))
vi.mock('@/lib/storage/r2', () => ({ isObjectStorageAvailable: vi.fn(() => false) }))
vi.mock('@/lib/db', () => ({ prisma: { bankTransferAccount: { findUnique: vi.fn() }, business: { findUnique: vi.fn() } } }))
vi.mock('@/lib/vocabulary', () => ({ getVocabulary: () => ({ clients: 'clientes' }) }))

import SettingsRootPage from '@/app/dashboard/settings/page'
import ProfilePage from '@/app/dashboard/settings/profile/page'
import ReservationsPage from '@/app/dashboard/settings/reservations/page'
import PoliciesPage from '@/app/dashboard/settings/policies/page'
import PaymentsPage from '@/app/dashboard/settings/payments/page'

const business = {
  id: 'biz-1',
  slug: 'maria',
  name: 'María Studio',
  bio: null,
  profileImageUrl: null,
  logoUrl: null,
  whatsapp: null,
  instagram: null,
  addressText: null,
  city: 'Santiago',
  subdomain: 'maria',
  timezone: 'America/Santiago',
  slotStepMinutes: 30,
  manualHoldHours: 24,
  requireBookingApproval: false,
  defaultMeetingUrl: null,
  selfServiceCutoffHours: 24,
  cancellationReminderEnabled: true,
  cancellationPolicy: null,
  bookingPolicy: null,
  depositPolicy: null,
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSettingsPageAccess.mockResolvedValue({ business, businessId: business.id })
  })

  it('redirects settings root to profile', async () => {
    expect(() => SettingsRootPage()).toThrow('REDIRECT:/dashboard/settings/profile')
  })

  it.each([
    ['profile', ProfilePage],
    ['reservations', ReservationsPage],
    ['policies', PoliciesPage],
    ['payments', PaymentsPage],
  ])('%s redirects staff before reading settings', async (_section, page) => {
    mockRequireSettingsPageAccess.mockRejectedValue(new Error('REDIRECT:/dashboard'))
    await expect(page({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow('REDIRECT:/dashboard')
    expect(mockPaymentProviderQuery).not.toHaveBeenCalled()
  })

  it('serializes only profile fields into the profile client form', async () => {
    const tree = await ProfilePage()
    renderToStaticMarkup(tree)
    expect(mockProfileForm).toHaveBeenCalledWith(expect.objectContaining({
      businessId: business.id,
      initialValues: expect.not.objectContaining({ timezone: expect.anything() }),
    }))
  })
})
