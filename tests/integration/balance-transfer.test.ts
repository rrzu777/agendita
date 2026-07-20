import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { requireTestDatabase } from './setup'
import { seedDeclaredTransfer, cleanupBankTransferSeed, BT_VERIFY_BIZ } from './helpers/bank-transfer-seed'
import { btBalanceId } from '@/lib/bank-transfer/declared'
import { expectActionError, unwrap } from './helpers/action-result'

requireTestDatabase()

// Mismo approach que revive-booking.test.ts: mockeamos las capas de
// infraestructura (auth, rate limit, revalidación, notificaciones) para
// ejercitar la LÓGICA REAL de finance.ts contra un Postgres real. Este archivo
// será extendido por Tasks 4-6 (confirmBankTransfer del saldo), que sí
// ejercitan las server actions y necesitan estos mocks.
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => {
    const { prisma } = await import('@/lib/db')
    const business = await prisma.business.findFirstOrThrow({ where: { slug: 'btv-biz' } })
    return { user: { id: business.ownerUserId }, business, role: 'owner', businessId: business.id }
  },
  requireBusinessRole: async () => {
    const { prisma } = await import('@/lib/db')
    const business = await prisma.business.findFirstOrThrow({ where: { slug: 'btv-biz' } })
    return { user: { id: business.ownerUserId }, business, role: 'owner', businessId: business.id }
  },
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: async () => null, getConfirmedSessionUser: async () => null }))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: async () => 'owner@btv.test',
  sendBookingReceivedToCustomer: async () => ({ success: true }),
  sendNewBookingNotificationToBusiness: async () => [],
  sendBookingCancelledNotification: async () => ({ success: true }),
  sendBookingConfirmedNotification: async () => ({ success: true }),
  sendBookingRescheduledNotification: async () => ({ success: true }),
  sendBankTransferRejectedToCustomer: async () => ({ success: true }),
  sendBankTransferExpiredToCustomer: async () => ({ success: true }),
  sendTransferReactivatedToCustomer: async () => ({ success: true }),
  sendBankTransferDeclaredToBusiness: async () => [],
  // Saldo por transferencia (Task 5 asserta cuál de estos se llamó).
  sendBalanceTransferDeclaredToBusiness: vi.fn(async () => []),
  sendBalanceTransferVerifiedToCustomer: vi.fn(async () => ({ success: true })),
  sendBalanceTransferRejectedToCustomer: vi.fn(async () => ({ success: true })),
  sendLoyaltyRewardNotification: async () => ({ success: true }),
  // Ejecuta el callback para que la construcción del payload post-tx corra en
  // los tests (los senders internos ya están mockeados).
  sendNotificationSafely: async (_label: string, fn: () => Promise<unknown>) => {
    await fn()
    return { success: true }
  },
  sendMultiNotificationSafely: async () => [],
  buildWhatsappUrl: () => 'https://wa.me/x',
}))

afterAll(async () => {
  await cleanupBankTransferSeed()
  await prisma.$disconnect()
})

// Reserva CONFIRMADA con abono pagado (deposit approved) y saldo pendiente.
async function seedConfirmedWithBalance(opts: Parameters<typeof seedDeclaredTransfer>[0] = {}) {
  const seeded = await seedDeclaredTransfer(opts)
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
  await prisma.payment.update({ where: { id: seeded.paymentId }, data: { status: 'approved' } })
  await prisma.booking.update({
    where: { id: seeded.bookingId },
    data: {
      status: 'confirmed',
      depositPaid: booking.depositRequired,
      remainingBalance: booking.finalAmount - booking.depositRequired,
      paymentStatus: 'deposit_paid',
    },
  })
  return { ...seeded, remainingBalance: booking.finalAmount - booking.depositRequired }
}

// Un bt-balance pending sembrado directo (para tests de finance/sweeps).
async function seedPendingBalance(bookingId: string, customerId: string, amount: number) {
  return prisma.payment.create({
    data: {
      businessId: BT_VERIFY_BIZ, bookingId, customerId,
      provider: 'manual', providerPaymentId: btBalanceId(bookingId),
      amount, currency: 'CLP', status: 'pending', paymentType: 'final_payment',
      paymentMethod: 'Transferencia',
    },
  })
}

