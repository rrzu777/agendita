import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { cancellationPolicyRevision } from '@/lib/bookings/cancellation-policy-revision'
import { normalizePhone } from '@/lib/customers/phone'
import { requireTestDatabase } from './setup'
import { unwrap } from './helpers/action-result'

requireTestDatabase()
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/bookings/notifications', () => ({ fireBookingNotifications: vi.fn() }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: async () => null, getConfirmedSessionUser: async () => null }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/server')>()
  return { ...original, requireBusinessRole: async () => ({ user: { id: owner }, businessId: biz, business: await prisma.business.findUniqueOrThrow({ where: { id: biz } }) }) }
})

const biz = 'multi-booking-test'
const owner = 'multi-booking-owner'
const ids = ['multi-booking-cut', 'multi-booking-nose']
const start = new Date(Date.now() + 4 * 86400000)
start.setUTCHours(15, 0, 0, 0)
const input = {
  serviceId: ids[0], serviceIds: ids, customerName: 'Synthetic Guest', customerPhone: '+56900000022',
  startDateTime: start, acceptedTerms: true,
  cancellationPolicyRevision: cancellationPolicyRevision({ businessId: biz, cutoffHours: 24, additionalPolicy: null }),
}
async function reserve(extra: Partial<Parameters<typeof import('@/server/actions/bookings').createBooking>[0]> = {}) {
  const { createBooking } = await import('@/server/actions/bookings')
  return createBooking({ ...input, ...extra }, biz)
}
async function cleanup() {
  await prisma.promotionRedemption.deleteMany({ where: { businessId: biz } })
  await prisma.promotionGrant.deleteMany({ where: { businessId: biz } })
  await prisma.packagePurchase.deleteMany({ where: { businessId: biz } })
  await prisma.packageProduct.deleteMany({ where: { businessId: biz } })
  await prisma.promotion.deleteMany({ where: { businessId: biz } })
  await prisma.business.deleteMany({ where: { id: biz } })
  await prisma.user.deleteMany({ where: { id: owner } })
}
beforeAll(async () => {
  await cleanup()
  await prisma.user.create({ data: { id: owner, email: 'multi-booking@synthetic.test' } })
  await prisma.business.create({ data: { id: biz, slug: biz, subdomain: biz, name: 'Synthetic multi', ownerUserId: owner, city: 'Santiago', subscriptionStatus: 'active' } })
  await prisma.service.createMany({ data: [
    { id: ids[0], businessId: biz, name: 'Corte', price: 15000, depositAmount: 5000, durationMinutes: 45, pastelColor: '#FFFFFF' },
    { id: ids[1], businessId: biz, name: 'Nasal', price: 4000, depositAmount: 1000, durationMinutes: 20, pastelColor: '#FFFFFF' },
  ] })
  await prisma.availabilityRule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ businessId: biz, dayOfWeek, startTime: '00:00', endTime: '23:59', isActive: true })) })
})
beforeEach(async () => {
  await prisma.promotionGrant.deleteMany({ where: { businessId: biz } })
  await prisma.ledgerEntry.deleteMany({ where: { businessId: biz } })
  await prisma.payment.deleteMany({ where: { businessId: biz } })
  await prisma.packagePurchase.deleteMany({ where: { businessId: biz } })
  await prisma.packageProduct.deleteMany({ where: { businessId: biz } })
  await prisma.booking.deleteMany({ where: { businessId: biz } })
  await prisma.timeBlock.deleteMany({ where: { businessId: biz } })
  await prisma.professional.deleteMany({ where: { businessId: biz } })
  await prisma.promotion.deleteMany({ where: { businessId: biz } })
  await prisma.service.update({ where: { id: ids[0] }, data: { durationMinutes: 45, price: 15000, depositAmount: 5000 } })
  await prisma.service.update({ where: { id: ids[1] }, data: { price: 4000, depositAmount: 1000 } })
})
afterAll(async () => { await cleanup(); await prisma.$disconnect() })

