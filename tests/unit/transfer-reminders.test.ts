import { describe, it, expect, vi, beforeEach } from 'vitest'

// getBusinessReplyToEmail hits the real prisma; stub it. Keep the safe-wrappers real.
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return { ...actual, getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@biz.cl') }
})

import { sendTransferReminders } from '@/lib/cron/transfer-reminders'
import { BANK_TRANSFER_METHOD, declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'

const now = new Date('2026-07-11T12:00:00Z')

const acct = {
  accountHolder: 'H', rut: '1-1', bankName: 'B', accountType: 'vista',
  accountNumber: '123', email: null, instructions: null,
}
function custBooking() {
  return {
    id: 'bk1', bookingNumber: 4738, depositRequired: 10000, remainingBalance: 20000,
    holdExpiresAt: new Date('2026-07-11T14:00:00Z'),
    customer: { name: 'Ana', email: 'ana@x.cl' },
    service: { name: 'Corte' },
    business: {
      id: 'biz1', name: 'Bella', timezone: 'America/Santiago', currency: 'CLP',
      slug: 'bella', subdomain: 'bella', bankTransferAccount: acct,
    },
  }
}
function bizBooking() {
  return {
    id: 'bk2', bookingNumber: 99,
    customer: { name: 'Ana' }, service: { name: 'Corte' },
    business: { id: 'biz1', name: 'Bella' },
  }
}

function makeDb(opts: Record<string, any> = {}): any {
  const updateMany = vi.fn().mockImplementation(async ({ data }: any) => {
    if (data.transferReminderCustomerSentAt === null || data.transferReminderBusinessSentAt === null) {
      return { count: 1 } // release
    }
    if ('transferReminderCustomerSentAt' in data) return { count: opts.customerClaim ?? 1 }
    return { count: opts.businessClaim ?? 1 }
  })
  const findMany = vi.fn().mockImplementation(async ({ where }: any) => {
    if ('paymentMethod' in where) return opts.customerBookings ?? []
    return opts.businessBookings ?? []
  })
  return { booking: { findMany, updateMany } }
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    sendCustomer: vi.fn().mockResolvedValue({ success: true }),
    sendBusiness: vi.fn().mockResolvedValue([{ success: true }]),
    ...overrides,
  } as any
}

describe('sendTransferReminders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('empty batches → nothing sent', async () => {
    const db = makeDb()
    const d = deps()
    const res = await sendTransferReminders(now, db, d)
    expect(res).toEqual({ customerSent: 0, businessSent: 0, skipped: 0, errors: 0 })
    expect(d.sendCustomer).not.toHaveBeenCalled()
    expect(d.sendBusiness).not.toHaveBeenCalled()
  })

  it('customer booking selected → sends customer reminder with full data', async () => {
    const db = makeDb({ customerBookings: [custBooking()] })
    const d = deps()
    const res = await sendTransferReminders(now, db, d)

    expect(res.customerSent).toBe(1)
    expect(d.sendCustomer).toHaveBeenCalledTimes(1)
    const arg = d.sendCustomer.mock.calls[0][0]
    expect(arg.businessName).toBe('Bella')
    expect(arg.depositLabel).toContain('10.000')
    expect(arg.bankTransfer.accountNumber).toBe('123')
    expect(arg.bankTransfer.confirmationUrl).toContain('/book/confirmation?bookingId=bk1')
    expect(arg.bankTransfer.deadline).toEqual(new Date('2026-07-11T14:00:00Z'))
    expect(arg.customerEmail).toBe('ana@x.cl')
  })

  it('customer CAS: claim updateMany re-affirms the FULL where (landmine)', async () => {
    const db = makeDb({ customerBookings: [custBooking()] })
    await sendTransferReminders(now, db, deps())

    const claim = db.booking.updateMany.mock.calls.find(
      ([a]: any[]) => a.data.transferReminderCustomerSentAt instanceof Date,
    )
    expect(claim).toBeTruthy()
    const where = claim[0].where
    expect(where.id).toBe('bk1')
    expect(where.status).toBe('pending_payment')
    expect(where.paymentStatus).toBe('unpaid')
    expect(where.paymentMethod).toBe(BANK_TRANSFER_METHOD)
    expect(where.transferReminderCustomerSentAt).toBeNull()
    expect(where.holdExpiresAt).toBeTruthy()
    expect(where.payments).toBeTruthy() // MP-pending / declared exclusion re-affirmed
    expect(where.business).toBeTruthy()
  })

  it('customer CAS count===0 (state changed) → does not send', async () => {
    const db = makeDb({ customerBookings: [custBooking()], customerClaim: 0 })
    const d = deps()
    const res = await sendTransferReminders(now, db, d)
    expect(d.sendCustomer).not.toHaveBeenCalled()
    expect(res.customerSent).toBe(0)
    expect(res.skipped).toBe(1)
  })

  it('customer email not sent (success:false) → releases the flag + skipped', async () => {
    const db = makeDb({ customerBookings: [custBooking()] })
    const d = deps({ sendCustomer: vi.fn().mockResolvedValue({ success: false, skipped: 'no email' }) })
    const res = await sendTransferReminders(now, db, d)

    expect(res.customerSent).toBe(0)
    expect(res.skipped).toBe(1)
    const release = db.booking.updateMany.mock.calls.find(
      ([a]: any[]) => a.data.transferReminderCustomerSentAt === null,
    )
    expect(release).toBeTruthy()
    expect(release[0].where).toEqual({ id: 'bk1', transferReminderCustomerSentAt: now })
  })

  it('business booking declared → sends business reminder', async () => {
    const db = makeDb({ businessBookings: [bizBooking()] })
    const d = deps()
    const res = await sendTransferReminders(now, db, d)

    expect(res.businessSent).toBe(1)
    expect(d.sendBusiness).toHaveBeenCalledTimes(1)
    expect(d.sendBusiness.mock.calls[0][0]).toBe('biz1')
    const arg = d.sendBusiness.mock.calls[0][1]
    expect(arg.businessName).toBe('Bella')
    expect(arg.customerName).toBe('Ana')
    expect(arg.serviceName).toBe('Corte')
    expect(arg.bookingNumber).toBe(99)
  })

  it('business where re-affirms declared payment on both branches', async () => {
    const db = makeDb({ businessBookings: [bizBooking()] })
    await sendTransferReminders(now, db, deps())
    const findCall = db.booking.findMany.mock.calls.find(([a]: any[]) => 'OR' in a.where)
    expect(findCall).toBeTruthy()
    const or = findCall[0].where.OR
    expect(or).toHaveLength(2)
    // both branches require the declared-transfer payment
    expect(or[0].payments.some).toMatchObject(declaredTransferPaymentWhere)
    expect(or[1].payments.some).toMatchObject(declaredTransferPaymentWhere)
  })

  it('business all sends fail → releases + skipped', async () => {
    const db = makeDb({ businessBookings: [bizBooking()] })
    const d = deps({ sendBusiness: vi.fn().mockResolvedValue([{ success: false, skipped: 'no owners' }]) })
    const res = await sendTransferReminders(now, db, d)

    expect(res.businessSent).toBe(0)
    expect(res.skipped).toBe(1)
    const release = db.booking.updateMany.mock.calls.find(
      ([a]: any[]) => a.data.transferReminderBusinessSentAt === null,
    )
    expect(release).toBeTruthy()
    expect(release[0].where).toEqual({ id: 'bk2', transferReminderBusinessSentAt: now })
  })
})