describe('finance: allowCompleted + autolimpieza bt-balance', () => {
  it('applyApprovedPayment sobre completed falla sin allowCompleted y pasa con él', async () => {
    const seeded = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'completed' } })
    const { applyApprovedPayment } = await import('@/server/services/finance')
    const base = {
      bookingId: seeded.bookingId, businessId: BT_VERIFY_BIZ,
      amount: seeded.remainingBalance, currency: 'CLP',
      provider: 'manual' as const, providerPaymentId: `manual-test-${seeded.bookingId}`,
      paymentType: 'final_payment' as const, paymentMethod: 'Transferencia',
    }
    await expect(
      prisma.$transaction((tx) => applyApprovedPayment({ tx, ...base })),
    ).rejects.toThrow('No se puede procesar pago')
    await prisma.$transaction((tx) => applyApprovedPayment({ tx, ...base, allowCompleted: true }))
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.status).toBe('completed') // el status NO cambia
  })

  it('recalc con saldo 0 cancela los bt-balance pendientes (autolimpieza)', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { applyApprovedPayment } = await import('@/server/services/finance')
    await prisma.$transaction((tx) => applyApprovedPayment({
      tx, bookingId: seeded.bookingId, businessId: BT_VERIFY_BIZ,
      amount: seeded.remainingBalance, currency: 'CLP',
      provider: 'manual', providerPaymentId: null,
      paymentType: 'final_payment', paymentMethod: 'Efectivo',
    }))
    const bal = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(bal.status).toBe('cancelled')
  })
})

describe('declareBalanceTransfer', () => {
  it('happy path: crea bt-balance pending con monto=saldo y paymentType derivado', async () => {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await unwrap(declareBalanceTransfer(seeded.bookingId))
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('pending')
    expect(p.amount).toBe(seeded.remainingBalance)
    expect(p.paymentType).toBe('final_payment') // depositPaid > 0
    expect(p.paymentMethod).toBe('Transferencia')
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed') // no toca status ni hold
  })

  it('guards por estado: pending_payment, cancelled, no_show', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const pending = await seedDeclaredTransfer()
    await expectActionError(declareBalanceTransfer(pending.bookingId), 'Primero confirmá')
    const cancelled = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: cancelled.bookingId }, data: { status: 'cancelled' } })
    await expectActionError(declareBalanceTransfer(cancelled.bookingId), 'cancelada')
    const noShow = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: noShow.bookingId }, data: { status: 'no_show' } })
    await expectActionError(declareBalanceTransfer(noShow.bookingId), 'no asistida')
  })

  it('sin saldo → error; cuenta deshabilitada → error', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const paid = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: paid.bookingId }, data: { remainingBalance: 0, paymentStatus: 'fully_paid' } })
    await expectActionError(declareBalanceTransfer(paid.bookingId), 'no tiene saldo')
    const seeded = await seedConfirmedWithBalance()
    await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: false } })
    try {
      await expectActionError(declareBalanceTransfer(seeded.bookingId), 'transferencia bancaria habilitada')
    } finally {
      await prisma.bankTransferAccount.update({ where: { businessId: BT_VERIFY_BIZ }, data: { isEnabled: true } })
    }
  })

  it('idempotencia: pending → éxito silencioso; approved+saldo residual → ERROR (no silencio)', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await unwrap(declareBalanceTransfer(seeded.bookingId))
    await unwrap(declareBalanceTransfer(seeded.bookingId)) // pending → ok silencioso
    const all = await prisma.payment.findMany({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
    expect(all).toHaveLength(1)
    await prisma.payment.update({ where: { id: all[0].id }, data: { status: 'approved' } })
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { remainingBalance: 5000 } })
    await expectActionError(declareBalanceTransfer(seeded.bookingId), 'parcialmente')
  })

  it('idempotencia: approved con saldo 0 → éxito silencioso sin tocar nada', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await unwrap(declareBalanceTransfer(seeded.bookingId))
    const p = await prisma.payment.findFirstOrThrow({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
    await prisma.payment.update({ where: { id: p.id }, data: { status: 'approved' } })
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { remainingBalance: 0, paymentStatus: 'fully_paid' } })
    await unwrap(declareBalanceTransfer(seeded.bookingId)) // no lanza
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('approved')
  })

  it('guard expired → mensaje propio', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await prisma.booking.update({ where: { id: seeded.bookingId }, data: { status: 'expired' } })
    await expectActionError(declareBalanceTransfer(seeded.bookingId), 'expiró')
  })

  it('reactivación: rejected Y cancelled → vuelven a pending con monto fresco', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    for (const dead of ['rejected', 'cancelled'] as const) {
      const seeded = await seedConfirmedWithBalance()
      await unwrap(declareBalanceTransfer(seeded.bookingId))
      const p = await prisma.payment.findFirstOrThrow({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
      await prisma.payment.update({ where: { id: p.id }, data: { status: dead, amount: 1 } })
      await unwrap(declareBalanceTransfer(seeded.bookingId))
      const again = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })
      expect(again.status).toBe('pending')
      expect(again.amount).toBe(seeded.remainingBalance)
    }
  })

  it('doble declare concurrente → 1 solo payment, sin errores (invariante P2002)', async () => {
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    const seeded = await seedConfirmedWithBalance()
    await Promise.all([unwrap(declareBalanceTransfer(seeded.bookingId)), unwrap(declareBalanceTransfer(seeded.bookingId))])
    const all = await prisma.payment.findMany({ where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) } })
    expect(all).toHaveLength(1)
  })
})

