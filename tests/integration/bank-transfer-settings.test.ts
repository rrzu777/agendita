import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mockeamos las capas de infraestructura (auth, rate limit, revalidate) para
// ejercitar la LÓGICA REAL de las actions contra un Postgres real — mismo
// approach que packages-actions.test.ts.
const BIZ = 'bta-biz-1'
const USER = 'bta-user-1'
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const validInput = {
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: 'Nombre y fecha en el asunto',
  holdHours: 24,
  verifyHours: 48,
}

describe('bank-transfer settings actions', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'bta@t.test', name: 'BTA Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'BTA Biz', slug: 'bta-biz', subdomain: 'btabiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'bta-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
  })

  afterAll(async () => {
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.bankTransferAccount.deleteMany({ where: { businessId: BIZ } })
  })

  it('crea la cuenta con los datos normalizados', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    const res = await saveBankTransferAccount(validInput)
    expect(res.ok).toBe(true)

    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row).not.toBeNull()
    expect(row!.accountHolder).toBe('María Pérez')
    expect(row!.holdHours).toBe(24)
    expect(row!.verifyHours).toBe(48)
    expect(row!.isEnabled).toBe(true)
  })

  it('actualiza (upsert) sin duplicar y persiste verifyHours null', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount(validInput)
    await saveBankTransferAccount({ ...validInput, bankName: 'Banco de Chile', verifyHours: null })

    const rows = await prisma.bankTransferAccount.findMany({ where: { businessId: BIZ } })
    expect(rows).toHaveLength(1)
    expect(rows[0].bankName).toBe('Banco de Chile')
    expect(rows[0].verifyHours).toBeNull()
  })

  it('guarda email vacío como null', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount({ ...validInput, email: '' })
    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row!.email).toBeNull()
  })

  it('rechaza input inválido sin escribir nada', async () => {
    const { saveBankTransferAccount } = await import('@/server/actions/bank-transfer-settings')
    const res = await saveBankTransferAccount({ ...validInput, holdHours: 0 })
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Datos inválidos/) })
    expect(await prisma.bankTransferAccount.count({ where: { businessId: BIZ } })).toBe(0)
  })

  it('setBankTransferEnabled togglea sin tocar el resto', async () => {
    const { saveBankTransferAccount, setBankTransferEnabled } = await import('@/server/actions/bank-transfer-settings')
    await saveBankTransferAccount(validInput)
    const res = await setBankTransferEnabled(false)
    expect(res.ok).toBe(true)

    const row = await prisma.bankTransferAccount.findUnique({ where: { businessId: BIZ } })
    expect(row!.isEnabled).toBe(false)
    expect(row!.bankName).toBe('BancoEstado')
  })

  it('setBankTransferEnabled sin cuenta creada tira error legible', async () => {
    const { setBankTransferEnabled } = await import('@/server/actions/bank-transfer-settings')
    const res = await setBankTransferEnabled(true)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Primero guardá los datos de la cuenta/) })
  })
})
