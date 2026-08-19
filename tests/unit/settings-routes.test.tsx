import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const {
  mockRequireBusinessRole,
  mockRequireSettingsPageAccess,
  mockPaymentProviderQuery,
  mockPaymentAccountStatus,
  mockBankAccountFindUnique,
  mockBusinessFindUnique,
  mockBankTransferForm,
  mockProfileForm,
  mockRedirect,
  AuthError,
  ForbiddenError,
} = vi.hoisted(() => ({
  mockRequireBusinessRole: vi.fn(),
  mockRequireSettingsPageAccess: vi.fn(),
  mockPaymentProviderQuery: vi.fn(),
  mockPaymentAccountStatus: vi.fn(),
  mockBankAccountFindUnique: vi.fn(),
  mockBusinessFindUnique: vi.fn(),
  mockBankTransferForm: vi.fn(),
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
vi.mock('@/components/dashboard/settings/payments/bank-transfer-form', () => ({
  BankTransferForm: (props: unknown) => {
    mockBankTransferForm(props)
    return null
  },
}))
vi.mock('@/server/actions/mercado-pago-connect', () => ({ getPaymentAccountStatus: mockPaymentAccountStatus, startMercadoPagoConnect: vi.fn() }))
vi.mock('@/lib/storage/r2', () => ({ isObjectStorageAvailable: vi.fn(() => false) }))
vi.mock('@/lib/db', () => ({ prisma: { bankTransferAccount: { findUnique: mockBankAccountFindUnique }, business: { findUnique: mockBusinessFindUnique } } }))
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

function findBankTransferForm(node: ReactNode): React.ReactElement<{ businessId: string; account: unknown }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findBankTransferForm(child)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  const props = node.props as { businessId?: unknown; account?: unknown; children?: ReactNode }
  if ('businessId' in props && 'account' in props) return node as React.ReactElement<{ businessId: string; account: unknown }>
  return findBankTransferForm(props.children)
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSettingsPageAccess.mockResolvedValue({ business, businessId: business.id })
    mockPaymentAccountStatus.mockResolvedValue(null)
    mockPaymentProviderQuery.mockResolvedValue(null)
    mockBankAccountFindUnique.mockResolvedValue(null)
    mockBusinessFindUnique.mockResolvedValue(null)
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
    expect(mockPaymentAccountStatus).not.toHaveBeenCalled()
    expect(mockBankAccountFindUnique).not.toHaveBeenCalled()
    expect(mockBusinessFindUnique).not.toHaveBeenCalled()
  })

  it('serializes only profile fields into the profile client form', async () => {
    const tree = await ProfilePage()
    renderToStaticMarkup(tree)
    expect(mockProfileForm).toHaveBeenCalledWith(expect.objectContaining({
      businessId: business.id,
      initialValues: expect.not.objectContaining({ timezone: expect.anything() }),
    }))
  })

  it('queries and serializes only the bank-account DTO after payment authorization', async () => {
    mockBankAccountFindUnique.mockResolvedValue({
      accountHolder: 'María Pérez',
      rut: '12.345.678-9',
      bankName: 'BancoEstado',
      accountType: 'vista',
      accountNumber: '12345678',
      email: null,
      instructions: null,
      holdHours: 24,
      verifyHours: 48,
      isEnabled: true,
      id: 'must-not-reach-client',
    })

    const tree = await PaymentsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) })

    expect(mockBankAccountFindUnique).toHaveBeenCalledWith({
      where: { businessId: business.id },
      select: {
        accountHolder: true,
        rut: true,
        bankName: true,
        accountType: true,
        accountNumber: true,
        email: true,
        instructions: true,
        holdHours: true,
        verifyHours: true,
        isEnabled: true,
      },
    })
    const bankForm = findBankTransferForm(tree)
    expect(bankForm?.props).toMatchObject({ businessId: business.id })
    expect(bankForm?.props.account).toEqual({
      accountHolder: 'María Pérez',
      rut: '12.345.678-9',
      bankName: 'BancoEstado',
      accountType: 'vista',
      accountNumber: '12345678',
      email: null,
      instructions: null,
      holdHours: 24,
      verifyHours: 48,
      isEnabled: true,
    })
  })
})
