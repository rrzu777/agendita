import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { requireTestDatabase } from './setup'
import { queryCampaignSegment } from '@/lib/campaigns/segments'

requireTestDatabase()

const BIZ = 'cseg-biz-1'
const OWNER_USER = 'cseg-owner-1'
const SVC = 'cseg-svc-1'

const BDAY_CUST = 'cseg-cust-bday'
const INACTIVE_CUST = 'cseg-cust-inactive'
const FREQUENT_CUST = 'cseg-cust-frequent'
const BALANCE_CUST = 'cseg-cust-balance'
const NOPHONE_CUST = 'cseg-cust-nophone'

const TZ = 'America/Santiago'
const NOW = new Date()
const DAY_MS = 86_400_000

describe('campaigns queryCampaignSegment', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.booking.deleteMany({ where: { businessId: BIZ } })
    await db.customer.deleteMany({ where: { businessId: BIZ } })
    await db.service.deleteMany({ where: { businessId: BIZ } })
    await db.businessUser.deleteMany({ where: { businessId: BIZ } })
    await db.business.deleteMany({ where: { id: BIZ } })
    await db.user.deleteMany({ where: { id: OWNER_USER } })
  }

  /** Franja horaria disjunta por índice (constraint EXCLUDE Booking_no_overlap). */
  function slot(index: number) {
    const start = new Date(NOW)
    start.setUTCDate(start.getUTCDate() + 30 + index) // días distintos → nunca solapan
    start.setUTCHours(15, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    return { startDateTime: start, endDateTime: end }
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@cseg.test', name: 'CSeg Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'CSeg Biz', slug: 'cseg-biz', subdomain: 'csegbiz', ownerUserId: OWNER_USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: TZ, bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'cseg-bu-1', businessId: BIZ, userId: OWNER_USER, role: 'owner' } })
    await prisma.service.create({
      data: { id: SVC, businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 20000, depositAmount: 5000, pastelColor: '#FFD700' },
    })

    // El "mes actual" se evalúa en la tz del negocio (misma convención que el código).
    const nowMonthInTz = Number(formatInTimeZone(NOW, TZ, 'MM')) // 1-12
    const birthDateThisMonth = new Date(Date.UTC(1990, nowMonthInTz - 1, 10))

    await prisma.customer.create({
      data: { id: BDAY_CUST, businessId: BIZ, name: 'Cumpleañera', phone: '+56911220001', birthDate: birthDateThisMonth },
    })
    await prisma.customer.create({
      data: {
        id: INACTIVE_CUST, businessId: BIZ, name: 'Inactiva', phone: '+56911220002',
        lastCompletedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      },
    })
    await prisma.customer.create({
      data: { id: FREQUENT_CUST, businessId: BIZ, name: 'Frecuente', phone: '+56911220003' },
    })
    await prisma.customer.create({
      data: { id: BALANCE_CUST, businessId: BIZ, name: 'Con Saldo', phone: '+56911220004' },
    })
    await prisma.customer.create({
      data: { id: NOPHONE_CUST, businessId: BIZ, name: 'Sin Teléfono', phone: '123', birthDate: birthDateThisMonth },
    })

    // 3 completadas para FREQUENT_CUST + 1 confirmada con saldo para BALANCE_CUST,
    // todas en días distintos (constraint EXCLUDE de solapamiento).
    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: {
          businessId: BIZ, serviceId: SVC, customerId: FREQUENT_CUST,
          ...slot(i),
          status: 'completed',
          totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
          remainingBalance: 0, discountAmount: 0, finalAmount: 20000,
          paymentStatus: 'fully_paid',
        },
      })
    }
    await prisma.booking.create({
      data: {
        businessId: BIZ, serviceId: SVC, customerId: BALANCE_CUST,
        ...slot(3),
        status: 'confirmed',
        totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
        remainingBalance: 15000, discountAmount: 0, finalAmount: 20000,
        paymentStatus: 'deposit_paid',
      },
    })
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('birthday_month devuelve la cumpleañera del mes, excluye sin-teléfono', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'birthday_month', {}, NOW, TZ)
    expect(r.map((c) => c.id)).toContain(BDAY_CUST)
    expect(r.map((c) => c.id)).not.toContain(NOPHONE_CUST)
    expect(r.every((c) => c.phone.replace(/\D/g, '').length >= 8)).toBe(true)
  })

  it('inactive respeta X días y excluye nunca-completadas', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'inactive', { inactiveDays: 60 }, NOW, TZ)
    expect(r.map((c) => c.id)).toContain(INACTIVE_CUST)
    // Las demás nunca completaron (lastCompletedAt null) → no aparecen.
    expect(r.map((c) => c.id)).not.toContain(FREQUENT_CUST)
    expect(r.map((c) => c.id)).not.toContain(BALANCE_CUST)
  })

  it('inactive con umbral mayor a la antigüedad no la devuelve', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'inactive', { inactiveDays: 120 }, NOW, TZ)
    expect(r.map((c) => c.id)).not.toContain(INACTIVE_CUST)
  })

  it('frequent cuenta completadas >= N', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'frequent', { frequentMin: 3 }, NOW, TZ)
    expect(r.map((c) => c.id)).toContain(FREQUENT_CUST)
    expect(r.map((c) => c.id)).not.toContain(BALANCE_CUST) // confirmada no cuenta
  })

  it('frequent con N=4 no la devuelve', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'frequent', { frequentMin: 4 }, NOW, TZ)
    expect(r.map((c) => c.id)).not.toContain(FREQUENT_CUST)
  })

  it('pending_balance devuelve saldo > 0', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'pending_balance', {}, NOW, TZ)
    expect(r.map((c) => c.id)).toContain(BALANCE_CUST)
    expect(r.map((c) => c.id)).not.toContain(FREQUENT_CUST) // saldo 0
  })
})
