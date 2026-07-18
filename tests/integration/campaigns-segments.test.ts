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
const OTHER_MONTH_CUST = 'cseg-cust-othermonth'
const CANCELLED_BAL_CUST = 'cseg-cust-cancelledbal'
const OPTOUT_CUST = 'cseg-cust-optout'
const EMAIL_ONLY_CUST = 'cseg-cust-emailonly'
const NOCHANNEL_CUST = 'cseg-cust-nochannel'

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
    // Cumple en OTRO mes (nowMonthInTz es 1-12; (m+1)%12 es 0-based → +2 meses con wrap, nunca el actual).
    const birthDateOtherMonth = new Date(Date.UTC(1990, (nowMonthInTz + 1) % 12, 10))
    await prisma.customer.create({
      data: { id: OTHER_MONTH_CUST, businessId: BIZ, name: 'Otro Mes', phone: '+56911220005', birthDate: birthDateOtherMonth },
    })
    await prisma.customer.create({
      data: { id: CANCELLED_BAL_CUST, businessId: BIZ, name: 'Saldo Cancelado', phone: '+56911220006' },
    })
    // Matchea los 4 segmentos (cumple este mes, inactiva 100 días, frecuente y con
    // saldo vía bookings de abajo) pero está opt-out → no debe aparecer en ninguno.
    await prisma.customer.create({
      data: {
        id: OPTOUT_CUST, businessId: BIZ, name: 'Opt Out', phone: '+56911220007',
        birthDate: birthDateThisMonth,
        lastCompletedAt: new Date(NOW.getTime() - 100 * DAY_MS),
        marketingOptOutAt: new Date(),
      },
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
    // OPTOUT_CUST también es "frecuente" (3 completadas) y tiene saldo pendiente,
    // para probar la exclusión en los 4 segmentos con una sola clienta.
    for (let i = 10; i < 13; i++) {
      await prisma.booking.create({
        data: {
          businessId: BIZ, serviceId: SVC, customerId: OPTOUT_CUST,
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
        businessId: BIZ, serviceId: SVC, customerId: OPTOUT_CUST,
        ...slot(13),
        status: 'confirmed',
        totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
        remainingBalance: 15000, discountAmount: 0, finalAmount: 20000,
        paymentStatus: 'deposit_paid',
      },
    })
    // Email-only: teléfono no-whatsappeable ('1') pero email válido → contactable por email.
    // Sin-canal: teléfono no-whatsappeable y sin email → excluida de todo segmento.
    // Ambas inactivas (>60 días) para probar el choke point vía segmento 'inactive'.
    await prisma.customer.create({
      data: {
        id: EMAIL_ONLY_CUST, businessId: BIZ, name: 'Email Only', phone: '1',
        email: 'emailonly@cseg.test', lastCompletedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      },
    })
    await prisma.customer.create({
      data: {
        id: NOCHANNEL_CUST, businessId: BIZ, name: 'No Channel', phone: '1', email: null,
        lastCompletedAt: new Date(NOW.getTime() - 100 * DAY_MS),
      },
    })

    // Cancelada con saldo > 0: estado muerto → NO cuenta para pending_balance.
    await prisma.booking.create({
      data: {
        businessId: BIZ, serviceId: SVC, customerId: CANCELLED_BAL_CUST,
        ...slot(4),
        status: 'cancelled',
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
    expect(r.map((c) => c.id)).not.toContain(OTHER_MONTH_CUST) // cumple en otro mes
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
    expect(r.map((c) => c.id)).not.toContain(CANCELLED_BAL_CUST) // saldo sólo en booking cancelada
  })

  it('incluye clienta email-only y excluye a la que no tiene ningún canal', async () => {
    const r = await queryCampaignSegment(prisma, BIZ, 'inactive', { inactiveDays: 60 }, NOW, TZ)
    const ids = r.map((c) => c.id)
    expect(ids).toContain(EMAIL_ONLY_CUST) // teléfono no-whatsappeable pero email válido
    expect(ids).not.toContain(NOCHANNEL_CUST) // sin teléfono útil ni email
  })

  it('excluye a las clientas con marketingOptOutAt en los 4 segmentos', async () => {
    for (const segment of ['birthday_month', 'inactive', 'frequent', 'pending_balance'] as const) {
      const result = await queryCampaignSegment(
        prisma, BIZ, segment, { inactiveDays: 60, frequentMin: 3 }, NOW, TZ,
      )
      expect(result.map((c) => c.id)).not.toContain(OPTOUT_CUST)
    }
  })
})
