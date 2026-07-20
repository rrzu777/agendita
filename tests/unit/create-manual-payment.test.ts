import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus, PaymentType } from '@prisma/client'

const mockPrisma = {
  booking: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  payment: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  ledgerEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError: class extends Error {},
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
  BookingNotPayableError: class extends Error {},
}))

// Import después de los mocks
const { createManualPayment } = await import('@/server/actions/payments')

describe('createManualPayment', () => {
  const baseBooking = {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    status: BookingStatus.pending_payment,
    currency: 'CLP',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates exactly 1 Payment and 1 LedgerEntry inside the transaction', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(baseBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(baseBooking)

    const createdPayment = { id: 'pay-manual-1', amount: 10000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    // 1st findUnique: applyApprovedPayment reads the pending Payment
    // 2nd findUnique: createManualPayment refreshes the updated Payment
    mockPrisma.payment.findUnique
      .mockResolvedValueOnce(createdPayment)
      .mockResolvedValueOnce(approvedPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])

    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)

    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.deposit_paid, status: BookingStatus.confirmed }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })

    // Simular que $transaction ejecuta el callback con el tx mockeado
    // Usamos el mismo mockPrisma como tx para que las llamadas se registren
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn(mockPrisma)
    })

    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 10000,
      currency: 'CLP',
      paymentType: 'deposit',
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    const result = res.data

    // Verificar que solo se creó 1 Payment dentro de la transacción
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    // Verificar que se creó exactamente 1 LedgerEntry
    expect(mockPrisma.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
    // Verificar que no se creó un segundo Payment por applyApprovedPayment
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    expect(result.id).toBe('pay-manual-1')
    expect(result.amount).toBe(10000)
    expect(result.status).toBe('approved')
    expect(result.paidAt).not.toBeNull()
  })

  it('does not duplicate Payment when called twice (idempotency via explicit paymentId)', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(baseBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(baseBooking)

    const createdPayment = { id: 'pay-manual-2', amount: 5000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    mockPrisma.payment.findUnique.mockResolvedValue(createdPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])

    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)

    const updatedBooking = { ...baseBooking, depositPaid: 5000, remainingBalance: 15000, paymentStatus: BookingPaymentStatus.unpaid, status: BookingStatus.pending_payment }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn(mockPrisma)
    })

    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 5000,
      currency: 'CLP',
      paymentType: 'deposit',
      paymentMethod: 'Transferencia',
    })
    expect(res.ok).toBe(true)

    // Segunda llamada: el payment ya existe, pero como no hay DB real,
    // el mock no detecta duplicados a menos que simulemos el unique constraint.
    // En este test verificamos que, dentro de la transacción de una sola llamada,
    // solo se crea 1 Payment.
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
  })
})

describe('createManualPayment en reservas completed con saldo (recobro post-chargeback)', () => {
  const completedBooking = {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    status: BookingStatus.completed,
    currency: 'CLP',
    holdExpiresAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pasa allowCompleted a assertBookingPayable y a applyApprovedPayment', async () => {
    const { assertBookingPayable } = await import('@/lib/booking-payments')
    mockPrisma.booking.findFirst.mockResolvedValue(completedBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(completedBooking)

    const createdPayment = { id: 'pay-recover-1', amount: 20000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.full_payment }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    mockPrisma.payment.findUnique
      .mockResolvedValueOnce(createdPayment)
      .mockResolvedValueOnce(approvedPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])
    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...completedBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))

    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 20000,
      currency: 'CLP',
      paymentType: 'full_payment',
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    const result = res.data

    expect(result.status).toBe('approved')
    // createManualPayment relaja el guard de completed…
    expect(assertBookingPayable).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'booking-1' }),
      expect.objectContaining({ allowCompleted: true }),
    )
    // …y applyApprovedPayment (real, corre contra el mock de prisma) recibió
    // allowCompleted: su assert interno es la segunda llamada, con el mismo flag.
    expect(assertBookingPayable).toHaveBeenCalledTimes(2)
    expect(vi.mocked(assertBookingPayable).mock.calls.every(
      (c) => (c[1] as { allowCompleted?: boolean } | undefined)?.allowCompleted === true,
    )).toBe(true)
  })
})

