import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UserError } from '@/lib/actions/result'

// El chequeo de horario se mockea porque acá se prueba OTRA cosa: a quién se le
// ofrece la hora y en qué orden. Que el chequeo sea el de verdad es justamente lo que
// se verifica en la integración (`tests/integration/cualquiera-disponible.test.ts`).
const assertSlotIsAvailable = vi.fn()
vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: (...args: unknown[]) => assertSlotIsAvailable(...args),
  SLOT_UNAVAILABLE_MESSAGE: 'Ese horario ya no está disponible. Por favor selecciona otro.',
}))

const { assertSlotAndResolveProfessional, NO_ONE_AVAILABLE_MESSAGE } = await import('@/lib/professionals/assign')

const findMany = vi.fn()
const groupBy = vi.fn()
const tx = { professional: { findMany }, booking: { groupBy } } as never

const slot = {
  tx,
  businessId: 'biz-1',
  serviceId: 'svc-1',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
  endDateTime: new Date('2026-06-15T14:30:00Z'),
  timezone: 'America/Santiago',
  modality: 'on_site' as const,
}

/** El orden en que la query los devuelve: `(sortOrder, id)`, como en producción. */
function equipo(...ids: string[]) {
  findMany.mockResolvedValue(ids.map((id) => ({ id })))
}

/** Citas de ese día por persona, como las devuelve el `groupBy`. */
function cargas(porPersona: Record<string, number>) {
  groupBy.mockResolvedValue(
    Object.entries(porPersona).map(([professionalId, n]) => ({ professionalId, _count: { _all: n } })),
  )
}

/** Quién da libre. Los demás rebotan como rebota el chequeo real: con `UserError`. */
function libres(...ids: string[]) {
  assertSlotIsAvailable.mockImplementation(async ({ professionalId }: { professionalId: string | null }) => {
    if (professionalId === null || ids.includes(professionalId)) return
    throw new UserError('Ese horario ya no está disponible. Por favor selecciona otro.')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  cargas({})
  libres()
})

describe('a nombre de quién queda la reserva', () => {
  it('sin persona valida contra el negocio y no busca candidatos', async () => {
    expect(await assertSlotAndResolveProfessional({ ...slot, professional: { kind: 'none' } })).toBeNull()
    expect(assertSlotIsAvailable).toHaveBeenCalledWith(expect.objectContaining({ professionalId: null }))
    expect(findMany).not.toHaveBeenCalled()
  })

  it('con una persona elegida valida contra ella y devuelve su id', async () => {
    libres('juan')
    expect(await assertSlotAndResolveProfessional({ ...slot, professional: { kind: 'person', id: 'juan' } })).toBe('juan')
    expect(findMany).not.toHaveBeenCalled()
  })

  // El rechazo se propaga tal cual: quien eligió a Juan tiene que enterarse de que la
  // hora de Juan ya no está, no que le asignen a otro por lo bajo.
  it('y no busca reemplazo si esa persona ya no tiene la hora', async () => {
    libres('ana')
    await expect(assertSlotAndResolveProfessional({ ...slot, professional: { kind: 'person', id: 'juan' } }))
      .rejects.toThrow('Ese horario ya no está disponible')
  })
})

describe('"cualquiera disponible": a quién le toca', () => {
  const anyone = { ...slot, professional: { kind: 'anyone' as const } }

  /**
   * Repartir por carga es lo que evita que el primero de la lista se lleve el día
   * entero. Sin esto, "cualquiera" sería siempre la misma persona.
   */
  it('gana quien menos citas tiene ese día', async () => {
    equipo('juan', 'ana')
    cargas({ juan: 3, ana: 1 })
    libres('juan', 'ana')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('ana')
  })

  // A igual carga manda el orden que definió la dueña, que es el que trae la query.
  it('a igual carga, el orden del panel', async () => {
    equipo('juan', 'ana')
    cargas({ juan: 2, ana: 2 })
    libres('juan', 'ana')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('juan')
  })

  // Quien no tiene ninguna cita ese día no aparece en el groupBy: contarlo como 0 y
  // no como "sin dato" es lo que hace que sea el primero en recibir.
  it('quien no tiene citas ese día va primero', async () => {
    equipo('juan', 'ana')
    cargas({ juan: 1 })
    libres('juan', 'ana')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('ana')
  })

  /**
   * El punto de resolver adentro de la transacción: el de menos carga puede estar
   * justo ocupado a esa hora. Saltearlo y seguir con el siguiente es lo que hace que
   * "cualquiera" ofrezca la unión de horarios y la cumpla.
   */
  it('saltea al ocupado y sigue con el siguiente', async () => {
    equipo('juan', 'ana')
    cargas({ juan: 5 })
    libres('juan')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('juan')
    expect(assertSlotIsAvailable).toHaveBeenCalledTimes(2)
  })

  it('si nadie tiene la hora, la respuesta es que el horario se fue', async () => {
    equipo('juan', 'ana')
    libres()

    await expect(assertSlotAndResolveProfessional(anyone)).rejects.toThrow('Ese horario ya no está disponible')
  })

  /**
   * Distinto de "nadie libre a esa hora": acá la dueña dejó el servicio sin nadie
   * asignado, y ninguna otra hora va a funcionar tampoco. Decirle "elegí otro
   * horario" la mandaría a probar hasta cansarse.
   */
  it('sin candidatos elegibles lo dice distinto', async () => {
    equipo()

    await expect(assertSlotAndResolveProfessional(anyone)).rejects.toThrow(NO_ONE_AVAILABLE_MESSAGE)
    expect(assertSlotIsAvailable).not.toHaveBeenCalled()
  })

  // Con un solo candidato no hace falta preguntar la carga: no hay nada que ordenar.
  it('con uno solo no cuenta cargas', async () => {
    equipo('juan')
    libres('juan')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('juan')
    expect(groupBy).not.toHaveBeenCalled()
  })

  /**
   * El `catch` está para los rechazos de horario, no para tapar una caída de la base.
   * Si se tragara todo, un error de conexión se vería como "no hay horario" y la
   * transacción seguiría como si nada.
   */
  it('un error que no es de horario se propaga', async () => {
    equipo('juan', 'ana')
    assertSlotIsAvailable.mockRejectedValue(new Error('se cayó la conexión'))

    await expect(assertSlotAndResolveProfessional(anyone)).rejects.toThrow('se cayó la conexión')
  })

  // La elegibilidad es la misma que autoriza la elección explícita, y la modalidad
  // entra en el filtro: sin eso, "cualquiera" incluiría a quien no viaja a domicilio.
  it('los candidatos salen del filtro de elegibilidad, con la modalidad adentro', async () => {
    equipo('juan')
    libres('juan')

    await assertSlotAndResolveProfessional({ ...anyone, modality: 'at_home' })

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        businessId: 'biz-1',
        isActive: true,
        services: { some: { id: 'svc-1' } },
        modalities: { has: 'at_home' },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
  })
})
