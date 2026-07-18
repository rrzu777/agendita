import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addHours } from 'date-fns'
import { sendTransferReminders } from '@/lib/cron/transfer-reminders'

// getBusinessReplyToEmail pega a prisma real; los safe-wrappers se stubean como
// passthrough para que un rechazo del sender llegue al catch del cron (errors++).
vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications')>()),
  getBusinessReplyToEmail: async () => null,
  sendNotificationSafely: async (_l: string, fn: () => Promise<{ success: boolean }>) => fn(),
  sendMultiNotificationSafely: async (_l: string, fn: () => Promise<{ success: boolean }[]>) => fn(),
}))

const now = new Date('2026-07-16T12:00:00Z')
const acct = {
  accountHolder: 'X', rut: '1-9', bankName: 'B', accountType: 'c', accountNumber: '1',
  email: null, instructions: null, isEnabled: true, holdHours: 48,
}
const biz = { id: 'b1', name: 'Biz', timezone: 'America/Santiago', currency: 'CLP', slug: 'biz', subdomain: null, bankTransferAccount: acct }

function makeDb() {
  return {
    booking: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    packagePurchase: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
}

const basePurchase = {
  id: 'pp1', pricePaid: 50000, holdExpiresAt: addHours(now, 2),
  customer: { name: 'Ana', email: 'ana@x.cl' },
  product: { name: 'Pack 5' },
  business: biz,
}

describe('sendTransferReminders — rama paquetes', () => {
  const deps = {
    sendCustomer: vi.fn().mockResolvedValue({ success: true }),
    sendBusiness: vi.fn().mockResolvedValue([{ success: true }]),
    sendPkgCustomer: vi.fn().mockResolvedValue({ success: true }),
    sendPkgBusiness: vi.fn().mockResolvedValue([{ success: true }]),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    deps.sendCustomer.mockResolvedValue({ success: true })
    deps.sendBusiness.mockResolvedValue([{ success: true }])
    deps.sendPkgCustomer.mockResolvedValue({ success: true })
    deps.sendPkgBusiness.mockResolvedValue([{ success: true }])
  })

  it('reclama y manda el recordatorio a la clienta con el link de la confirmation', async () => {
    const db = makeDb()
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(res.packageCustomerSent).toBe(1)
    const arg = deps.sendPkgCustomer.mock.calls[0][0]
    expect(arg.productName).toBe('Pack 5')
    expect(arg.bankTransfer.confirmationUrl).toContain('purchaseId=pp1')
    expect(db.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pp1' }),
      data: { transferReminderCustomerSentAt: now },
    }))
  })

  it('si el claim pierde la carrera (count 0), no manda', async () => {
    const db = makeDb()
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    db.packagePurchase.updateMany.mockResolvedValue({ count: 0 })
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(deps.sendPkgCustomer).not.toHaveBeenCalled()
    expect(res.packageCustomerSent).toBe(0)
  })

  it('manda el aviso a la dueña por declarada envejecida (rama dueña)', async () => {
    const db = makeDb()
    db.packagePurchase.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pp2', customer: { name: 'Ana' }, product: { name: 'Pack 5' }, business: { id: 'b1', name: 'Biz' } }])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(deps.sendPkgBusiness).toHaveBeenCalledWith('b1', expect.objectContaining({ productName: 'Pack 5' }))
    expect(res.packageBusinessSent).toBe(1)
  })

  it('si el envío a la clienta falla, libera el claim', async () => {
    deps.sendPkgCustomer.mockRejectedValueOnce(new Error('smtp down'))
    const db = makeDb()
    db.packagePurchase.findMany.mockResolvedValueOnce([basePurchase]).mockResolvedValueOnce([])
    const res = await sendTransferReminders(now, db as never, deps as never)
    expect(res.errors).toBe(1)
    expect(db.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { transferReminderCustomerSentAt: null },
    }))
  })
})