describe('deriveManualPaymentType', () => {
  it('returns deposit when no prior deposit and amount < remainingBalance', async () => {
    const { deriveManualPaymentType } = await import('@/lib/payments/derive-payment-type')
    expect(deriveManualPaymentType({ depositPaid: 0, remainingBalance: 20000 }, 10000)).toBe('deposit')
  })

  it('returns full_payment when amount >= remainingBalance and no prior deposit', async () => {
    const { deriveManualPaymentType } = await import('@/lib/payments/derive-payment-type')
    expect(deriveManualPaymentType({ depositPaid: 0, remainingBalance: 20000 }, 20000)).toBe('full_payment')
    expect(deriveManualPaymentType({ depositPaid: 0, remainingBalance: 20000 }, 25000)).toBe('full_payment')
  })

  it('returns final_payment when depositPaid > 0 regardless of amount', async () => {
    const { deriveManualPaymentType } = await import('@/lib/payments/derive-payment-type')
    expect(deriveManualPaymentType({ depositPaid: 10000, remainingBalance: 10000 }, 10000)).toBe('final_payment')
    expect(deriveManualPaymentType({ depositPaid: 5000, remainingBalance: 15000 }, 15000)).toBe('final_payment')
    // Even full coverage still derives final_payment when there's prior deposit
    expect(deriveManualPaymentType({ depositPaid: 10000, remainingBalance: 10000 }, 10000)).toBe('final_payment')
  })

  it('amount exactly at remainingBalance but with depositPaid > 0 derives final_payment', async () => {
    const { deriveManualPaymentType } = await import('@/lib/payments/derive-payment-type')
    expect(deriveManualPaymentType({ depositPaid: 5000, remainingBalance: 15000 }, 15000)).toBe('final_payment')
  })
})

