import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsFingerprint } from '@/lib/business/settings-draft'

const { mockRequireBusinessRole, mockBusinessFindUniqueOrThrow, mockBankFindUnique } = vi.hoisted(() => ({
  mockRequireBusinessRole: vi.fn(),
  mockBusinessFindUniqueOrThrow: vi.fn(),
  mockBankFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ requireBusinessRole: mockRequireBusinessRole }))
vi.mock('@/lib/db', () => ({
  prisma: {
    business: { findUniqueOrThrow: mockBusinessFindUniqueOrThrow },
    bankTransferAccount: { findUnique: mockBankFindUnique },
  },
}))

describe('verifySettingsDraftBaseline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-authenticated', role: 'owner' })
  })

  it('authenticates owner/admin and returns the normalized current profile without accepting a business id', async () => {
    const current = {
      name: 'Mimos Nails',
      bio: '',
      profileImageUrl: '',
      logoUrl: '',
      whatsapp: '+56912345678',
      instagram: '',
      addressText: '',
      city: 'Santiago',
      subdomain: 'mimosnails',
    }
    mockBusinessFindUniqueOrThrow.mockResolvedValue({
      ...current,
      bio: null,
      profileImageUrl: null,
      logoUrl: null,
      instagram: null,
      addressText: null,
    })
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')

    const result = await verifySettingsDraftBaseline('profile', await settingsFingerprint(current))

    expect(result).toEqual({ matches: true, current })
    expect(mockRequireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mockBusinessFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'biz-authenticated' },
      select: {
        name: true,
        bio: true,
        profileImageUrl: true,
        logoUrl: true,
        whatsapp: true,
        instagram: true,
        addressText: true,
        city: true,
        subdomain: true,
      },
    })
  })

  it('returns a mismatch with normalized reservations and policies values', async () => {
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')
    mockBusinessFindUniqueOrThrow
      .mockResolvedValueOnce({
        timezone: 'America/Santiago',
        slotStepMinutes: null,
        manualHoldHours: 24,
        requireBookingApproval: false,
        defaultMeetingUrl: null,
      })
      .mockResolvedValueOnce({
        selfServiceCutoffHours: 24,
        cancellationReminderEnabled: true,
        cancellationPolicy: null,
        bookingPolicy: 'Reserva con 24 horas',
        depositPolicy: null,
      })

    await expect(verifySettingsDraftBaseline('reservations', 'stale')).resolves.toEqual({
      matches: false,
      current: {
        timezone: 'America/Santiago',
        slotStepMinutes: 'service',
        manualHoldHours: 24,
        requireBookingApproval: false,
        defaultMeetingUrl: '',
      },
    })
    await expect(verifySettingsDraftBaseline('policies', 'stale')).resolves.toEqual({
      matches: false,
      current: {
        selfServiceCutoffHours: 24,
        cancellationReminderEnabled: true,
        cancellationPolicy: '',
        bookingPolicy: 'Reserva con 24 horas',
        depositPolicy: '',
      },
    })
  })

  it('normalizes a missing bank account to the empty form defaults', async () => {
    mockBankFindUnique.mockResolvedValue(null)
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')

    await expect(verifySettingsDraftBaseline('payments-bank', 'stale')).resolves.toEqual({
      matches: false,
      current: {
        accountHolder: '',
        rut: '',
        bankName: '',
        accountType: '',
        accountNumber: '',
        email: '',
        instructions: '',
        holdHours: '24',
        verifyHours: '48',
      },
    })
    expect(mockBankFindUnique).toHaveBeenCalledWith({
      where: { businessId: 'biz-authenticated' },
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
      },
    })
  })

  it('rejects staff before any settings read', async () => {
    mockRequireBusinessRole.mockRejectedValue(new Error('forbidden'))
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')

    await expect(verifySettingsDraftBaseline('profile', 'fingerprint')).rejects.toThrow('forbidden')
    expect(mockBusinessFindUniqueOrThrow).not.toHaveBeenCalled()
    expect(mockBankFindUnique).not.toHaveBeenCalled()
  })
})
