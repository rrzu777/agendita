import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, BookingPaymentStatus, PaymentProvider, PaymentType } from '@prisma/client'

const mockPrisma = {
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  payment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  ledgerEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  packagePurchase: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  plan: {},
  user: {},
  business: {},
  businessUser: {},
  businessSubscription: {},
  subscriptionPayment: {},
  subscriptionLog: {},
  service: {},
  availabilityRule: {},
  timeBlock: {},
  customer: {},
  review: {},
  galleryImage: {},
} as any

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
  BookingNotPayableError: class extends Error {},
}))

const activatePkg = vi.hoisted(() => vi.fn())
vi.mock('@/lib/packages/activate', () => ({ activatePackagePurchaseInTx: activatePkg }))

const { applyApprovedPayment } = await import('@/server/services/finance')

describe('mapPaymentTypeToLedgerEntryType', () => {
  it('deposit → deposit_paid', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.deposit)).toBe('deposit_paid')
  })

  it('final_payment → final_payment_paid', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.final_payment)).toBe('final_payment_paid')
  })

  it('full_payment → full_payment_paid', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.full_payment)).toBe('full_payment_paid')
  })

  it('refund → refund_issued', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.refund)).toBe('refund_issued')
  })

  it('cancellation_fee → cancellation_fee_charged', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.cancellation_fee)).toBe('cancellation_fee_charged')
  })

  it('manual_adjustment → adjustment', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.manual_adjustment)).toBe('adjustment')
  })

  it('package_purchase → package_sale', async () => {
    const { mapPaymentTypeToLedgerEntryType } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerEntryType(PaymentType.package_purchase)).toBe('package_sale')
  })
})

describe('mapPaymentTypeToLedgerDirection', () => {
  it('refund → expense', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.refund)).toBe('expense')
  })

  it('deposit → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.deposit)).toBe('income')
  })

  it('final_payment → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.final_payment)).toBe('income')
  })

  it('full_payment → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.full_payment)).toBe('income')
  })

  it('cancellation_fee → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.cancellation_fee)).toBe('income')
  })

  it('manual_adjustment → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.manual_adjustment)).toBe('income')
  })

  it('package_purchase → income', async () => {
    const { mapPaymentTypeToLedgerDirection } = await import('@/server/services/finance')
    expect(mapPaymentTypeToLedgerDirection(PaymentType.package_purchase)).toBe('income')
  })
})

describe('getLedgerDescription', () => {
  it('deposit → Abono para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.deposit, 'booking-abc123', 4738)).toBe('Abono para reserva #4738')
  })

  it('final_payment → Pago final para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.final_payment, 'booking-abc123', 4738)).toBe('Pago final para reserva #4738')
  })

  it('full_payment → Pago total para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.full_payment, 'booking-abc123', 4738)).toBe('Pago total para reserva #4738')
  })

  it('refund → Reembolso para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.refund, 'booking-abc123', 4738)).toBe('Reembolso para reserva #4738')
  })

  it('cancellation_fee → Cargo por cancelación para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.cancellation_fee, 'booking-abc123', 4738)).toBe('Cargo por cancelación para reserva #4738')
  })

  it('manual_adjustment → Ajuste manual para reserva #<n>', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.manual_adjustment, 'booking-abc123', 4738)).toBe('Ajuste manual para reserva #4738')
  })

  it('package_purchase → Venta de paquete', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.package_purchase, 'booking-abc123', 4738)).toBe('Venta de paquete')
  })

  it('falls back to the cuid slice when bookingNumber is null', async () => {
    const { getLedgerDescription } = await import('@/server/services/finance')
    expect(getLedgerDescription(PaymentType.deposit, 'booking-abc123', null)).toBe('Abono para reserva #booking-')
  })
})

