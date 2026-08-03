import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { BookingPaymentStatus, BookingStatus, PaymentType } from '@prisma/client'
import { UserError } from '@/lib/actions/result'

const mockApplyApprovedPayment = vi.fn()
const mockAssertSlotAndResolveProfessional = vi.fn()
const mockAssertProfessionalOffersService = vi.fn()

const mockPrisma = {
  service: { findFirst: vi.fn() },
  booking: { create: vi.fn(), update: vi.fn() },
  customer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  payment: { create: vi.fn() },
  promotion: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  promotionGrant: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  promotionRedemption: { count: vi.fn(), create: vi.fn() },
  business: { update: vi.fn().mockResolvedValue({ bookingNumberSeq: 4242 }) },
  $executeRaw: vi.fn().mockResolvedValue(0),
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({
    businessId: 'biz-1',
    user: { id: 'user-1' },
    business: { timezone: 'America/Santiago', currency: 'CLP' },
  }),
  ForbiddenError,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

// El camino del dashboard valida el slot Y resuelve la persona en el mismo
// helper del flujo público. Mockear el módulo entero (y no las dos mitades de
// validation) evita la trampa documentada de mockear una sola mitad.
vi.mock('@/lib/professionals/assign', () => ({
  assertSlotAndResolveProfessional: (...args: unknown[]) => mockAssertSlotAndResolveProfessional(...args),
}))

vi.mock('@/lib/professionals/ownership', () => ({
  assertProfessionalOffersService: (...args: unknown[]) => mockAssertProfessionalOffersService(...args),
  activeProfessionalWhere: (businessId: string) => ({ businessId, isActive: true }),
}))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: (...args: unknown[]) => mockApplyApprovedPayment(...args),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn(),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

const { createBookingFromDashboard } = await import('@/server/actions/bookings')

const businessId = 'biz-1'
const baseInput = {
  serviceId: 'svc-1',
  customerName: 'Maria Perez',
  customerPhone: '+56 9 1234 5678',
  customerEmail: 'maria@test.com',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
}

function setupTx() {
  mockPrisma.$transaction.mockImplementation(async (fn) => fn({
    $executeRaw: mockPrisma.$executeRaw,
    customer: mockPrisma.customer,
    booking: mockPrisma.booking,
    payment: mockPrisma.payment,
    promotion: mockPrisma.promotion,
    promotionGrant: mockPrisma.promotionGrant,
    promotionRedemption: mockPrisma.promotionRedemption,
    business: mockPrisma.business,
  }))
}

/** Mocks tx so applyPromotionInTx resolves a redeemable promo. */
function setupPromo(overrides: Record<string, unknown> = {}) {
  mockPrisma.promotion.findFirst.mockResolvedValue({
    id: 'p1',
    code: 'V20',
    triggerType: 'code',
    isActive: true,
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    maxPerCustomer: null,
    minSpend: null,
    appliesToAll: true,
    rewardType: 'percentage',
    rewardValue: 20,
    maxDiscount: null,
    redemptionCount: 0,
    services: [],
    ...overrides,
  })
  mockPrisma.promotion.update.mockResolvedValue({})
  mockPrisma.promotion.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.promotionRedemption.count.mockResolvedValue(0)
  mockPrisma.promotionRedemption.create.mockResolvedValue({ id: 'red-1' })
  mockPrisma.booking.update.mockResolvedValue({
    id: 'booking-1',
    businessId,
    service: { name: 'Manicure' },
    customer: { name: 'Maria Perez', phone: '56912345678', email: 'maria@test.com' },
  })
}

function setupService(price: number, depositAmount: number) {
  mockPrisma.service.findFirst.mockResolvedValue({
    id: 'svc-1',
    businessId,
    name: 'Manicure',
    price,
    depositAmount,
    durationMinutes: 60,
    modalities: ['on_site'],
    isActive: true,
  })
}

function setupCustomer(customer = { id: 'cust-1', businessId, name: 'Maria Perez', phone: '56912345678', email: null }) {
  mockPrisma.customer.findFirst.mockResolvedValue(customer)
  mockPrisma.customer.create.mockResolvedValue(customer)
  mockPrisma.customer.update.mockResolvedValue({ ...customer, email: 'maria@test.com' })
}

function setupBooking() {
  mockPrisma.booking.create.mockResolvedValue({
    id: 'booking-1',
    businessId,
    customerId: 'cust-1',
    service: { name: 'Manicure' },
    customer: { name: 'Maria Perez', phone: '56912345678', email: 'maria@test.com' },
  })
}

describe('createBookingFromDashboard advanced payment modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupService(20000, 5000)
    setupCustomer()
    setupBooking()
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-1' })
    mockApplyApprovedPayment.mockResolvedValue({ booking: { id: 'booking-1' }, wasConfirmed: true })
    mockAssertSlotAndResolveProfessional.mockResolvedValue(null)
  })

  it('paymentMode none with deposit creates pending_payment without Payment', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.pending_payment)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).toBeInstanceOf(Date)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
    expect(mockApplyApprovedPayment).not.toHaveBeenCalled()
  })

  it('paymentMode none with deposit 0 creates confirmed without Payment', async () => {
    setupService(20000, 0)

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.unpaid)
    expect(data.holdExpiresAt).toBeNull()
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })

  it('paymentMode none with free service creates confirmed fully_paid without Payment', async () => {
    setupService(0, 0)

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    const data = mockPrisma.booking.create.mock.calls[0][0].data
    expect(data.status).toBe(BookingStatus.confirmed)
    expect(data.paymentStatus).toBe(BookingPaymentStatus.fully_paid)
    expect(data.remainingBalance).toBe(0)
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
  })

  it('deposit_paid creates manual deposit Payment and applies ledger via finance service', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid', paymentMethod: 'transfer' })

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentType: PaymentType.deposit,
        provider: 'manual',
        amount: 5000,
        paymentMethod: 'Transferencia',
      }),
    }))
    expect(mockApplyApprovedPayment).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-1',
      businessId,
      amount: 5000,
      paymentType: PaymentType.deposit,
      paymentId: 'payment-1',
    }))
  })

  it('full_paid creates manual full_payment Payment and applies ledger via finance service', async () => {
    await createBookingFromDashboard({ ...baseInput, paymentMode: 'full_paid', paymentMethod: 'cash' })

    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentType: PaymentType.full_payment,
        provider: 'manual',
        amount: 20000,
        paymentMethod: 'Efectivo',
      }),
    }))
    expect(mockApplyApprovedPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 20000,
      paymentType: PaymentType.full_payment,
    }))
  })

  it('rejects deposit_paid when service has no deposit', async () => {
    setupService(20000, 0)

    const result = await createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid', paymentMethod: 'cash' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/No se requiere abono/)
  })

  it('rejects paid modes without paymentMethod', async () => {
    const result = await createBookingFromDashboard({ ...baseInput, paymentMode: 'deposit_paid' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Método de pago requerido/)
  })

  it('fails when slot is occupied', async () => {
    // UserError: refleja el throw real del helper de validación — un Error
    // plano acá se volvería el mensaje genérico del wrapper.
    mockAssertSlotAndResolveProfessional.mockRejectedValue(new UserError('Ese horario ya no está disponible'))

    const result = await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/horario ya no está disponible/)
  })

  it('validates customerId belongs to business', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null)

    const result = await createBookingFromDashboard({ ...baseInput, customerId: 'other-customer', paymentMode: 'none' })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Cliente no encontrado/)
  })
})

