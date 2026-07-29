import { PrismaClient, BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { emitAutomaticReward, reverseAutoRewardsForBooking, type AutomaticRule } from '@/lib/loyalty/automatic'

requireTestDatabase()

const BIZ = 'lydx-biz-1'
const USER = 'lydx-user-1'

// El dedup de loyalty tiene que resolverse ANTES del insert. Si se resolviera con un
// try/catch del P2002 —como estaba— Postgres abortaría la transacción entera y todo
// lo que viniera después en esa misma tx se caería con "current transaction is
// aborted". Cada test hace una escritura DESPUÉS de la segunda emisión: es justo esa
// escritura la que se rompía.
describe('dedup de loyalty adentro de una transacción', () => {
  let prisma: PrismaClient
  let customerId: string
  let bookingId: string

  const rule: AutomaticRule = {
    id: 'lydx-rule-1',
    businessId: BIZ,
    conditions: { kind: 'birthday' },
    rewardPoints: 150,
    rewardType: null,
    rewardValue: 0,
    maxDiscount: null,
    appliesToAll: true,
    grantExpiryDays: null,
  }
  const config = { grantExpiryDays: 90, forfeitGrantOnNoShow: false }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'lydx@t.test', name: 'Owner LY' } })
    await prisma.business.create({ data: {
      id: BIZ, name: 'LY Biz', slug: 'ly-biz', subdomain: 'lybiz', ownerUserId: USER,
      city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
    } })
    const customer = await prisma.customer.create({ data: {
      businessId: BIZ, name: 'Cli LY', phone: '+56900000051',
    } })
    customerId = customer.id
    const service = await prisma.service.create({ data: {
      businessId: BIZ, name: 'Sesión LY', durationMinutes: 60, price: 10000,
      depositAmount: 0, pastelColor: '#FFD700',
    } })
    const booking = await prisma.booking.create({ data: {
      businessId: BIZ, serviceId: service.id, customerId,
      startDateTime: new Date('2026-09-10T15:00:00Z'), endDateTime: new Date('2026-09-10T16:00:00Z'),
      status: BookingStatus.completed, paymentStatus: BookingPaymentStatus.fully_paid,
      totalPrice: 10000, depositRequired: 0, depositPaid: 10000, remainingBalance: 0, finalAmount: 10000,
    } })
    bookingId = booking.id
  })

  afterAll(async () => {
    await prisma.loyaltyLedger.deleteMany({ where: { businessId: BIZ } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('emitir dos veces el mismo dedupeKey no tumba la tx que lo rodea', async () => {
    const emit = () => prisma.$transaction(async (tx) => {
      const out = await emitAutomaticReward(tx, {
        rule, businessId: BIZ, customerId, dedupeKey: 'lydx:birthday:2026',
        config, triggeringBookingId: bookingId, now: new Date('2026-09-01'),
      })
      // Escritura POSTERIOR en la MISMA tx: con un P2002 sin atajar, esto explota.
      await tx.customer.update({ where: { id: customerId }, data: { notes: `emitido:${!!out}` } })
      return out
    })

    expect(await emit()).not.toBeNull()
    expect(await emit()).toBeNull()

    const bonuses = await prisma.loyaltyLedger.count({ where: { businessId: BIZ, reason: 'bonus' } })
    expect(bonuses).toBe(1)
    // La segunda tx commiteó de verdad: la escritura de después quedó.
    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    expect(customer!.notes).toBe('emitido:false')
  })

  it('reversar dos veces la misma reserva no tumba la tx que lo rodea', async () => {
    const reverse = () => prisma.$transaction(async (tx) => {
      await reverseAutoRewardsForBooking(tx, bookingId, new Date('2026-09-05'), BIZ)
      await tx.booking.update({ where: { id: bookingId }, data: { internalNotes: 'reversado' } })
    })

    await reverse()
    await reverse() // el que rompía: el asiento de reversión ya existe

    const reversals = await prisma.loyaltyLedger.count({
      where: { businessId: BIZ, reason: 'bonus_reversal' },
    })
    expect(reversals).toBe(1)
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.internalNotes).toBe('reversado')
  })
})
