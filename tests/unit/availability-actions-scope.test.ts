import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

// Los dos bordes por persona de `server/actions/availability.ts`. Los dos son
// inertes hoy —nadie tiene horario propio y el funnel manda siempre `null`— y los dos
// son la clase de guard que se descubre roto recién cuando la feature está encendida.

const mockRequireBusiness = vi.fn()
const mockRequireBusinessRole = vi.fn()
const mockGenerateSlots = vi.fn()

const mockPrisma = {
  business: { findUnique: vi.fn() },
  service: { findFirst: vi.fn() },
  professional: { findFirst: vi.fn() },
  availabilityRule: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  timeBlock: { findMany: vi.fn() },
  timeBlockSeries: { findMany: vi.fn() },
  booking: { findMany: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...a: unknown[]) => mockRequireBusiness(...a),
  requireBusinessRole: (...a: unknown[]) => mockRequireBusinessRole(...a),
  ForbiddenError,
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/availability/slots', () => ({
  generateSlots: (...a: unknown[]) => mockGenerateSlots(...a),
}))

const { getAvailableTimeSlots, updateAvailabilityRule } = await import('@/server/actions/availability')

const BIZ = 'biz-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireBusiness.mockResolvedValue({ businessId: BIZ, business: { timezone: 'America/Santiago' } })
  mockRequireBusinessRole.mockResolvedValue({ businessId: BIZ, business: { timezone: 'America/Santiago' } })
  mockPrisma.business.findUnique.mockResolvedValue({
    id: BIZ, timezone: 'America/Santiago', bookingWindowDays: 90, slotStepMinutes: null,
  })
  mockPrisma.service.findFirst.mockResolvedValue({ durationMinutes: 60 })
  mockPrisma.availabilityRule.findMany.mockResolvedValue([])
  mockPrisma.availabilityRule.count.mockResolvedValue(0)
  mockPrisma.timeBlock.findMany.mockResolvedValue([])
  mockPrisma.timeBlockSeries.findMany.mockResolvedValue([])
  mockPrisma.booking.findMany.mockResolvedValue([])
  mockPrisma.availabilityRule.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.availabilityRule.findUnique.mockResolvedValue({ id: 'r1', businessId: BIZ })
  mockGenerateSlots.mockReturnValue([])
})

describe('getAvailableTimeSlots — de quién es el horario que devuelve', () => {
  // Es una action PÚBLICA y el cuarto argumento llega del navegador. Normalizar
  // defiende la forma; esto defiende la procedencia: un id inventado caería por
  // herencia al horario del salón y devolvería slots como si nada, y el problema se
  // vería recién cuando la reserva se crea a nombre de nadie.
  it('rechaza un id que no es una persona activa de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await getAvailableTimeSlots(BIZ, 'svc-1', new Date('2026-06-01T15:00:00Z'), 'de-otro-salon')

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('debía rechazar')
    expect(res.error).toContain('no está disponible')
    // Y no llegó a calcular nada.
    expect(mockGenerateSlots).not.toHaveBeenCalled()
  })

  it('el chequeo exige que sea de este negocio y esté activa', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue({ id: 'juan' })

    await getAvailableTimeSlots(BIZ, 'svc-1', new Date('2026-06-01T15:00:00Z'), 'juan')

    expect(mockPrisma.professional.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'juan', businessId: BIZ, isActive: true } }),
    )
  })

  // Sin persona no se paga una query que no hace falta, y es el camino de hoy.
  it('sin persona no pregunta por nadie', async () => {
    await getAvailableTimeSlots(BIZ, 'svc-1', new Date('2026-06-01T15:00:00Z'), null)

    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
    expect(mockGenerateSlots).toHaveBeenCalled()
  })

  // Un bundle viejo durante un deploy manda un argumento de menos. Eso NO puede
  // convertirse en un filtro "de una persona sin id", que en Prisma no filtra nada.
  it('un undefined es "sin persona", no una persona inválida', async () => {
    const res = await getAvailableTimeSlots(
      BIZ, 'svc-1', new Date('2026-06-01T15:00:00Z'), undefined as unknown as null,
    )

    expect(res.ok).toBe(true)
    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
  })
})

describe('updateAvailabilityRule — edita el horario DEL SALÓN', () => {
  // El `professionalId: null` va en el WHERE del write y no sólo en la lectura. Sin
  // eso, la única defensa contra editar el horario de una persona desde el editor
  // semanal es que la pantalla no reciba esos ids: una coincidencia de la capa de
  // presentación, no una garantía.
  it('el where del update exige que la regla no sea de nadie', async () => {
    await updateAvailabilityRule('r1', { startTime: '09:00', endTime: '18:00', isActive: true })

    expect(mockPrisma.availabilityRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', businessId: BIZ, professionalId: null } }),
    )
  })

  it('si la regla es de una persona, no la encuentra', async () => {
    mockPrisma.availabilityRule.updateMany.mockResolvedValue({ count: 0 })

    const res = await updateAvailabilityRule('regla-de-juan', { startTime: '09:00', endTime: '18:00', isActive: true })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('debía rechazar')
    expect(res.error).toContain('no encontrada')
  })
})