describe('createBookingFromDashboard promo discount (money path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupCustomer()
    setupBooking()
    mockPrisma.payment.create.mockResolvedValue({ id: 'payment-1' })
    mockApplyApprovedPayment.mockResolvedValue({ booking: { id: 'booking-1' }, wasConfirmed: true })
    mockAssertSlotAndResolveProfessional.mockResolvedValue(null)
  })

  it('discounted deposit charges the discounted amount, not the full price', async () => {
    // deposit == full price so the 20% discount actually moves the charged deposit:
    // effFinal = 20000 - 4000 = 16000; effDeposit = min(20000, 16000) = 16000.
    setupService(20000, 20000)
    setupPromo()

    await createBookingFromDashboard({
      ...baseInput,
      paymentMode: 'deposit_paid',
      paymentMethod: 'transfer',
      promotionCode: 'V20',
    })

    // The discount reaches the real Payment row.
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paymentType: PaymentType.deposit,
        provider: 'manual',
        amount: 16000,
      }),
    }))
    expect(mockApplyApprovedPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 16000,
      paymentType: PaymentType.deposit,
      paymentId: 'payment-1',
    }))

    // And it was persisted on the booking before the payment branch ran.
    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        discountAmount: 4000,
        finalAmount: 16000,
        depositRequired: 16000,
        remainingBalance: 16000,
      }),
    }))
  })

  it('100%-off full_paid creates no Payment and confirms fully_paid', async () => {
    // fixed_amount above total caps to the full price -> effFinal = 0.
    setupService(20000, 5000)
    setupPromo({ rewardType: 'fixed_amount', rewardValue: 1000000 })

    await createBookingFromDashboard({
      ...baseInput,
      paymentMode: 'full_paid',
      paymentMethod: 'cash',
      promotionCode: 'V20',
    })

    // effFinal = 0 -> full_paid branch is skipped entirely.
    expect(mockPrisma.payment.create).not.toHaveBeenCalled()
    expect(mockApplyApprovedPayment).not.toHaveBeenCalled()

    expect(mockPrisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        discountAmount: 20000,
        finalAmount: 0,
        remainingBalance: 0,
        status: BookingStatus.confirmed,
        paymentStatus: BookingPaymentStatus.fully_paid,
      }),
    }))
  })
})

