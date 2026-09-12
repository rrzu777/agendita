import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { snapshotServiceLines } from '@/lib/bookings/service-lines'
import { requireTestDatabase } from './setup'

requireTestDatabase()
const biz = 'multiservice-schema-test'
const owner = 'multiservice-schema-owner'
const customer = 'multiservice-schema-customer'
const services = [
  { id: 'multiservice-cut', name: 'Corte', durationMinutes: 45, price: 15000, depositAmount: 5000 },
  { id: 'multiservice-nose', name: 'Nasal', durationMinutes: 20, price: 4000, depositAmount: 1000 },
]
const bookingData = {
  businessId: biz, customerId: customer, serviceId: services[0].id,
  startDateTime: new Date('2027-01-14T13:00:00Z'), endDateTime: new Date('2027-01-14T14:05:00Z'),
  status: 'cancelled' as const, totalPrice: 19000, depositRequired: 6000, finalAmount: 19000,
  remainingBalance: 19000, paymentStatus: 'unpaid' as const,
}

async function cleanup() {
  await prisma.business.deleteMany({ where: { id: biz } })
  await prisma.user.deleteMany({ where: { id: owner } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.user.create({ data: { id: owner, email: 'multiservice-schema@synthetic.test' } })
  await prisma.business.create({ data: { id: biz, slug: biz, subdomain: biz, name: 'Synthetic multi', ownerUserId: owner, city: 'Santiago' } })
  await prisma.customer.create({ data: { id: customer, businessId: biz, name: 'Synthetic', phone: '+56900000000' } })
  await prisma.service.createMany({ data: services.map(s => ({ ...s, businessId: biz, pastelColor: '#FFFFFF' })) })
})
afterAll(async () => { await cleanup(); await prisma.$disconnect() })

describe('BookingService migration', () => {
  it('allows legacy bookings without fabricated lines', async () => {
    const booking = await prisma.booking.create({ data: bookingData, include: { serviceLines: true } })
    expect(booking.serviceLines).toEqual([])
  })
  it('snapshots two services atomically and ignores later catalogue edits', async () => {
    const booking = await prisma.booking.create({ data: { ...bookingData, serviceLines: { create: snapshotServiceLines(services) } } })
    await prisma.service.update({ where: { id: services[0].id }, data: { name: 'Changed', price: 99999 } })
    const lines = await prisma.bookingService.findMany({ where: { bookingId: booking.id }, orderBy: { position: 'asc' } })
    expect(lines.map(l => l.name)).toEqual(['Corte', 'Nasal'])
    expect(lines.reduce((sum, l) => sum + l.finalAmount, 0)).toBe(booking.finalAmount)
  })
  it('rolls back the parent when a nested line violates amount constraints', async () => {
    const count = await prisma.booking.count({ where: { businessId: biz } })
    await expect(prisma.booking.create({ data: {
      ...bookingData, serviceLines: { create: [{ ...snapshotServiceLines(services)[0], finalAmount: 1 }] },
    } })).rejects.toThrow()
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBe(count)
  })
  it('rejects duplicate positions and duplicate service ids', async () => {
    const lines = snapshotServiceLines(services)
    for (const invalid of [[lines[0], { ...lines[1], position: 0 }], [lines[0], { ...lines[0], position: 1 }]]) {
      await expect(prisma.booking.create({ data: { ...bookingData, serviceLines: { create: invalid } } })).rejects.toThrow()
    }
  })
  it('cannot cascade-delete booking history by deleting the legacy service', async () => {
    await expect(prisma.service.delete({ where: { id: services[0].id } })).rejects.toThrow()
    expect(await prisma.booking.count({ where: { businessId: biz } })).toBeGreaterThan(0)
  })
  it('enables row security without anonymous/public access policies', async () => {
    const rows = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE oid = '"BookingService"'::regclass`
    expect(rows[0].relrowsecurity).toBe(true)
    const policies = await prisma.$queryRaw<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE tablename = 'BookingService'`
    expect(policies).toEqual([])
  })
  it('still allows whole-business deletion, including its lines', async () => {
    const ids = (await prisma.booking.findMany({ where: { businessId: biz }, select: { id: true } })).map(b => b.id)
    await prisma.business.delete({ where: { id: biz } })
    expect(await prisma.bookingService.count({ where: { bookingId: { in: ids } } })).toBe(0)
  })
})
