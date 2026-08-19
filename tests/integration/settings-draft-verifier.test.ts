import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { settingsFingerprint } from '@/lib/business/settings-draft'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const BIZ = 'draft-verifier-biz'
const USER = 'draft-verifier-user'

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER }, role: 'owner' }),
}))

describe('settings draft verifier against PostgreSQL', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'draft-verifier@test.agendita.cl', name: 'Draft Verifier' } })
    await prisma.business.create({
      data: {
        id: BIZ,
        name: 'Servidor A',
        slug: 'draft-verifier',
        subdomain: 'draft-verifier',
        ownerUserId: USER,
        city: 'Santiago',
        timezone: 'America/Santiago',
        manualHoldHours: 24,
        bookingPolicy: null,
      },
    })
  })

  afterAll(async () => {
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('detects a real profile baseline change and returns the current normalized values', async () => {
    const baselineA = {
      name: 'Servidor A',
      bio: '',
      profileImageUrl: '',
      logoUrl: '',
      whatsapp: '',
      instagram: '',
      addressText: '',
      city: 'Santiago',
      subdomain: 'draft-verifier',
    }
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')

    const baselineFingerprint = await settingsFingerprint(baselineA)
    await expect(verifySettingsDraftBaseline('profile', baselineFingerprint)).resolves.toEqual({
      matches: true,
      current: baselineA,
    })

    await prisma.business.update({ where: { id: BIZ }, data: { name: 'Servidor C' } })
    const result = await verifySettingsDraftBaseline('profile', baselineFingerprint)
    expect(result.matches).toBe(false)
    expect(result.current).toEqual({ ...baselineA, name: 'Servidor C' })
  })

  it('returns the normalized bank form shape from persisted nullable and numeric fields', async () => {
    await prisma.bankTransferAccount.create({
      data: {
        businessId: BIZ,
        accountHolder: 'María Pérez',
        rut: '12.345.678-9',
        bankName: 'BancoEstado',
        accountType: 'vista',
        accountNumber: '12345678',
        email: null,
        instructions: null,
        holdHours: 24,
        verifyHours: null,
      },
    })
    const { verifySettingsDraftBaseline } = await import('@/server/actions/settings-draft-verifier')

    const result = await verifySettingsDraftBaseline('payments-bank', 'stale')

    expect(result).toEqual({
      matches: false,
      current: {
        accountHolder: 'María Pérez',
        rut: '12.345.678-9',
        bankName: 'BancoEstado',
        accountType: 'vista',
        accountNumber: '12345678',
        email: '',
        instructions: '',
        holdHours: '24',
        verifyHours: '',
      },
    })
  })
})