describe('applyApprovedPayment', () => {
  const baseBooking = {
    id: 'booking-1',
    bookingNumber: 4242,
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
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
    expect(result.booking.depositPaid).toBe(5000)
    expect(result.booking.remainingBalance).toBe(15000)
    expect(result.booking.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(result.booking.status).toBe(BookingStatus.pending_payment)
    expect(result.wasConfirmed).toBe(false)
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
    tx.booking.updateMany.mockResolvedValue({ count: 1 })
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
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
    expect(result.booking.depositPaid).toBe(10000)
    expect(result.booking.remainingBalance).toBe(10000)
    expect(result.booking.paymentStatus).toBe(BookingPaymentStatus.deposit_paid)
    expect(result.booking.status).toBe(BookingStatus.confirmed)
    expect(result.wasConfirmed).toBe(true)
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

    expect(result.booking.remainingBalance).toBe(0)
    expect(result.booking.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(result.wasConfirmed).toBe(false)
  })

  it('final_payment after deposit creates ledger type final_payment_paid', async () => {
    const tx = setupTx()
    const existingPayments = [
      { id: 'pay-1', amount: 10000, status: 'approved' },
    ]
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000, status: BookingStatus.confirmed })
    tx.payment.findFirst.mockResolvedValue(null)
    const newPayment = { id: 'pay-2', amount: 10000, status: 'approved', paymentType: PaymentType.final_payment }
    tx.payment.create.mockResolvedValue(newPayment)
    tx.payment.findMany.mockResolvedValue([...existingPayments, newPayment])
    tx.ledgerEntry.findFirst.mockResolvedValue(null)
    const updatedBooking = { ...baseBooking, depositPaid: 20000, remainingBalance: 0, paymentStatus: BookingPaymentStatus.fully_paid, status: BookingStatus.confirmed }
    tx.booking.update.mockResolvedValue(updatedBooking)

    await applyApprovedPayment({
      tx,
      bookingId: 'booking-1',
      businessId: 'biz-1',
      amount: 10000,
      currency: 'CLP',
      provider: PaymentProvider.manual,
      providerPaymentId: null,
      paymentType: PaymentType.final_payment,
    })

    // Verify ledger was created with final_payment_paid type, not full_payment_paid
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
    const ledgerData = tx.ledgerEntry.upsert.mock.calls[0][0].create
    expect(ledgerData.type).toBe('final_payment_paid')
    expect(ledgerData.direction).toBe('income')
    expect(ledgerData.description).toBe('Pago final para reserva #4242')
  })

  it('does not duplicate Payment or LedgerEntry for same providerPaymentId', async () => {
    const tx = setupTx()
    const existingPayment = { id: 'pay-1', amount: 10000, status: 'approved', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-123' }
    tx.booking.findUnique.mockResolvedValue({ ...baseBooking, depositPaid: 10000, remainingBalance: 10000 })
    tx.payment.findFirst.mockResolvedValue(existingPayment)
    tx.payment.findMany.mockResolvedValue([existingPayment])
    const updatedBooking = { ...baseBooking, depositPaid: 10000, remainingBalance: 10000 }
    tx.booking.updateMany.mockResolvedValue({ count: 1 })
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
    expect(tx.ledgerEntry.upsert).not.toHaveBeenCalled()
    expect(tx.payment.update).not.toHaveBeenCalled()
    expect(result.booking.depositPaid).toBe(10000)
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
    tx.booking.updateMany.mockResolvedValue({ count: 1 })
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
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
    expect(result.booking.depositPaid).toBe(10000)
    expect(result.wasConfirmed).toBe(true)
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
    tx.booking.updateMany.mockResolvedValue({ count: 1 })
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

    expect(result.booking.depositPaid).toBe(20000)
    expect(result.booking.remainingBalance).toBe(0)
    expect(result.booking.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(result.wasConfirmed).toBe(true)
  })

  it('creates two distinct Payments for two manual calls without paymentId', async () => {
    const tx = setupTx()
    tx.booking.findUnique.mockResolvedValue(baseBooking)
    // Primera llamada: no hay Payment previo
    tx.payment.findFirst.mockResolvedValueOnce(null)
    const createdPayment1 = { id: 'pay-1', amount: 5000, status: 'approved' }
    tx.payment.create.mockResolvedValueOnce(createdPayment1)
    tx.payment.findMany.mockResolvedValueOnce([createdPayment1]).mockResolvedValueOnce([createdPayment1])
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
    tx.payment.findMany.mockResolvedValueOnce([createdPayment1, createdPayment2]).mockResolvedValueOnce([createdPayment1, createdPayment2])
    tx.ledgerEntry.findFirst.mockResolvedValueOnce(null)
    const updatedBooking2 = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
    tx.booking.updateMany.mockResolvedValue({ count: 0 })
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
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(2)
    expect(result.booking.depositPaid).toBe(8000)
    expect(result.booking.remainingBalance).toBe(12000)
  })

  describe('with explicit paymentId', () => {
    it('reuses existing Payment and does not create a new one', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      const updatedPayment = { ...existingPayment, status: 'approved' }
      tx.payment.update.mockResolvedValue(updatedPayment)
      tx.payment.findMany.mockResolvedValue([updatedPayment])
      tx.ledgerEntry.findFirst.mockResolvedValue(null)
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid, status: BookingStatus.pending_payment }
      tx.booking.updateMany.mockResolvedValue({ count: 0 })
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
      expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
      expect(result.booking.depositPaid).toBe(8000)
      expect(result.booking.remainingBalance).toBe(12000)
    })

    it('is idempotent when Payment is already approved', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'approved', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      tx.payment.findMany.mockResolvedValue([existingPayment])
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
      tx.booking.updateMany.mockResolvedValue({ count: 0 })
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
      expect(tx.ledgerEntry.upsert).not.toHaveBeenCalled()
      expect(result.booking.depositPaid).toBe(8000)
    })

    it('does not duplicate LedgerEntry when called twice with same paymentId', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'approved', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      tx.payment.findMany.mockResolvedValue([existingPayment])
      tx.ledgerEntry.findFirst.mockResolvedValue({ id: 'ledger-1' }) // ya existe
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid }
      tx.booking.updateMany.mockResolvedValue({ count: 0 })
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

      expect(tx.ledgerEntry.upsert).not.toHaveBeenCalled()
      expect(result.booking.depositPaid).toBe(8000)
    })

    it('throws when explicit paymentId not found', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(null)

      await expect(
        applyApprovedPayment({
          tx,
          bookingId: 'booking-1',
          businessId: 'biz-1',
          amount: 8000,
          currency: 'CLP',
          provider: PaymentProvider.manual,
          providerPaymentId: null,
          paymentType: PaymentType.deposit,
          paymentId: 'nonexistent',
        })
      ).rejects.toThrow('Pago no encontrado')
    })

    it('throws when explicit payment belongs to different booking', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-other', businessId: 'biz-1' }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
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
      ).rejects.toThrow('El pago no corresponde a esta reserva')
    })

    it('throws when explicit payment belongs to different business', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-other' }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
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
      ).rejects.toThrow('El pago no pertenece al negocio')
    })

    it('throws when explicit payment amount does not match', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 5000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1' }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
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
      ).rejects.toThrow('El monto no coincide con el pago registrado')
    })

    it('throws when explicit payment provider does not match', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-123', bookingId: 'booking-1', businessId: 'biz-1' }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
          tx,
          bookingId: 'booking-1',
          businessId: 'biz-1',
          amount: 8000,
          currency: 'CLP',
          provider: PaymentProvider.manual,
          providerPaymentId: 'mp-123',
          paymentType: PaymentType.deposit,
          paymentId: 'pay-explicit',
        })
      ).rejects.toThrow('El proveedor no coincide con el pago registrado')
    })

    it('throws when explicit payment providerPaymentId does not match', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: 'wrong-id', bookingId: 'booking-1', businessId: 'biz-1' }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
          tx,
          bookingId: 'booking-1',
          businessId: 'biz-1',
          amount: 8000,
          currency: 'CLP',
          provider: PaymentProvider.manual,
          providerPaymentId: 'mp-123',
          paymentType: PaymentType.deposit,
          paymentId: 'pay-explicit',
        })
      ).rejects.toThrow('El providerPaymentId no coincide con el pago registrado')
    })

    it('with paymentType final_payment creates LedgerEntry final_payment_paid', async () => {
      const tx = setupTx()
      const existingPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.final_payment }
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      tx.payment.findUnique.mockResolvedValue(existingPayment)
      const updatedPayment = { ...existingPayment, status: 'approved' }
      tx.payment.update.mockResolvedValue(updatedPayment)
      tx.payment.findMany.mockResolvedValue([updatedPayment])
      tx.ledgerEntry.findFirst.mockResolvedValue(null)
      const updatedBooking = { ...baseBooking, depositPaid: 8000, remainingBalance: 12000, paymentStatus: BookingPaymentStatus.unpaid, status: BookingStatus.pending_payment }
      tx.booking.updateMany.mockResolvedValue({ count: 0 })
      tx.booking.update.mockResolvedValue(updatedBooking)

      await applyApprovedPayment({
        tx,
        bookingId: 'booking-1',
        businessId: 'biz-1',
        amount: 8000,
        currency: 'CLP',
        provider: PaymentProvider.manual,
        providerPaymentId: null,
        paymentType: PaymentType.final_payment,
        paymentId: 'pay-explicit',
      })

      expect(tx.ledgerEntry.upsert).toHaveBeenCalledTimes(1)
      const ledgerData = tx.ledgerEntry.upsert.mock.calls[0][0].create
      expect(ledgerData.type).toBe('final_payment_paid')
      expect(ledgerData.direction).toBe('income')
      expect(ledgerData.description).toBe('Pago final para reserva #4242')
    })

    it('throws when explicit payment paymentType does not match', async () => {
      const tx = setupTx()
      tx.booking.findUnique.mockResolvedValue(baseBooking)
      const wrongPayment = { id: 'pay-explicit', amount: 8000, status: 'pending', provider: PaymentProvider.manual, providerPaymentId: null, bookingId: 'booking-1', businessId: 'biz-1', paymentType: PaymentType.deposit }
      tx.payment.findUnique.mockResolvedValue(wrongPayment)

      await expect(
        applyApprovedPayment({
          tx,
          bookingId: 'booking-1',
          businessId: 'biz-1',
          amount: 8000,
          currency: 'CLP',
          provider: PaymentProvider.manual,
          providerPaymentId: null,
          paymentType: PaymentType.final_payment,
          paymentId: 'pay-explicit',
        })
      ).rejects.toThrow('El tipo de pago no coincide con el pago registrado')
    })
  })
})

