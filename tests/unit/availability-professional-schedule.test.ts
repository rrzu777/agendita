import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

// La escritura del horario por persona. Todo esto es inerte hasta que exista la
// pantalla que lo llame, y es exactamente la clase de código que se descubre roto
// recién cuando la feature está encendida y alguien perdió media semana de agenda.

const mockRequireBusinessRole = vi.fn()

const mockPrisma = {
  professional: { findFirst: vi.fn() },
  availabilityRule: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn(),
  requireBusinessRole: (...a: unknown[]) => mockRequireBusinessRole(...a),
  ForbiddenError,
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryXactLock: vi.fn().mockResolvedValue(undefined),
}))

const {
  getProfessionalSchedule,
  updateProfessionalAvailabilityRule,
  resetProfessionalSchedule,
} = await import('@/server/actions/availability')

const BIZ = 'biz-1'
const JUAN = 'juan'

const salon = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireBusinessRole.mockResolvedValue({ businessId: BIZ, business: { timezone: 'America/Santiago' } })
  mockPrisma.professional.findFirst.mockResolvedValue({ id: JUAN })
  mockPrisma.availabilityRule.findMany.mockResolvedValue([])
  mockPrisma.availabilityRule.count.mockResolvedValue(0)
  mockPrisma.availabilityRule.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.availabilityRule.createMany.mockResolvedValue({ count: 7 })
  mockPrisma.availabilityRule.deleteMany.mockResolvedValue({ count: 0 })
  // La tx corre el callback con el mismo mock: alcanza para ver qué queries se hacen.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma))
})

describe('getProfessionalSchedule', () => {
  it('sin filas propias devuelve el horario del salón, dicho como heredado', async () => {
    mockPrisma.availabilityRule.findMany
      .mockResolvedValueOnce([])      // las propias
      .mockResolvedValueOnce(salon)   // las del salón

    const res = await getProfessionalSchedule(JUAN)

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('debía resolver')
    expect(res.data.inherited).toBe(true)
    expect(res.data.days).toHaveLength(7)
    expect(res.data.days[1]).toMatchObject({ startTime: '09:00', isActive: true })
  })

  it('con filas propias ya no hereda', async () => {
    mockPrisma.availabilityRule.findMany.mockResolvedValueOnce([
      { dayOfWeek: 3, startTime: '14:00', endTime: '20:00', isActive: true },
    ])

    const res = await getProfessionalSchedule(JUAN)

    expect(res.ok && res.data.inherited).toBe(false)
    // Y no pregunta por el del salón: ya no rige.
    expect(mockPrisma.availabilityRule.findMany).toHaveBeenCalledTimes(1)
  })

  /**
   * Cuando hereda, las filas que se devuelven son LAS DEL SALÓN. Si sus ids salieran
   * de acá, la pantalla de Juan tendría en la mano exactamente lo que hace falta para
   * editar el horario del salón creyendo que edita el de Juan.
   */
  it('no devuelve ids, ni siquiera cuando las filas son del salón', async () => {
    mockPrisma.availabilityRule.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(salon.map((r, i) => ({ ...r, id: `regla-salon-${i}` })))

    const res = await getProfessionalSchedule(JUAN)

    if (!res.ok) throw new Error('debía resolver')
    expect(JSON.stringify(res.data.days)).not.toContain('regla-salon')
  })

  it('rechaza un id que no es de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await getProfessionalSchedule('de-otro-salon')

    expect(res.ok).toBe(false)
    expect(mockPrisma.availabilityRule.findMany).not.toHaveBeenCalled()
  })
})

describe('updateProfessionalAvailabilityRule', () => {
  const lunes = { dayOfWeek: 1, startTime: '10:00', endTime: '16:00', isActive: true }

  it('materializa la semana antes de tocar el día', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockPrisma.availabilityRule.createMany).toHaveBeenCalledTimes(1)
    const rows = mockPrisma.availabilityRule.createMany.mock.calls[0][0].data as unknown[]
    expect(rows).toHaveLength(7)
  })

  it('no vuelve a materializar si ya tiene horario propio', async () => {
    mockPrisma.availabilityRule.count.mockResolvedValue(7)

    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockPrisma.availabilityRule.createMany).not.toHaveBeenCalled()
    expect(mockPrisma.availabilityRule.updateMany).toHaveBeenCalled()
  })

  /**
   * El where lleva las tres claves. Sin `professionalId`, este updateMany le cambia el
   * lunes al salón entero —y a todo el que herede— desde la pantalla de una persona.
   */
  it('el update apunta a (negocio, persona, día)', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockPrisma.availabilityRule.updateMany).toHaveBeenCalledWith({
      where: { businessId: BIZ, professionalId: JUAN, dayOfWeek: 1 },
      data: { startTime: '10:00', endTime: '16:00', isActive: true },
    })
  })

  it('materializar y editar van en la MISMA transacción', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    // Si la copia commitea y el update falla, la persona queda con el horario del
    // salón congelado y sin el cambio que pidió: peor que no haber hecho nada.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('rechaza un horario dado vuelta', async () => {
    const res = await updateProfessionalAvailabilityRule(JUAN, { ...lunes, startTime: '18:00', endTime: '09:00' })

    expect(res.ok).toBe(false)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rechaza un día fuera de 0–6', async () => {
    const res = await updateProfessionalAvailabilityRule(JUAN, { ...lunes, dayOfWeek: 7 })

    expect(res.ok).toBe(false)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rechaza una persona que no es de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await updateProfessionalAvailabilityRule('de-otro-salon', lunes)

    expect(res.ok).toBe(false)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('resetProfessionalSchedule', () => {
  /**
   * `professionalId` en el where es lo único que separa esto de dejar al negocio sin
   * ningún día de atención y sin forma de recuperarlo desde la pantalla.
   */
  it('borra sólo las reglas de esa persona', async () => {
    await resetProfessionalSchedule(JUAN)

    expect(mockPrisma.availabilityRule.deleteMany).toHaveBeenCalledWith({
      where: { businessId: BIZ, professionalId: JUAN },
    })
  })

  it('rechaza una persona que no es de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await resetProfessionalSchedule('de-otro-salon')

    expect(res.ok).toBe(false)
    expect(mockPrisma.availabilityRule.deleteMany).not.toHaveBeenCalled()
  })
})