describe('multiservice booking public transaction', () => {
  it.each([false, true])('rejects a mismatched quote during replay (collision fallback: %s)', async collision => {
    await unwrap(reserve({ idempotencyKey: 'quote-replay' }))
    const lookup = collision ? vi.spyOn(prisma.booking, 'findUnique').mockResolvedValueOnce(null) : null
    try {
      const retry = await reserve({ idempotencyKey: 'quote-replay', expected: { totalPrice: 19000, durationMinutes: 65, finalAmount: 4000, depositRequired: 1000 } })
      expect(retry).toMatchObject({ ok: false, error: expect.stringContaining('cambiaron') })
      expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(1)
    } finally { lookup?.mockRestore() }
  })
  it('replays the accepted stored quote even after catalogue prices and duration changed', async () => {
    const expected = { totalPrice: 19000, durationMinutes: 65, finalAmount: 19000, depositRequired: 6000 }
    const first = await unwrap(reserve({ idempotencyKey: 'accepted-quote', expected }))
    await prisma.service.update({ where: { id: ids[0] }, data: { price: 16000, durationMinutes: 60 } })
    const retry = await unwrap(reserve({ idempotencyKey: 'accepted-quote', expected }))
    expect(retry.id).toBe(first.id)
    expect(retry.finalAmount).toBe(19000)
  })
  it.each(['totalPrice', 'durationMinutes', 'finalAmount', 'depositRequired'] as const)('rejects stale reviewed %s without persisting a booking', async key => {
    const expected = { totalPrice: 19000, durationMinutes: 65, finalAmount: 19000, depositRequired: 6000 }
    const result = await reserve({ expected: { ...expected, [key]: expected[key] + 1 } })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('cambiaron') })
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(0)
  })
  it('rejects a stale discount preview and rolls back its redemption', async () => {
    await prisma.promotion.create({ data: { businessId: biz, name: 'Free cut', code: 'STALE', triggerType: 'code', rewardType: 'free_service', rewardValue: 0, appliesToAll: true } })
    const result = await reserve({ promotionCode: 'STALE', expected: { totalPrice: 19000, durationMinutes: 65, finalAmount: 0, depositRequired: 0 } })
    expect(result.ok).toBe(false)
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(0)
    expect(await prisma.promotionRedemption.count({ where: { businessId: biz } })).toBe(0)
    expect(await prisma.promotion.findFirstOrThrow({ where: { businessId: biz } })).toMatchObject({ redemptionCount: 0 })
  })
  it('persists bounded optional customer notes without changing internal notes', async () => {
    const result = await unwrap(reserve({ customerNotes: '  Prefiero tijeras  ' }))
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ customerNotes: 'Prefiero tijeras', internalNotes: null })
    expect((await reserve({ customerNotes: 'x'.repeat(1001), startDateTime: new Date(start.getTime() + 86400000) })).ok).toBe(false)
  })
  it('previews bounded days using the full duration and rejects tampered ranges/tenants', async () => {
    const { getAvailabilityPreview } = await import('@/server/actions/availability')
    const date = start.toISOString().slice(0, 10)
    const preview = await unwrap(getAvailabilityPreview({ businessId: biz, serviceIds: ids, from: date, days: 3, professional: { kind: 'none' }, modality: 'on_site' }))
    expect(preview.days).toHaveLength(3)
    expect(preview.days[0].count).toBeGreaterThan(0)
    expect(preview.days[0].firstSlot!.end.getTime() - preview.days[0].firstSlot!.start.getTime()).toBe(65 * 60000)
    expect((await getAvailabilityPreview({ businessId: biz, serviceIds: ids, from: date, days: 32, professional: { kind: 'none' } })).ok).toBe(false)
    expect((await getAvailabilityPreview({ businessId: 'other', serviceIds: ids, from: date, days: 1, professional: { kind: 'none' } })).ok).toBe(false)
  })
  it('persists one appointment with two lines and their complete amount/interval', async () => {
    const result = await unwrap(reserve())
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.id }, include: { serviceLines: true } })
    expect(booking).toMatchObject({ totalPrice: 19000, finalAmount: 19000, depositRequired: 6000 })
    expect(booking.endDateTime.getTime() - start.getTime()).toBe(65 * 60000)
    expect(booking.serviceLines.map(l => l.serviceId).sort()).toEqual([...ids].sort())
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(1)
  })
  it('replays the same full selection but rejects a changed second line', async () => {
    const first = await unwrap(reserve({ idempotencyKey: 'multi-replay' }))
    expect((await unwrap(reserve({ idempotencyKey: 'multi-replay' }))).id).toBe(first.id)
    expect((await reserve({ idempotencyKey: 'multi-replay', serviceIds: [ids[0]] })).ok).toBe(false)
  })
  it('cannot overlap a block that starts after the first service ends', async () => {
    await prisma.timeBlock.create({ data: { businessId: biz, startDateTime: new Date(start.getTime() + 50 * 60000), endDateTime: new Date(start.getTime() + 80 * 60000), reason: 'Synthetic tail block' } })
    expect((await reserve()).ok).toBe(false)
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(0)
  })
  it('rejects an active team with no shared eligible professional', async () => {
    const person = await prisma.professional.create({ data: { businessId: biz, name: 'Only cut', services: { connect: { id: ids[0] } } } })
    for (const professional of [{ kind: 'none' as const }, { kind: 'anyone' as const }, { kind: 'person' as const, id: person.id }]) {
      expect((await reserve({ professional })).ok).toBe(false)
    }
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(0)
  })
  it('keeps a service-scoped percentage discount off unrelated lines', async () => {
    await prisma.promotion.create({ data: { businessId: biz, name: 'Nasal half', code: 'NASAL50', triggerType: 'code', rewardType: 'percentage', rewardValue: 50, appliesToAll: false, services: { connect: { id: ids[1] } } } })
    const result = await unwrap(reserve({ promotionCode: 'NASAL50' }))
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.id }, include: { serviceLines: { orderBy: { position: 'asc' } }, redemption: true } })
    expect(booking).toMatchObject({ discountAmount: 2000, finalAmount: 17000 })
    expect(booking.serviceLines.map(l => l.discountAmount)).toEqual([0, 2000])
    expect(booking.redemption?.discountAmount).toBe(2000)
    const { previewPromotion } = await import('@/server/actions/promotions')
    expect(await previewPromotion({ businessId: biz, serviceIds: ids, code: 'NASAL50' })).toMatchObject({ ok: true, data: { ok: true, discount: 2000, finalAmount: 17000, depositRequired: booking.depositRequired } })
  })
  it('a free-service reward removes only that line and its deposit', async () => {
    await prisma.promotion.create({ data: { businessId: biz, name: 'Free cut', code: 'FREECUT', triggerType: 'code', rewardType: 'free_service', rewardValue: 0, appliesToAll: true } })
    const result = await unwrap(reserve({ promotionCode: 'FREECUT' }))
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.id }, include: { serviceLines: { orderBy: { position: 'asc' } } } })
    expect(booking).toMatchObject({ discountAmount: 15000, finalAmount: 4000, depositRequired: 1000 })
    expect(booking.serviceLines.map(l => l.finalAmount)).toEqual([0, 4000])
  })
  it('manual full payment records one total and line snapshots, not two charges', async () => {
    const { createBookingFromDashboard } = await import('@/server/actions/bookings')
    const result = await unwrap(createBookingFromDashboard({ ...input, paymentMode: 'full_paid', paymentMethod: 'cash' }))
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.id }, include: { payments: true, serviceLines: true } })
    expect(booking).toMatchObject({ finalAmount: 19000, depositPaid: 19000, remainingBalance: 0, status: 'confirmed', paymentStatus: 'fully_paid' })
    expect(booking.serviceLines).toHaveLength(2)
    expect(booking.payments).toHaveLength(1)
    expect(booking.payments[0].amount).toBe(19000)
  })
  it('a free-service code skips free add-ons and is not consumed for an all-free cart', async () => {
    const promo = await prisma.promotion.create({ data: { businessId: biz, name: 'Free paid line', code: 'FREEPAID', triggerType: 'code', rewardType: 'free_service', rewardValue: 0, appliesToAll: true } })
    await prisma.service.update({ where: { id: ids[0] }, data: { price: 0, depositAmount: 0 } })
    expect(await unwrap(reserve({ promotionCode: 'FREEPAID' }))).toMatchObject({ discountAmount: 4000, finalAmount: 0 })
    await prisma.service.update({ where: { id: ids[1] }, data: { price: 0, depositAmount: 0 } })
    expect((await reserve({ promotionCode: 'FREEPAID', startDateTime: new Date(start.getTime() + 86400000) })).ok).toBe(false)
    expect(await prisma.promotionRedemption.count({ where: { promotionId: promo.id } })).toBe(1)
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } })).redemptionCount).toBe(1)
  })
  it('spends one prepaid session on one eligible line, and cancellation releases it', async () => {
    const phone = normalizePhone(input.customerPhone)
    const customer = await prisma.customer.upsert({ where: { businessId_phone: { businessId: biz, phone } }, update: {}, create: { businessId: biz, phone, name: input.customerName } })
    const product = await prisma.packageProduct.create({ data: { businessId: biz, name: 'Synthetic two cuts', price: 24000, quantity: 2 } })
    const purchase = await prisma.packagePurchase.create({ data: { businessId: biz, customerId: customer.id, packageProductId: product.id, pricePaid: 24000, quantity: 2, coveredServiceIds: [ids[0]], coversAll: false, source: 'manual' } })
    const promo = await prisma.promotion.create({ data: { businessId: biz, name: 'Synthetic package marker', triggerType: 'granted', rewardType: 'free_service', rewardValue: 0, appliesToAll: true } })
    await prisma.promotionGrant.createMany({ data: [0, 1].map(index => ({ businessId: biz, customerId: customer.id, promotionId: promo.id, code: 'MULTI-PACKAGE-' + index, pointsSpent: 0, requestId: 'multi-package-' + index, packagePurchaseId: purchase.id, refundOnExpiry: false, forfeitOnNoShow: false })) })
    const { getActivePackagesForCustomer } = await import('@/server/actions/packages')
    expect(await getActivePackagesForCustomer({ businessId: biz, phone: input.customerPhone, serviceIds: ids })).toMatchObject({ ok: true, data: { remaining: 2, coveredServiceId: ids[0], discountAmount: 15000, depositRequired: 1000 } })
    const result = await unwrap(reserve({ promotionCode: 'IGNORED-BECAUSE-PACKAGE' }))
    expect(result).toMatchObject({ discountAmount: 15000, finalAmount: 4000, depositRequired: 1000 })
    expect(await prisma.promotionRedemption.count({ where: { bookingId: result.id } })).toBe(1)
    expect(await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id, status: 'active' } })).toBe(1)
    const { cancelBooking } = await import('@/server/actions/bookings')
    await unwrap(cancelBooking(result.id))
    expect(await prisma.promotionGrant.count({ where: { packagePurchaseId: purchase.id, status: 'active' } })).toBe(2)
  })
  it('rescheduling and its preview retain the booked duration after catalogue edits', async () => {
    const result = await unwrap(reserve())
    await prisma.service.update({ where: { id: ids[0] }, data: { durationMinutes: 10 } })
    const { getAvailableSlotsForReschedule } = await import('@/server/actions/availability')
    const slots = await unwrap(getAvailableSlotsForReschedule(result.id, new Date(start.getTime() + 86400000)))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].end.getTime() - slots[0].start.getTime()).toBe(65 * 60000)
    const { rescheduleBooking } = await import('@/server/actions/bookings')
    await unwrap(rescheduleBooking(result.id, slots[0].start))
    const moved = await prisma.booking.findUniqueOrThrow({ where: { id: result.id } })
    expect(moved.endDateTime.getTime() - moved.startDateTime.getTime()).toBe(65 * 60000)
  })
  it('only shared professionals appear in availability and reassignment', async () => {
    const partial = await prisma.professional.create({ data: { businessId: biz, name: 'Partial', services: { connect: { id: ids[0] } } } })
    const shared = await prisma.professional.create({ data: { businessId: biz, name: 'Shared', services: { connect: ids.map(id => ({ id })) } } })
    const { getAvailableTimeSlotsResult } = await import('@/server/actions/availability')
    const availability = await unwrap(getAvailableTimeSlotsResult({ businessId: biz, serviceIds: ids, date: start, professional: { kind: 'anyone' } }))
    expect(availability.slots.length).toBeGreaterThan(0)
    expect(availability.slots[0].end.getTime() - availability.slots[0].start.getTime()).toBe(65 * 60000)
    expect((await getAvailableTimeSlotsResult({ businessId: biz, serviceIds: ids, date: start, professional: { kind: 'person', id: partial.id } })).ok).toBe(false)
    const result = await unwrap(reserve({ professional: { kind: 'anyone' } }))
    expect(result.professionalId).toBe(shared.id)
    const { getReassignTargets, reassignBooking } = await import('@/server/actions/bookings')
    expect(await unwrap(getReassignTargets(result.id))).toEqual([])
    expect((await reassignBooking(result.id, partial.id)).ok).toBe(false)
  })
  it('concurrent same-key submissions produce one booking and two lines', async () => {
    const results = await Promise.all([reserve({ idempotencyKey: 'multi-race' }), reserve({ idempotencyKey: 'multi-race' })])
    const successes = results.filter(r => r.ok)
    expect(successes).toHaveLength(2)
    expect(new Set(successes.map(result => result.data.id)).size).toBe(1)
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(1)
    expect(await prisma.bookingService.count({ where: { booking: { businessId: biz } } })).toBe(2)
  })
})
