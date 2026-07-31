import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

// La escritura del horario por persona. Todo esto es inerte hasta que exista la
// pantalla que lo llame, y es exactamente la clase de código que se descubre roto
// recién cuando la feature está encendida y alguien perdió media semana de agenda.

const mockRequireBusinessRole = vi.fn()

// La transacción es un objeto DISTINTO del cliente de afuera, a propósito: con el
// mismo mock para los dos, un test que afirme "el update va adentro de la tx" pasa
// igual si el update se mueve afuera.
const mockTx = {
  availabilityRule: {
    count: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}

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

const mockLock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryXactLock: (...a: unknown[]) => mockLock(...a),
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

/** El `where` del último `findMany` de reglas hecho sobre el cliente de afuera. */
function lastRulesQuery() {
  const calls = mockPrisma.availabilityRule.findMany.mock.calls
  return calls[calls.length - 1][0] as { where: Record<string, unknown>; select: Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireBusinessRole.mockResolvedValue({ businessId: BIZ, business: { timezone: 'America/Santiago' } })
  mockPrisma.professional.findFirst.mockResolvedValue({ id: JUAN })
  mockPrisma.availabilityRule.findMany.mockResolvedValue(salon)
  mockPrisma.availabilityRule.count.mockResolvedValue(0)
  mockTx.availabilityRule.count.mockResolvedValue(0)
  mockTx.availabilityRule.findMany.mockResolvedValue(salon)
  mockTx.availabilityRule.createMany.mockResolvedValue({ count: 7 })
  mockTx.availabilityRule.updateMany.mockResolvedValue({ count: 1 })
  mockTx.availabilityRule.deleteMany.mockResolvedValue({ count: 7 })
  mockLock.mockResolvedValue(undefined)
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))
})

describe('getProfessionalSchedule', () => {
  it('sin filas propias devuelve el horario del salón, dicho como heredado', async () => {
    mockPrisma.availabilityRule.count.mockResolvedValue(0)

    const res = await getProfessionalSchedule(JUAN)

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('debía resolver')
    expect(res.data.inherited).toBe(true)
    expect(lastRulesQuery().where).toEqual({ businessId: BIZ, professionalId: null })
    expect(res.data.days).toHaveLength(7)
    expect(res.data.days[1]).toMatchObject({ startTime: '09:00', isActive: true })
  })

  it('con filas propias trae las suyas y ya no hereda', async () => {
    mockPrisma.availabilityRule.count.mockResolvedValue(7)

    const res = await getProfessionalSchedule(JUAN)

    expect(res.ok && res.data.inherited).toBe(false)
    expect(lastRulesQuery().where).toEqual({ businessId: BIZ, professionalId: JUAN })
  })

  /**
   * Cuando hereda, las filas que se devuelven son LAS DEL SALÓN. Si sus ids salieran
   * de acá, la pantalla de Juan tendría en la mano exactamente lo que hace falta para
   * editar el horario del salón creyendo que edita el de Juan. `projectWeek` los
   * descarta igual (eso lo prueba `weekly-schedule.test.ts`); esto afirma la otra
   * mitad, que la base ni siquiera los devuelve.
   */
  it('no pide el id de las reglas a la base', async () => {
    await getProfessionalSchedule(JUAN)

    expect(lastRulesQuery().select).not.toHaveProperty('id')
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

  it('materializa antes de tocar el día', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockTx.availabilityRule.createMany).toHaveBeenCalledTimes(1)
  })

  it('no vuelve a materializar si ya tiene horario propio', async () => {
    mockTx.availabilityRule.count.mockResolvedValue(7)

    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockTx.availabilityRule.createMany).not.toHaveBeenCalled()
    expect(mockTx.availabilityRule.updateMany).toHaveBeenCalled()
  })

  /**
   * El where lleva las tres claves. Sin `professionalId`, este updateMany le cambia el
   * lunes al salón entero —y a todo el que herede— desde la pantalla de una persona.
   */
  it('el update apunta a (negocio, persona, día)', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockTx.availabilityRule.updateMany).toHaveBeenCalledWith({
      where: { businessId: BIZ, professionalId: JUAN, dayOfWeek: 1 },
      data: { startTime: '10:00', endTime: '16:00', isActive: true },
    })
  })

  // Si la copia commitea y el update falla, la persona queda con el horario del salón
  // congelado y sin el cambio que pidió: peor que no haber hecho nada. El mock de la
  // tx es un objeto aparte, así que esto se rompe de verdad si el update sale afuera.
  it('materializar y editar corren los dos sobre la transacción', async () => {
    await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockTx.availabilityRule.updateMany).toHaveBeenCalled()
    expect(mockPrisma.availabilityRule.updateMany).not.toHaveBeenCalled()
  })

  /**
   * `count: 0` después de materializar significa filas propias PARCIALES (un backfill,
   * un import). Sin el guard es un updateMany que no toca nada y una pantalla que dice
   * "guardado" — el peor desenlace, porque nadie se entera.
   */
  it('si el día no existe después de materializar, falla en vez de decir "guardado"', async () => {
    mockTx.availabilityRule.count.mockResolvedValue(3) // parciales: ya "tiene horario propio"
    mockTx.availabilityRule.updateMany.mockResolvedValue({ count: 0 })

    const res = await updateProfessionalAvailabilityRule(JUAN, lunes)

    expect(res.ok).toBe(false)
    expect(mockTx.availabilityRule.createMany).not.toHaveBeenCalled()
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

  /**
   * El borde que hace peligroso a Prisma: un `undefined` en un `where` **borra la
   * clave**. Si el guard de procedencia no normalizara, `findFirst({ id: undefined })`
   * devolvería una persona cualquiera del negocio, el chequeo pasaría, y el mismo
   * `undefined` seguiría hasta el `updateMany` — que sin `professionalId` le cambia el
   * día al salón y a todo el equipo.
   */
  it('un undefined no pasa por persona válida', async () => {
    const res = await updateProfessionalAvailabilityRule(undefined as unknown as string, lunes)

    expect(res.ok).toBe(false)
    expect(mockPrisma.professional.findFirst).not.toHaveBeenCalled()
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

    expect(mockTx.availabilityRule.deleteMany).toHaveBeenCalledWith({
      where: { businessId: BIZ, professionalId: JUAN },
    })
  })

  /**
   * El lock protege el recurso `(negocio, persona)`, no una función: un reset que caiga
   * entre el `count` y el `createMany` de un guardado concurrente queda deshecho en
   * silencio, y la dueña ve que el botón "no hizo nada".
   */
  it('toma el MISMO lock que la materialización', async () => {
    await resetProfessionalSchedule(JUAN)

    expect(mockLock).toHaveBeenCalledWith(mockTx, `availability-rules:${BIZ}:${JUAN}`)
  })

  it('rechaza una persona que no es de este negocio', async () => {
    mockPrisma.professional.findFirst.mockResolvedValue(null)

    const res = await resetProfessionalSchedule('de-otro-salon')

    expect(res.ok).toBe(false)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // Mismo borde que el update: sin normalizar, el `deleteMany` se lleva el horario del
  // salón entero.
  it('un undefined no pasa por persona válida', async () => {
    const res = await resetProfessionalSchedule(undefined as unknown as string)

    expect(res.ok).toBe(false)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})
