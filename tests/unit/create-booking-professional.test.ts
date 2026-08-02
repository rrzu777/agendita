import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  professional: { findFirst: vi.fn(), findMany: vi.fn() },
  booking: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
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
const assertProfessionalIsFree = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: (...args: unknown[]) => assertSlotIsAvailable(...args),
  assertSlotIsBookable: vi.fn().mockResolvedValue(undefined),
  assertProfessionalIsFree: (...args: unknown[]) => assertProfessionalIsFree(...args),
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
  mockPrisma.professional.findMany.mockResolvedValue([{ id: 'prof-1' }, { id: 'prof-2' }])
  mockPrisma.booking.findMany.mockResolvedValue([])
  mockPrisma.booking.create.mockResolvedValue({
    id: 'booking-created',
    customer: { name: 'Juan', phone: '+56912345678', email: null },
    service: { name: 'Corte' },
  })
  mockPrisma.$transaction.mockImplementation(async (fn: Function) => fn({
    business: { findUnique: mockPrisma.business.findUnique, update: vi.fn().mockResolvedValue({ bookingNumberSeq: 7 }) },
    service: { findFirst: mockPrisma.service.findFirst },
    booking: { create: mockPrisma.booking.create, findMany: mockPrisma.booking.findMany },
    customer: { findFirst: mockPrisma.customer.findFirst, create: mockPrisma.customer.create },
    promotionGrant: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    professional: { findFirst: mockPrisma.professional.findFirst, findMany: mockPrisma.professional.findMany },
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
    await createBooking({ ...baseInput, professional: { kind: 'person', id: 'prof-1' } }, 'biz-1')

    expect(datosCreados().professionalId).toBe('prof-1')
    expect(assertProfessionalIsFree.mock.calls[0][0]).toMatchObject({ professionalId: 'prof-1' })
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

    const res = await createBooking({ ...baseInput, professional: { kind: 'person', id: 'de-otro-salon' } }, 'biz-1')

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
    await createBooking({ ...baseInput, professional: { kind: 'person', id: 'prof-1' } }, 'biz-1')

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

  /**
   * El id vacío no es una persona. Antes había que normalizarlo a mano —sin eso
   * entraba al `where` y Prisma devolvía una fila cualquiera del negocio—; ahora el
   * schema lo rechaza de entrada, que es más fuerte: nunca llega a ningún `where`.
   */
  it('rechaza el id vacío en vez de tratarlo como una persona', async () => {
    const res = await createBooking(
      { ...baseInput, professional: { kind: 'person', id: '' } },
      'biz-1',
    )

    expect(res.ok).toBe(false)
    expect(mockPrisma.booking.create).not.toHaveBeenCalled()
  })
})

/**
 * "Cualquiera disponible" es el único caso donde el navegador NO manda a nadie y la
 * reserva igual queda a nombre de alguien. Todo lo que decide vive del lado del
 * servidor, adentro de la transacción.
 */
describe('createBooking — "cualquiera disponible"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('guarda a quien resolvió el servidor', async () => {
    await createBooking({ ...baseInput, professional: { kind: 'anyone' } }, 'biz-1')

    expect(datosCreados().professionalId).toBe('prof-1')
  })

  /**
   * No hay id que autorizar: la persona no existe hasta que la transacción la elija.
   * Ese `findFirst` es el guard de la elección EXPLÍCITA, y correrlo acá con un id
   * que no existe rechazaría la reserva antes de empezar.
   */
  it('no pasa por el guard de la elección explícita', async () => {
    await createBooking({ ...baseInput, professional: { kind: 'anyone' } }, 'biz-1')

    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.professional.findMany).toHaveBeenCalled()
  })

  // El equipo se busca DENTRO de la transacción: hacerlo afuera es la carrera que
  // esta feature vino a evitar —entre la lectura y el insert alguien se ocupa—.
  it('resuelve adentro de la transacción, no antes', async () => {
    const antesDeLaTx = mockPrisma.$transaction.mock.calls.length
    await createBooking({ ...baseInput, professional: { kind: 'anyone' } }, 'biz-1')

    expect(antesDeLaTx).toBe(0)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })
})
