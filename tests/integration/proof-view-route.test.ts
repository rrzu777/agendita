import { describe, it, expect, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed } from './helpers/bank-transfer-seed'

requireTestDatabase()

// La ruta owner-only del comprobante ejerce la LÓGICA REAL (lookup del Payment,
// chequeo de pertenencia al negocio, presign) contra un Postgres real. Mockeamos
// solo la infraestructura: auth resuelve al negocio sembrado (btv-biz, vía slug
// literal → seguro con el hoisting de vi.mock) y el storage devuelve un presign
// falso para que CI nunca toque R2.
vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async () => {
    const { prisma } = await import('@/lib/db')
    const business = await prisma.business.findFirstOrThrow({ where: { slug: 'btv-biz' } })
    return { user: { id: business.ownerUserId }, business, role: 'owner', businessId: business.id }
  },
  ForbiddenError: class extends Error {},
}))

const presignDownload = vi.fn().mockResolvedValue('https://signed/get')
vi.mock('@/lib/storage/r2', () => ({
  getProofStorage: () => ({ presignUpload: vi.fn(), presignDownload, head: vi.fn() }),
}))

// Import DESPUÉS de los mocks para que la ruta resuelva las versiones mockeadas.
const { GET } = await import('@/app/dashboard/transfers/proof/[paymentId]/route')

function callGet(paymentId: string) {
  const req = new NextRequest(`http://localhost/dashboard/transfers/proof/${paymentId}`)
  return GET(req, { params: Promise.resolve({ paymentId }) })
}

const OTHER_BIZ = 'proofview-other-biz'
const OTHER_OWNER = 'proofview-other-owner'

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { businessId: OTHER_BIZ } })
  await prisma.customer.deleteMany({ where: { businessId: OTHER_BIZ } })
  await prisma.business.deleteMany({ where: { id: OTHER_BIZ } })
  await prisma.user.deleteMany({ where: { id: OTHER_OWNER } })
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

describe('GET /dashboard/transfers/proof/[paymentId]', () => {
  it('redirige al presign cuando el Payment es del negocio y tiene proofKey', async () => {
    const { paymentId, businessId } = await seedDeclaredTransfer()
    const key = `proofs/${businessId}/${paymentId}/deposit`
    await prisma.payment.update({
      where: { id: paymentId },
      data: { proofKey: key, proofContentType: 'image/png' },
    })

    presignDownload.mockClear()
    const res = await callGet(paymentId)

    expect([302, 307]).toContain(res.status)
    expect(res.headers.get('location')).toBe('https://signed/get')
    expect(presignDownload).toHaveBeenCalledWith(key, 'image/png')
  })

  it('404 cuando el Payment es de OTRO negocio', async () => {
    await prisma.user.upsert({
      where: { id: OTHER_OWNER },
      update: {},
      create: { id: OTHER_OWNER, email: 'other@proofview.test', name: 'Other Owner' },
    })
    await prisma.business.upsert({
      where: { id: OTHER_BIZ },
      update: {},
      create: {
        id: OTHER_BIZ,
        name: 'Other Biz',
        slug: 'proofview-other',
        subdomain: 'proofviewother',
        ownerUserId: OTHER_OWNER,
        city: 'Santiago',
        country: 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })
    const customer = await prisma.customer.create({
      data: { businessId: OTHER_BIZ, name: 'Ajena', phone: '+56911110000' },
    })
    const foreign = await prisma.payment.create({
      data: {
        businessId: OTHER_BIZ,
        customerId: customer.id,
        provider: 'manual',
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        proofKey: `proofs/${OTHER_BIZ}/x/deposit`,
        proofContentType: 'image/png',
      },
    })

    const res = await callGet(foreign.id)
    expect(res.status).toBe(404)
  })

  it('404 cuando el Payment del negocio no tiene proofKey', async () => {
    const { paymentId } = await seedDeclaredTransfer()
    const res = await callGet(paymentId)
    expect(res.status).toBe(404)
  })
})
