import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'

const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  ledgerEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
  BookingNotPayableError: class extends Error {},
}))

const { applyApprovedPayment } = await import('@/server/services/finance')

describe('applyApprovedPayment', () => {
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
    holdExpiresAt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupTx() {
    return {
      ...mockPrisma,
      booking: { ...mockPrisma.booking },
      payment: { ...mockPrisma.payment },
      ledgerEntry: { ...mockPrisma.ledgerEntry },
    }
  }

  it('rejects amount <= 0', async () => {
    const tx = setupTx()
    await expect(
      applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 0,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
      })
    ).rejects.toThrow('El monto debe ser positivo')
  })

  it('rejects booking not found', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(null)
    await expect(
      applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 5000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
      })
    ).rejects.toThrow('Reserva no encontrada')
  })

  it('rejects booking from different business', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, businessId: 'biz-2' })
    await expect(
      applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 5000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
      })
    ).rejects.toThrow('La reserva no pertenece al negocio')
  })

  it('creates 1 Payment and 1 LedgerEntry for a deposit', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    tx.payment.findFirst.mockResolvedValue(null)
    const createdPayment = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValue(createdPayment)
    tx.payment.findMany.mockResolvedValue([createdPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 5000, remainingBalance: 15000, paymentStatus: BookingPaymentStatus.unpaid }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 5000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
    expect(result.depositPaid).toBe(5000)
    expect(result.remainingBalance).toBe(15000)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(result.status).toBe(BookingStatus.pending_payment)
  })

  it('accumulates partial payments and updates status to confirmed when depositRequired is met', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 5000, remainingBalance: 15000 })
    tx.payment.findFirst.mockResolvedValue(null)
    const newPayment = { id: 'pay-2', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValue(newPayment)
    tx.payment.findMany.mockResolvedValue([existingPayment, newPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.deposit_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 5000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
    expect(result.depositPaid).toBe(10000)
    expect(result.remainingBalance).toBe(10000)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    expect(result.status).toBe(BookingStatus.confirmed)
  })

  it('final payment leaves remainingBalance 0 and fully_paid', async () => {
    const tx = setupTx()
    const existingPayments = [
      { id: 'pay-1', amount: 10000, status: 'approved' },
    ]
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000, status: BookingStatus.confirmed })
    tx.payment.findFirst.mockResolvedValue(null)
    const newPayment = { id: 'pay-2', amount: 10000, status: 'approved' }
    tx.payment.create.mockResolvedValue(newPayment)
    tx.payment.findMany.mockResolvedValue([...existingPayments, newPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.final_payment,
    })

    expect(result.remainingBalance).toBe(0)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
  })

  it('does not duplicate Payment or LedgerEntry for same providerPaymentId', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 10000, status: 'approved', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-123' }
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000 })
    tx.payment.findFirst.mockResolvedValue(existingPayment)
    tx.payment.findMany.mockResolvedValue([existingPayment])
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000 }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      currency: 'CLP',
      provider: PaymentProvider.mercado_pago,
      providerPaymentId: 'mp-123',
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(tx.payment.update).not.toHaveBeenCalled()
    expect(result.depositPaid).toBe(10000)
  })

  it('approves existing pending Payment and creates LedgerEntry if not exists', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 10000, status: 'pending', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-123' }
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    tx.payment.findFirst.mockResolvedValue(existingPayment)
    const updatedPayment = { ...existingPayment, status: 'approved' }
    tx.payment.update.mockResolvedValue(updatedPayment)
    tx.payment.findMany.mockResolvedValue([updatedPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000, paymentStatus: BookingPaymentStatus.deposit_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      currency: 'CLP',
      provider: PaymentProvider.mercado_pago,
      providerPaymentId: 'mp-123',
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.update).toHaveBeenCalledTimes(1)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
    expect(result.depositPaid).toBe(10000)
  })

  it('manual payment updates correctly', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    tx.payment.findFirst.mockResolvedValue(null)
    const createdPayment = { id: 'pay-manual', amount: 20000, status: 'approved' }
    tx.payment.create.mockResolvedValue(createdPayment)
    tx.payment.findMany.mockResolvedValue([createdPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 20000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.full_payment,
      paymentMethod: 'Efectivo',
    })

    expect(result.depositPaid).toBe(20000)
    expect(result.remainingBalance).toBe(0)
    expect(result.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
  })

  it('creates two distinct Payments for two manual calls without paymentId', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    // Primera llamada: no hay Payment previo
    tx.payment.findFirst.mockResolvedValueOnce(null)
    const createdPayment1 = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValueOnce(createdPayment1)
    tx.payment.findMany.mockResolvedValueOnce([createdPayment1])
    tx.ledgerEntry.findFirst.mockResolvedValueOnce(null)
    const updatedBooking1 = { ...baseBooking, depositPaid: 5000, remainingBalance: 15000, paymentStatus: BookingPaymentStatus.unpaid }
    tx.booking.update.mockResolvedValueOnce(updatedBooking1)

    await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 5000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    // Segunda llamada: aún sin paymentId, no debe reutilizar el anterior
    tx.payment.findFirst.mockResolvedValueOnce(null)
    const createdPayment2 = { id: 'pay-2', amount: 3000, status: 'approved' }
    tx.payment.create.mockResolvedValueOnce(createdPayment2)
    tx.payment.findMany.mockResolvedValueOnce([createdPayment1, createdPayment2])
    tx.ledgerEntry.findFirst.mockResolvedValueOnce(null)
    const updatedBooking2 = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
    tx.booking.update.mockResolvedValueOnce(updatedBooking2)

    const result = await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 3000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.deposit,
    })

    expect(tx.payment.create).toHaveBeenCalledTimes(2)
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(2)
    expect(result.depositPaid).toBe(8000)
    expect(result.remainingBalance).toBe(12000)
  })

  describe('with explicit paymentId', () => {
    it('reuses existing Payment and does not create a new one', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1' }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      const updatedPayment = { ...existingPayment, status: 'approved' }
      tx.payment.update.mockResolvedValue(updatedPayment)
      tx.payment.findMany.mockResolvedValue([updatedPayment])
      tx.ledgerEntry.findFirst.mockResolvedValue(null)
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid, status: BookingStatus.pending_payment }
      tx.booking.update.mockResolvedValue(updatedBooking)

      const result = await applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 8000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentId: 'pay-explicit',
      })

      expect(tx.payment.create).not.toHaveBeenCalled()
      expect(tx.payment.update).toHaveBeenCalledTimes(1)
      expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(1)
      expect(result.depositPaid).toBe(8000)
      expect(result.remainingBalance).toBe(12000)
    })

    it('is idempotent when Payment is already approved', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'approved', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1' }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      tx.payment.findMany.mockResolvedValue([existingPayment])
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
      tx.booking.update.mockResolvedValue(updatedBooking)

      const result = await applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 8000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentId: 'pay-explicit',
      })

      expect(tx.payment.create).not.toHaveBeenCalled()
      expect(tx.payment.update).not.toHaveBeenCalled()
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
      expect(result.depositPaid).toBe(8000)
    })

    it('does not duplicate LedgerEntry when called twice with same paymentId', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'approved', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1' }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      tx.payment.findMany.mockResolvedValue([existingPayment])
      tx.ledgerEntry.findFirst.mockResolvedValue({ id: 'ledger-1' }) // ya existe
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
      tx.booking.update.mockResolvedValue(updatedBooking)

      const result = await applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 8000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentId: 'pay-explicit',
      })

      expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
      expect(result.depositPaid).toBe(8000)
    })
  })
})