describe('confirmBankTransfer saldo', () => {
  async function declaredBalance() {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await unwrap(declareBalanceTransfer(seeded.bookingId))
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    return { ...seeded, balancePaymentId: p.id }
  }

  it('sobre confirmed → fully_paid, ledger final_payment, status intacto', async () => {
    const s = await declaredBalance()
    const notif = await import('@/lib/notifications')
    vi.mocked(notif.sendBalanceTransferVerifiedToCustomer).mockClear()
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await unwrap(confirmBankTransfer(s.balancePaymentId, s.remainingBalance))
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.remainingBalance).toBe(0)
    expect(b.status).toBe('confirmed')
    const ledger = await prisma.ledgerEntry.findFirst({ where: { paymentId: s.balancePaymentId } })
    expect(ledger?.type).toBe('final_payment_paid')
    expect(notif.sendBalanceTransferVerifiedToCustomer).toHaveBeenCalledTimes(1)
  })

  it('sobre completed → también verifica (allowCompleted)', async () => {
    const s = await declaredBalance()
    await prisma.booking.update({ where: { id: s.bookingId }, data: { status: 'completed' } })
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await unwrap(confirmBankTransfer(s.balancePaymentId, s.remainingBalance))
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    expect(b.paymentStatus).toBe('fully_paid')
    expect(b.status).toBe('completed')
  })

  it('con TimeBlock solapando el turno futuro → confirma igual (no re-valida cupo)', async () => {
    const s = await declaredBalance()
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
    await prisma.booking.update({ where: { id: s.bookingId }, data: { holdExpiresAt: new Date(Date.now() - 3_600_000) } })
    const block = await prisma.timeBlock.create({
      data: { businessId: BT_VERIFY_BIZ, startDateTime: b.startDateTime, endDateTime: b.endDateTime, reason: 'ocupado' },
    })
    try {
      const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
      await unwrap(confirmBankTransfer(s.balancePaymentId, s.remainingBalance))
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })).paymentStatus).toBe('fully_paid')
    } finally {
      await prisma.timeBlock.delete({ where: { id: block.id } })
    }
  })

  it('amount > saldo → error; el guard de abono aprobado NO bloquea saldos', async () => {
    const s = await declaredBalance() // esta booking YA tiene el deposit approved
    const { confirmBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await expectActionError(confirmBankTransfer(s.balancePaymentId, s.remainingBalance + 1), 'excede')
  })
})

describe('rejectBankTransfer saldo', () => {
  it('rechaza el payment, NO cancela la reserva, manda el email de SALDO, y se puede re-declarar', async () => {
    const seeded = await seedConfirmedWithBalance()
    const { declareBalanceTransfer } = await import('@/server/actions/bank-transfer-public')
    await unwrap(declareBalanceTransfer(seeded.bookingId))
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    const notif = await import('@/lib/notifications')
    vi.mocked(notif.sendBalanceTransferRejectedToCustomer).mockClear()
    const { rejectBankTransfer } = await import('@/server/actions/bank-transfer-verify')
    await unwrap(rejectBankTransfer(p.id))
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: seeded.bookingId } })
    expect(b.status).toBe('confirmed') // NO cancelada
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('rejected')
    expect(notif.sendBalanceTransferRejectedToCustomer).toHaveBeenCalledTimes(1)
    await unwrap(declareBalanceTransfer(seeded.bookingId)) // reactiva
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('pending')
  })
})

describe('sweeps de bt-balance en cambios de estado', () => {
  // updateBookingStatus NO pasa por cancelBookingInTx (tx propia) — por eso se
  // testean AMBOS destinos acá, además del cancelBooking de más abajo.
  it.each(['no_show', 'cancelled'] as const)('updateBookingStatus → %s cancela el bt-balance pendiente', async (dest) => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { updateBookingStatus } = await import('@/server/actions/bookings')
    const res = await updateBookingStatus(seeded.bookingId, dest)
    expect(res.ok).toBe(true)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('cancelled')
  })

  it('updateBookingStatus → completed NO cancela el bt-balance (pagar post-cita es el punto)', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { updateBookingStatus } = await import('@/server/actions/bookings')
    const res = await updateBookingStatus(seeded.bookingId, 'completed')
    expect(res.ok).toBe(true)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('pending')
  })

  it('cancelBooking cancela el bt-balance pendiente', async () => {
    const seeded = await seedConfirmedWithBalance()
    await seedPendingBalance(seeded.bookingId, seeded.customerId, seeded.remainingBalance)
    const { cancelBooking } = await import('@/server/actions/bookings')
    const res = await cancelBooking(seeded.bookingId)
    expect(res.ok).toBe(true)
    const p = await prisma.payment.findFirstOrThrow({
      where: { bookingId: seeded.bookingId, providerPaymentId: btBalanceId(seeded.bookingId) },
    })
    expect(p.status).toBe('cancelled')
  })
})
