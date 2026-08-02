import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  professional: { findFirst: vi.fn() },
  booking: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  },
  customer: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null }),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError,
}))
vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getConfirmedSessionUser: vi.fn().mockResolvedValue(null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('resend', () => ({
  Resend: vi.fn(function (this: Record<string, unknown>) {
    this.emails = { send: vi.fn().mockResolvedValue({ id: 'msg-1' }) }
  }),
}))
vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@test.com'),
  sendBookingConfirmationToCustomer: vi.fn(),
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn().mockResolvedValue([]),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendBookingRescheduledNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

const assertSlotIsAvailable = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: (...args: unknown[]) => assertSlotIsAvailable(...args),
  SLOT_UNAVAILABLE_MESSAGE: 'Ese horario ya no está disponible. Por favor selecciona otro.',
}))
vi.mock('@/lib/subscriptions/enforcement', () => ({ assertBusinessCanReceiveBookings: vi.fn() }))

const { createBooking } = await import('@/server/actions/bookings')

function setupMocks() {
  mockPrisma.business.findUnique.mockResolvedValue({
    id: 'biz-1',
    timezone: 'America/Santiago',
    name: 'Barbería Test',
    whatsapp: '+56987654321',
    addressText: 'Av. Siempre Viva 742',
    currency: 'CLP',
    cancellationPolicy: null,
    slug: 'test-biz',
    subdomain: null,
    subscriptionStatus: 'active',
  })
  mockPrisma.service.findFirst.mockResolvedValue({
    id: 'svc-1', name: 'Corte', price: 12000, depositAmount: 0,
    durationMinutes: 30, modalities: ['on_site'], isActive: true,
  })
  mockPrisma.professional.findFirst.mockResolvedValue({ id: 'prof-1' })
  mockPrisma.booking.create.mockResolvedValue({
    id: 'booking-created',
    customer: { name: 'Juan', phone: '+56912345678', email: null },
    service: { name: 'Corte' },
  })
  mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
    business: { findUnique: mockPrisma.business.findUnique, update: vi.fn().mockResolvedValue({ bookingNumberSeq: 7 }) },
    service: { findFirst: mockPrisma.service.findFirst },
    booking: { create: mockPrisma.booking.create },
    customer: { findFirst: mockPrisma.customer.findFirst, create: mockPrisma.customer.create },
    promotionGrant: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    timeBlock: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityRule: { findFirst: vi.fn().mockResolvedValue({ startTime: '08:00', endTime: '20:00' }) },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
  }))
}

const baseInput = {
  serviceId: 'svc-1',
  customerName: 'Juan',
  customerPhone: '+56912345678',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
  acceptedTerms: true,
}

function datosCreados() {
  const call = mockPrisma.booking.create.mock.calls[0]?.[0] as Record<string, unknown>
  return call?.data as Record<string, unknown>
}

describe('createBooking — con quién', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('guarda la persona y la usa para validar el horario', async () => {
    await createBooking({ ...baseInput, professionalId: 'prof-1' }, 'biz-1')

    expect(datosCreados().professionalId).toBe('prof-1')
    expect(assertSlotIsAvailable.mock.calls[0][0]).toMatchObject({ professionalId: 'prof-1' })
  })

  it('sin persona sigue siendo el funnel de siempre', async () => {
    await createBooking(baseInput, 'biz-1')

    expect(datosCreados().professionalId).toBeNull()
    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
  })

  /**
   * El id llega de un formulario público: que la pantalla no la haya ofrecido no
   * impide que llegue. Y el rechazo tiene que pasar ANTES de la transacción — si
   * pasara adentro, la reserva quedaría escrita a nombre de nadie.
   */
  it('rechaza a quien no está entre las opciones, sin escribir nada', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await createBooking({ ...baseInput, professionalId: 'de-otro-salon' }, 'biz-1')

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toBe('Esa persona no está disponible para reservar')
    expect(mockPrisma.booking.create).not.toHaveBeenCalled()
  })

  /**
   * Las tres condiciones van juntas en el mismo `where`: de este negocio, activa,
   * que haga el servicio y que atienda en esa modalidad. La última es la que se
   * olvida, y sin ella el funnel manda a alguien a domicilio que no viaja.
   */
  it('verifica negocio, alta, servicio y modalidad en una sola consulta', async () => {
    await createBooking({ ...baseInput, professionalId: 'prof-1' }, 'biz-1')

    expect(mockPrisma.professional.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'prof-1',
        businessId: 'biz-1',
        isActive: true,
        services: { some: { id: 'svc-1' } },
        modalities: { has: 'on_site' },
      },
    })
  })

  // Un string vacío que llegue del navegador no es una persona. Sin normalizar
  // entraría al `where` y Prisma devolvería una fila cualquiera del negocio.
  it('trata el id vacío como "sin persona"', async () => {
    await createBooking({ ...baseInput, professionalId: '' }, 'biz-1')

    expect(datosCreados().professionalId).toBeNull()
    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
  })
})