describe('createBookingFromDashboard customer reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupService(20000, 0)
    setupBooking()
    mockAssertSlotAndResolveProfessional.mockResolvedValue(null)
  })

  it('reuses existing customer by normalized phone', async () => {
    setupCustomer({ id: 'cust-existing', businessId, name: 'Maria Antigua', phone: '56912345678', email: null })

    await createBookingFromDashboard({ ...baseInput, customerName: 'Maria Nueva', paymentMode: 'none' })

    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: '56912345678', businessId },
    })
    expect(mockPrisma.customer.create).not.toHaveBeenCalled()
  })

  it('creates new customer with normalized phone when none exists', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockResolvedValue({ id: 'cust-new', businessId, name: 'Maria Perez', phone: '56912345678', email: null })

    await createBookingFromDashboard({ ...baseInput, paymentMode: 'none' })

    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId,
        phone: '56912345678',
      }),
    })
  })
})

describe('createBookingFromDashboard con persona', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupTx()
    setupService(20000, 0)
    setupCustomer()
    setupBooking()
    mockAssertProfessionalOffersService.mockResolvedValue(undefined)
    mockAssertSlotAndResolveProfessional.mockResolvedValue(null)
  })

  it('persona elegida: se autoriza contra el servicio y la reserva queda a su nombre', async () => {
    mockAssertSlotAndResolveProfessional.mockResolvedValue('prof-1')

    const result = await createBookingFromDashboard({
      ...baseInput,
      professional: { kind: 'person', id: 'prof-1' },
    })

    expect(result.ok).toBe(true)
    // La autorización corre con la modalidad RESUELTA, no la pedida.
    expect(mockAssertProfessionalOffersService).toHaveBeenCalledWith(
      expect.anything(), businessId, 'prof-1', 'svc-1', 'on_site',
    )
    // El pick viaja entero al resolver, con lead time 0 (walk-ins) sin re-default.
    expect(mockAssertSlotAndResolveProfessional).toHaveBeenCalledWith(
      expect.objectContaining({
        professional: { kind: 'person', id: 'prof-1' },
        modality: 'on_site',
        leadTimeMinutes: 0,
      }),
    )
    const createArgs = mockPrisma.booking.create.mock.calls[0][0]
    expect(createArgs.data.professionalId).toBe('prof-1')
    // Assertear el include PEDIDO: el mock devuelve relaciones aunque nadie las pida.
    expect(createArgs.include).toEqual({
      service: true,
      customer: true,
      professional: { select: { name: true } },
    })
  })

  it('"cualquiera": no hay a quién autorizar antes y decide el resolver adentro de la tx', async () => {
    mockAssertSlotAndResolveProfessional.mockResolvedValue('prof-2')

    const result = await createBookingFromDashboard({
      ...baseInput,
      professional: { kind: 'anyone' },
    })

    expect(result.ok).toBe(true)
    expect(mockAssertProfessionalOffersService).not.toHaveBeenCalled()
    expect(mockAssertSlotAndResolveProfessional).toHaveBeenCalledWith(
      expect.objectContaining({ professional: { kind: 'anyone' } }),
    )
    expect(mockPrisma.booking.create.mock.calls[0][0].data.professionalId).toBe('prof-2')
  })

  it('sin professional: va como none y la reserva queda sin persona', async () => {
    const result = await createBookingFromDashboard({ ...baseInput })

    expect(result.ok).toBe(true)
    expect(mockAssertProfessionalOffersService).not.toHaveBeenCalled()
    expect(mockAssertSlotAndResolveProfessional).toHaveBeenCalledWith(
      expect.objectContaining({ professional: { kind: 'none' } }),
    )
    expect(mockPrisma.booking.create.mock.calls[0][0].data.professionalId).toBeNull()
  })

  it('con código de descuento, el update que se devuelve también pide la persona', async () => {
    // Camino común (paquete/código): lo que se devuelve es el update de después
    // del descuento; sin la relación ahí la persona desaparece de la respuesta.
    setupPromo()
    mockAssertSlotAndResolveProfessional.mockResolvedValue('prof-1')

    const result = await createBookingFromDashboard({
      ...baseInput,
      professional: { kind: 'person', id: 'prof-1' },
      promotionCode: 'V20',
    })

    expect(result.ok).toBe(true)
    expect(mockPrisma.booking.update.mock.calls[0][0].include).toEqual({
      service: true,
      customer: true,
      professional: { select: { name: true } },
    })
  })
})
