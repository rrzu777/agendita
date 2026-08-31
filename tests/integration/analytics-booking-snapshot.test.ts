import { randomUUID } from 'node:crypto'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { requireAnalyticsTestDatabase } from '../helpers/analytics-database'
import { configureCapture, captureSecret, liveCaptureClaims } from '../helpers/analytics-capture'
import { signAnalyticsCredential } from '@/lib/analytics/credential'
import { getBookingAnalyticsSnapshot } from '@/lib/analytics/booking-snapshot'

requireAnalyticsTestDatabase()
const db = new PrismaClient()
const businessId = `snapshot-${randomUUID()}`
describe('verified scalar snapshots in actual PostgreSQL Booking writes', () => {
  let base: Prisma.BookingUncheckedCreateInput
  beforeAll(async () => {
    configureCapture(businessId)
    await db.business.create({ data: { id: businessId, slug: businessId, subdomain: businessId, name: 'Synthetic snapshot', ownerUserId: 'synthetic-owner', city: 'Santiago' } })
    const customer = await db.customer.create({ data: { businessId, name: 'Synthetic', phone: `test-${randomUUID()}` } })
    const service = await db.service.create({ data: { businessId, name: 'Synthetic', durationMinutes: 60, price: 0, depositAmount: 0, pastelColor: '#ffffff' } })
    base = { businessId, customerId: customer.id, serviceId: service.id, startDateTime: new Date('2026-09-10T12:00:00Z'), endDateTime: new Date('2026-09-10T13:00:00Z'), status: 'cancelled', totalPrice: 0, depositRequired: 0, remainingBalance: 0, finalAmount: 0, paymentStatus: 'unpaid' }
  })
  afterAll(async () => { await db.business.deleteMany({ where: { id: businessId } }); await db.$disconnect(); vi.unstubAllEnvs() })
  it('permits two bookings for one attempt and does not impose analytics conversion time on transactional creation', async () => {
    const credential = signAnalyticsCredential(liveCaptureClaims(businessId), captureSecret)
    const snapshot = getBookingAnalyticsSnapshot({ credential, businessId, origin: 'https://salon.agendita.test', now: new Date(), selectionRevision: 2 })
    expect(snapshot).not.toBeNull()
    const rows = await db.$transaction([
      db.booking.create({ data: { ...base, ...snapshot } }),
      db.booking.create({ data: { ...base, ...snapshot, createdAt: new Date(Date.now() + 2 * 86400000) } }),
    ])
    expect(rows[0].id).not.toBe(rows[1].id)
    expect(rows.every((row) => row.analyticsAttemptId === snapshot?.analyticsAttemptId)).toBe(true)
    expect(await db.bookingFunnelAttempt.count({ where: { businessId } })).toBe(0)
  })
  it('expired credentials are omitted and the booking still commits with unchanged domain fields', async () => {
    const now = new Date()
    const credential = signAnalyticsCredential(liveCaptureClaims(businessId), captureSecret)
    const snapshot = getBookingAnalyticsSnapshot({ credential, businessId, origin: 'https://salon.agendita.test', now: new Date(now.getTime() + 86400000) })
    expect(snapshot).toBeNull()
    expect(await db.booking.create({ data: { ...base, ...snapshot } })).toMatchObject({ analyticsAttemptId: null, analyticsChannel: null, finalAmount: 0, status: 'cancelled' })
  })
})