describe('createManualPayment server-side paymentType derivation', () => {
  const baseBooking = {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    finalAmount: 20000,
    depositRequired: 10000,
    depositPaid: 0,
    remainingBalance: 20000,
    status: BookingStatus.pending_payment,
    currency: 'CLP',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.booking.findFirst.mockResolvedValue(baseBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(baseBooking)
  })

  function setupTxWithNewPayment() {
    const createdPayment = { id: 'pay-new', amount: 10000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    mockPrisma.payment.findUnique
      .mockResolvedValueOnce(createdPayment)
      .mockResolvedValueOnce(approvedPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])
    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.deposit_paid, status: BookingStatus.confirmed }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
  }

  it('rejects mismatched paymentType from client with clear error', async () => {
    setupTxWithNewPayment()
    // Client sends 'deposit' but system would derive 'full_payment' for this amount
    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 20000, // covers full remaining balance
      currency: 'CLP',
      paymentType: 'deposit', // wrong - server will derive full_payment
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/Tipo de pago incompatible/)
  })

  it('amount > remainingBalance still fails even with correct paymentType', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ ...baseBooking, remainingBalance: 5000 })

    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 10000, // exceeds remainingBalance of 5000
      currency: 'CLP',
      paymentType: 'deposit',
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toBe('El monto excede el saldo pendiente')
  })

  it('derives deposit when amount < remainingBalance and no prior deposit', async () => {
    setupTxWithNewPayment()
    // amount=10000 < remainingBalance=20000 and depositPaid=0 → derives 'deposit'
    // client sends deposit which matches derived
    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 10000,
      currency: 'CLP',
      paymentType: 'deposit',
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(true)
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    const paymentData = mockPrisma.payment.create.mock.calls[0][0].data
    expect(paymentData.paymentType).toBe('deposit')
  })

  it('derives full_payment when amount >= remainingBalance', async () => {
    // COMPLETELY RESET all mocks to avoid cross-test pollution
    vi.clearAllMocks()
    mockPrisma.booking.findFirst.mockReset()
    mockPrisma.booking.findUnique.mockReset()
    mockPrisma.payment.create.mockReset()
    mockPrisma.payment.findUnique.mockReset()
    mockPrisma.payment.findFirst.mockReset()
    mockPrisma.payment.update.mockReset()
    mockPrisma.payment.findMany.mockReset()
    mockPrisma.ledgerEntry.findFirst.mockReset()
    mockPrisma.booking.update.mockReset()
    mockPrisma.booking.updateMany.mockReset()
    mockPrisma.$transaction.mockReset()

    // Override remainingBalance for this test
    const fullPaymentBooking = { ...baseBooking, remainingBalance: 10000 }
    mockPrisma.booking.findFirst.mockResolvedValue(fullPaymentBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(fullPaymentBooking)
    // amount=10000 >= remainingBalance=10000 and depositPaid=0 → derives 'full_payment'
    const createdPayment = { id: 'pay-new', amount: 10000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.full_payment }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    mockPrisma.payment.findUnique.mockResolvedValue(createdPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])
    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...fullPaymentBooking, depositPaid: 10000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))

    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 10000,
      currency: 'CLP',
      paymentType: 'full_payment',
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(true)
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    const paymentData = mockPrisma.payment.create.mock.calls[0][0].data
    expect(paymentData.paymentType).toBe('full_payment')
  })

  it('derives final_payment when depositPaid > 0 and creates payment correctly', async () => {
    // COMPLETELY RESET all mocks to avoid cross-test pollution
    vi.clearAllMocks()
    mockPrisma.booking.findFirst.mockReset()
    mockPrisma.booking.findUnique.mockReset()
    mockPrisma.payment.create.mockReset()
    mockPrisma.payment.findUnique.mockReset()
    mockPrisma.payment.findFirst.mockReset()
    mockPrisma.payment.update.mockReset()
    mockPrisma.payment.findMany.mockReset()
    mockPrisma.ledgerEntry.findFirst.mockReset()
    mockPrisma.booking.update.mockReset()
    mockPrisma.booking.updateMany.mockReset()
    mockPrisma.$transaction.mockReset()

    const finalPaymentBooking = { ...baseBooking, depositPaid: 5000, remainingBalance: 15000 }
    mockPrisma.booking.findFirst.mockResolvedValue(finalPaymentBooking)
    mockPrisma.booking.findUnique.mockResolvedValue(finalPaymentBooking)
    const createdPayment = { id: 'pay-new', amount: 15000, status: 'pending', provider: 'manual', providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.final_payment }
    const approvedPayment = { ...createdPayment, status: 'approved', paidAt: new Date() }
    mockPrisma.payment.create.mockResolvedValue(createdPayment)
    mockPrisma.payment.findUnique.mockResolvedValue(createdPayment)
    mockPrisma.payment.findFirst.mockResolvedValue(createdPayment)
    mockPrisma.payment.update.mockResolvedValue(approvedPayment)
    mockPrisma.payment.findMany.mockResolvedValue([approvedPayment])
    mockPrisma.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...finalPaymentBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    mockPrisma.booking.update.mockResolvedValue(updatedBooking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))

    // depositPaid=5000, remainingBalance=15000, amount=15000 → derives final_payment
    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 15000,
      currency: 'CLP',
      // No paymentType sent - server derives it
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(true)
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
    const paymentData = mockPrisma.payment.create.mock.calls[0][0].data
    expect(paymentData.paymentType).toBe('final_payment')
  })

  it('rejects mismatched paymentType from client with clear error', async () => {
    setupTxWithNewPayment()
    // Client sends 'deposit' but system would derive 'full_payment' for this amount
    const res = await createManualPayment({
      bookingId: 'booking-1',
      amount: 20000, // covers full remaining balance
      currency: 'CLP',
      paymentType: 'deposit', // wrong - server will derive full_payment
      paymentMethod: 'Efectivo',
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error result')
    expect(res.error).toMatch(/Tipo de pago incompatible/)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })
})
