import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { UserError } from '@/lib/actions/result'
import { PROFESSIONAL_UNAVAILABLE_MESSAGE } from '@/lib/professionals/ownership'

/**
 * Reasignar sin mover la hora, a nivel action. El core de la tx
 * (`reassignBookingInTx`) corre DE VERDAD contra el prisma mockeado; lo que se
 * mockea es el módulo de validación de disponibilidad — entero, con las dos
 * mitades, por la trampa documentada de mockear una sola. La autorización
 * (`assertProfessionalOffersService`) también corre de verdad: su query cae en
 * el mock de prisma y eso deja assertear el where que construye.
 */

const mockAssertProfessionalIsFree = vi.fn()

const mockPrisma = {
  booking: { findFirst: vi.fn(), updateMany: vi.fn() },
  professional: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
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

vi.mock('@/lib/availability/validation', () => ({
  assertProfessionalIsFree: (...args: unknown[]) => mockAssertProfessionalIsFree(...args),
  assertSlotIsAvailable: vi.fn(),
  assertSlotIsBookable: vi.fn(),
  SLOT_UNAVAILABLE_MESSAGE: 'Ese horario ya no está disponible. Por favor selecciona otro.',
}))

vi.mock('@/lib/professionals/assign', () => ({
  assertSlotAndResolveProfessional: vi.fn(),
}))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn(),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(),
  sendBookingRescheduledNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
  getBusinessReplyToEmail: vi.fn().mockResolvedValue(null),
}))

const { getReassignTargets, reassignBooking } = await import('@/server/actions/bookings')

const START = new Date('2026-06-15T14:00:00Z')
const END = new Date('2026-06-15T15:00:00Z')

// La fila con lo que _reassignBooking le pasa al core de la tx.
function citaDeJuan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    businessId: 'biz-1',
    serviceId: 'svc-1',
    modality: 'on_site',
    status: 'confirmed',
    startDateTime: START,
    endDateTime: END,
    internalNotes: null,
    professionalId: 'prof-juan',
    professional: { name: 'JuanBarbero' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation(async (fn) => fn({ booking: mockPrisma.booking }))
  mockPrisma.booking.findFirst.mockResolvedValue(citaDeJuan())
  mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
  // La autorización (real) encuentra a la persona nueva…
  mockPrisma.professional.findFirst.mockResolvedValue({ id: 'prof-ana' })
  // …y la búsqueda del nombre para la nota (en paralelo con la cita) también.
  mockPrisma.professional.findUnique.mockResolvedValue({ name: 'AnaBarbera' })
  mockAssertProfessionalIsFree.mockResolvedValue(undefined)
})

describe('getReassignTargets', () => {
  it('pide gente activa del negocio que hace ESTE servicio en ESTA modalidad, sin quien ya atiende', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ serviceId: 'svc-1', modality: 'on_site', professionalId: 'prof-juan' })
    mockPrisma.professional.findMany.mockResolvedValue([{ id: 'prof-ana', name: 'AnaBarbera' }])

    const res = await getReassignTargets('bk-1')

    expect(res.ok).toBe(true)
    expect(mockPrisma.professional.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        isActive: true,
        services: { some: { id: 'svc-1' } },
        modalities: { has: 'on_site' },
        NOT: { id: 'prof-juan' },
      },
      select: { id: true, name: true },
      // Con el desempate por id, como candidatesByLoad: empates de sortOrder no
      // deben salir en un orden que dependa del plan de Postgres.
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
  })

  it('sin persona actual no excluye a nadie', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ serviceId: 'svc-1', modality: 'at_home', professionalId: null })
    mockPrisma.professional.findMany.mockResolvedValue([])

    await getReassignTargets('bk-1')

    const where = mockPrisma.professional.findMany.mock.calls[0][0].where
    expect(where.NOT).toBeUndefined()
    expect(where.modalities).toEqual({ has: 'at_home' })
  })

  it('una reserva de otro negocio no existe', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null)

    const res = await getReassignTargets('bk-ajena')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toMatch(/Reserva no encontrada/)
  })
})

describe('reassignBooking', () => {
  it('valida que la persona nueva esté libre A ESA HORA excluyendo esta cita, y se la pasa', async () => {
    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(true)
    expect(res.ok && res.data.professionalName).toBe('AnaBarbera')
    expect(mockAssertProfessionalIsFree).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'prof-ana',
        excludeBookingId: 'bk-1',
        startDateTime: START,
        endDateTime: END,
      }),
    )
    const update = mockPrisma.booking.updateMany.mock.calls[0][0]
    expect(update.data.professionalId).toBe('prof-ana')
    expect(update.data.internalNotes).toBe('[REASIGNADA: de JuanBarbero a AnaBarbera]')
    // El guard por estado corre ADENTRO de la tx, no sólo en el pre-chequeo.
    expect(update.where.status).toEqual({ notIn: ['completed', 'cancelled', 'no_show', 'expired'] })
  })

  it('asignar una cita sin persona anota distinto', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(citaDeJuan({ professionalId: null, professional: null }))

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(true)
    expect(mockPrisma.booking.updateMany.mock.calls[0][0].data.internalNotes).toBe('[ASIGNADA a AnaBarbera]')
  })

  it('la autorización corre contra servicio y modalidad DE LA RESERVA', async () => {
    await reassignBooking('bk-1', 'prof-ana')

    // assertProfessionalOffersService es real: su where llega al mock de prisma.
    expect(mockPrisma.professional.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'prof-ana',
        businessId: 'biz-1',
        isActive: true,
        services: { some: { id: 'svc-1' } },
        modalities: { has: 'on_site' },
      },
      select: { id: true },
    })
  })

  it('si no hace el servicio (o está en pausa), rebota antes de tocar nada', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toBe(PROFESSIONAL_UNAVAILABLE_MESSAGE)
    expect(mockPrisma.booking.updateMany).not.toHaveBeenCalled()
  })

  it('persona ocupada: el rechazo se cuenta para ESTA operación, no como "elegí otra hora"', async () => {
    mockAssertProfessionalIsFree.mockRejectedValue(new UserError('Ese horario ya no está disponible. Por favor selecciona otro.'))

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toBe('Esa persona no está disponible en ese horario')
  })

  it('el EXCLUDE por persona (23P01) también se cuenta con el mensaje de la operación', async () => {
    mockPrisma.booking.updateMany.mockRejectedValue(
      new Error('violates exclusion constraint "Booking_no_overlap"'),
    )

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toBe('Esa persona no está disponible en ese horario')
  })

  it('una cita en estado terminal no se reasigna', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(citaDeJuan({ status: 'completed' }))

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toMatch(/No se puede reasignar/)
  })

  it('pasársela a quien ya la atiende no es una operación', async () => {
    const res = await reassignBooking('bk-1', 'prof-juan')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toMatch(/ya atiende esta cita/)
  })

  it('si nadie escribió (carrera con un complete), el error habla del estado', async () => {
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 })

    const res = await reassignBooking('bk-1', 'prof-ana')

    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toMatch(/No se puede reasignar/)
  })
})