describe('applyApprovedPackagePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activatePkg.mockReset().mockResolvedValue(undefined)
    Object.values(mockPrisma.payment).forEach((f: any) => f.mockReset?.())
    mockPrisma.packagePurchase = { findUnique: vi.fn(), update: vi.fn() }
  })

  it('activa la compra pending y NO toca booking', async () => {
    const { applyApprovedPackagePayment } = await import('@/server/services/finance')
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({
      id: 'p1', businessId: 'b1', customerId: 'c1', status: 'pending',
      pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: null,
    })
    mockPrisma.payment.findFirst.mockResolvedValue(null)
    mockPrisma.payment.create.mockResolvedValue({ id: 'pay1', status: 'approved', paymentType: 'package_purchase', amount: 30000 })

    await applyApprovedPackagePayment({
      tx: mockPrisma, packagePurchaseId: 'p1', businessId: 'b1', amount: 30000,
      currency: 'CLP', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-1',
      paymentType: PaymentType.package_purchase,
    })

    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()
    // El Payment se crea polimórfico: packagePurchaseId seteado, bookingId null.
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        packagePurchaseId: 'p1', bookingId: null, customerId: 'c1',
        businessId: 'b1', paymentType: 'package_purchase', status: 'approved',
      }),
    }))
    expect(activatePkg).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ requestId: 'p1', paymentId: 'pay1' }),
    )
  })

  it('corta por status active aunque el pago aún no esté aprobado (cubre la cláusula || active)', async () => {
    const { applyApprovedPackagePayment } = await import('@/server/services/finance')
    // Compra ya active, pero NO hay pago aprobado previo (findFirst → null,
    // create devuelve un pago recién aprobado) → alreadyApproved es false, así
    // que el early-return depende ÚNICAMENTE de purchase.status === 'active'.
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', status: 'active', pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: null })
    mockPrisma.payment.findFirst.mockResolvedValue(null)
    mockPrisma.payment.create.mockResolvedValue({ id: 'pay1', status: 'approved', paymentType: 'package_purchase', amount: 30000 })

    await applyApprovedPackagePayment({
      tx: mockPrisma, packagePurchaseId: 'p1', businessId: 'b1', amount: 30000,
      currency: 'CLP', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-1',
      paymentType: PaymentType.package_purchase,
    })
    expect(activatePkg).not.toHaveBeenCalled()
  })

  it('es idempotente: compra ya active no re-activa', async () => {
    const { applyApprovedPackagePayment } = await import('@/server/services/finance')
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({ id: 'p1', businessId: 'b1', customerId: 'c1', status: 'active', pricePaid: 30000, quantity: 3, bonusQuantity: 0, expiresAt: null, createdByUserId: null })
    mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay1', status: 'approved', paymentType: 'package_purchase', amount: 30000 })

    await applyApprovedPackagePayment({
      tx: mockPrisma, packagePurchaseId: 'p1', businessId: 'b1', amount: 30000,
      currency: 'CLP', provider: PaymentProvider.mercado_pago, providerPaymentId: 'mp-1',
      paymentType: PaymentType.package_purchase,
    })
    expect(activatePkg).not.toHaveBeenCalled()
  })
})
