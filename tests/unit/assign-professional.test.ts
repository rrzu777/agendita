import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UserError } from '@/lib/actions/result'

// Los dos chequeos se mockean porque acá se prueba OTRA cosa: a quién se le ofrece la
// hora y en qué orden. Que los chequeos sean los de verdad es justamente lo que
// verifica la integración (`tests/integration/cualquiera-disponible.test.ts`).
const assertSlotIsBookable = vi.fn()
const assertProfessionalIsFree = vi.fn()
vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsBookable: (...args: unknown[]) => assertSlotIsBookable(...args),
  assertProfessionalIsFree: (...args: unknown[]) => assertProfessionalIsFree(...args),
  SLOT_UNAVAILABLE_MESSAGE: 'Ese horario ya no está disponible. Por favor selecciona otro.',
}))

const { assertSlotAndResolveProfessional, NO_ONE_AVAILABLE_MESSAGE } = await import('@/lib/professionals/assign')

const findMany = vi.fn()
const citasDelDia = vi.fn()
const tx = { professional: { findMany }, booking: { findMany: citasDelDia } } as never

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

const CITA_BASE = { status: 'confirmed', holdExpiresAt: null, paymentStatus: 'unpaid', paymentMethod: null }

/** Citas en OTRA hora: cuentan para la carga y no chocan con el slot pedido. */
function citasEnOtraHora(professionalId: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...CITA_BASE,
    professionalId,
    startDateTime: new Date(`2026-06-15T1${6 + i}:00:00Z`),
    endDateTime: new Date(`2026-06-15T1${6 + i}:30:00Z`),
  }))
}

function cargas(porPersona: Record<string, number>, extra: unknown[] = []) {
  citasDelDia.mockResolvedValue([
    ...Object.entries(porPersona).flatMap(([id, n]) => citasEnOtraHora(id, n)),
    ...extra,
  ])
}

/** Una cita encima del slot pedido: la corazonada de `candidatesByLoad` la ve. */
function ocupadaAEsaHora(professionalId: string) {
  return {
    ...CITA_BASE,
    professionalId,
    startDateTime: new Date('2026-06-15T14:00:00Z'),
    endDateTime: new Date('2026-06-15T14:30:00Z'),
  }
}

/** Quién da libre. Los demás rebotan como rebota el chequeo real: con `UserError`. */
function libres(...ids: string[]) {
  assertProfessionalIsFree.mockImplementation(async ({ professionalId }: { professionalId: string | null }) => {
    if (professionalId === null || ids.includes(professionalId)) return
    throw new UserError('Ese horario ya no está disponible. Por favor selecciona otro.')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  assertSlotIsBookable.mockResolvedValue(undefined)
  cargas({})
  libres()
})

describe('a nombre de quién queda la reserva', () => {
  it('sin persona valida contra el negocio y no busca candidatos', async () => {
    expect(await assertSlotAndResolveProfessional({ ...slot, professional: { kind: 'none' } })).toBeNull()
    expect(assertProfessionalIsFree).toHaveBeenCalledWith(expect.objectContaining({ professionalId: null }))
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
    expect(assertProfessionalIsFree).toHaveBeenCalledTimes(2)
  })

  /**
   * La corazonada: quien ya tiene una cita ENCIMA de esa hora se prueba último. Sale
   * de las mismas citas que se traen para contar la carga, así que es gratis, y evita
   * preguntarle a la base por cada persona ocupada con el advisory lock puesto.
   */
  it('prueba último a quien ya tiene una cita a esa hora', async () => {
    equipo('juan', 'ana')
    // Juan es el MENOS cargado del día y el primero del panel: por carga y por orden
    // ganaría él. Lo único que lo manda al fondo es tener la hora ya tomada.
    cargas({ ana: 3 }, [ocupadaAEsaHora('juan')])
    libres('juan', 'ana')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('ana')
    expect(assertProfessionalIsFree).toHaveBeenCalledTimes(1)
  })

  /**
   * Y ordena, no filtra: la lectura va sin `FOR UPDATE` y sin barrer los holds
   * abandonados, así que puede dar por ocupado a alguien que en realidad está libre.
   * Descartarlo dejaría sin reservar una hora que sí se podía reservar.
   */
  it('pero igual lo prueba si es el único', async () => {
    equipo('juan', 'ana')
    cargas({}, [ocupadaAEsaHora('juan'), ocupadaAEsaHora('ana')])
    libres('juan')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('juan')
  })

  /**
   * Lo que NO depende de la persona se pregunta una sola vez. Con un candidato por
   * pasada, un servicio dado de baja o una hora fuera de la ventana costaban N vueltas
   * a la base para terminar diciendo lo mismo.
   */
  it('lo que no depende de la persona se chequea una vez y corta', async () => {
    equipo('juan', 'ana')
    assertSlotIsBookable.mockRejectedValue(new UserError('Ese horario ya no está disponible. Por favor selecciona otro.'))

    await expect(assertSlotAndResolveProfessional(anyone)).rejects.toThrow('Ese horario ya no está disponible')
    expect(assertSlotIsBookable).toHaveBeenCalledTimes(1)
    expect(findMany).not.toHaveBeenCalled()
    expect(assertProfessionalIsFree).not.toHaveBeenCalled()
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
    expect(assertProfessionalIsFree).not.toHaveBeenCalled()
  })

  // Con un solo candidato no hace falta preguntar la carga: no hay nada que ordenar.
  it('con uno solo no cuenta cargas', async () => {
    equipo('juan')
    libres('juan')

    expect(await assertSlotAndResolveProfessional(anyone)).toBe('juan')
    expect(citasDelDia).not.toHaveBeenCalled()
  })

  /**
   * El `catch` está para los rechazos de horario, no para tapar una caída de la base.
   * Si se tragara todo, un error de conexión se vería como "no hay horario" y la
   * transacción seguiría como si nada.
   */
  it('un error que no es de horario se propaga', async () => {
    equipo('juan', 'ana')
    assertProfessionalIsFree.mockRejectedValue(new Error('se cayó la conexión'))

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
