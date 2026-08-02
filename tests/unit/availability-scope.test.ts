import { describe, it, expect, vi } from 'vitest'
import {
  blockScopeCondition,
  blockScopeFor,
  bookingScopeCondition,
  bookingBlocksProfessional,
  bookingsOfDayWhere,
  resolveAvailabilityRules,
  rulesForProfessional,
  resolveDayRule,
  resolveRuleScope,
} from '@/lib/availability/scope'

// Estos tests miran los WHERE que se arman, no filas de una base. Es a propósito:
// lo que puede salir mal acá no es el resultado de una query sino el filtro que se
// le pasa — un `undefined` de más y el filtro deja de filtrar.

type RuleRow = { dayOfWeek: number; isActive: boolean; professionalId: string | null }

// El fake exige `businessId` en todo `where`: sin eso, un filtro al que se le
// olvidara el negocio pasaba estos tests y se llevaba las filas de otro salón.
function fakeClient(rows: RuleRow[]) {
  const scoped = (where: Record<string, unknown>) => {
    if (where.businessId !== 'biz') throw new Error(`where sin businessId: ${JSON.stringify(where)}`)
    return rows.filter((r) => r.professionalId === (where.professionalId as string | null))
  }
  const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    scoped(where).filter((r) => where.isActive === undefined || r.isActive === where.isActive),
  )
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    scoped(where).find((r) => r.dayOfWeek === where.dayOfWeek && r.isActive === where.isActive) ?? null,
  )
  const count = vi.fn(async ({ where }: { where: Record<string, unknown> }) => scoped(where).length)
  const client = { availabilityRule: { findMany, findFirst, count } }
  // El cast es el precio de no arrastrar el PrismaClient entero a un test que sólo
  // necesita tres métodos.
  return { client: client as unknown as Parameters<typeof resolveAvailabilityRules>[0], findMany, findFirst, count }
}

const negocio = (dayOfWeek: number, isActive = true): RuleRow => ({ dayOfWeek, isActive, professionalId: null })
const deJuan = (dayOfWeek: number, isActive = true): RuleRow => ({ dayOfWeek, isActive, professionalId: 'juan' })

describe('blockScopeFor', () => {
  it('sin persona pide sólo los bloqueos del negocio', () => {
    expect(blockScopeFor(null)).toEqual({ kind: 'business' })
  })

  it('con persona pide los del negocio y los suyos', () => {
    expect(blockScopeFor('juan')).toEqual({ kind: 'professional', professionalId: 'juan' })
  })

  // Los tipos lo impiden adentro de src, pero los argumentos de una server action
  // llegan del cliente. Un `undefined` tratado como persona arma un
  // `{ professionalId: undefined }`, que en Prisma NO filtra: el cálculo mezclaría
  // el horario y los bloqueos de todo el equipo, sin un error en ningún log.
  it('un undefined o un id vacío es "sin persona", no "una persona sin id"', () => {
    expect(blockScopeFor(undefined as unknown as null)).toEqual({ kind: 'business' })
    expect(blockScopeFor('')).toEqual({ kind: 'business' })
  })
})

describe('blockScopeCondition', () => {
  it('negocio: sólo los que no son de nadie', () => {
    expect(blockScopeCondition({ kind: 'business' })).toEqual({ professionalId: null })
  })

  it('persona: los suyos MÁS los del negocio, que cierran para todos', () => {
    expect(blockScopeCondition({ kind: 'professional', professionalId: 'juan' })).toEqual({
      OR: [{ professionalId: null }, { professionalId: 'juan' }],
    })
  })

  it('everyone no filtra: es el alcance de mostrar', () => {
    expect(blockScopeCondition({ kind: 'everyone' })).toEqual({})
  })
})

describe('bookingScopeCondition', () => {
  // La asimetría con los bloqueos es deliberada y va en la dirección segura: dar de
  // baja al equipo devuelve el negocio al modo de hoy, pero las citas que esa gente
  // tenía conservan su professionalId. Filtrarlas las volvería invisibles y el
  // funnel ofrecería una hora ya tomada.
  it('sin persona cuenta TODAS las reservas, no sólo las sin persona', () => {
    expect(bookingScopeCondition(null)).toEqual({})
  })

  it('con persona cuenta las suyas y las que no son de nadie', () => {
    expect(bookingScopeCondition('juan')).toEqual({
      OR: [{ professionalId: null }, { professionalId: 'juan' }],
    })
  })

  it('un undefined no se convierte en un filtro de persona', () => {
    expect(bookingScopeCondition(undefined as unknown as null)).toEqual({})
  })
})

describe('resolveRuleScope', () => {
  it('sin persona no pregunta nada: el alcance es el del negocio', async () => {
    const { client, count } = fakeClient([negocio(1), deJuan(6)])
    expect(await resolveRuleScope(client, 'biz', null)).toBeNull()
    expect(count).not.toHaveBeenCalled()
  })

  it('devuelve la persona con filas propias, y null sin ninguna', async () => {
    const sin = fakeClient([negocio(1)])
    expect(await resolveRuleScope(sin.client, 'biz', 'juan')).toBeNull()

    const con = fakeClient([negocio(1), deJuan(6)])
    expect(await resolveRuleScope(con.client, 'biz', 'juan')).toBe('juan')
  })

  // El borde que invierte el sentido de todo: si la pregunta filtrara por isActive,
  // cerrarle la semana entera a alguien lo dejaría "sin filas propias" y por lo
  // tanto ABIERTO en el horario del salón.
  it('no filtra por isActive: una semana entera cerrada sigue siendo horario propio', async () => {
    const { client, count } = fakeClient([negocio(1), deJuan(1, false), deJuan(2, false)])
    expect(await resolveRuleScope(client, 'biz', 'juan')).toBe('juan')
    expect(count).toHaveBeenCalledWith({ where: { businessId: 'biz', professionalId: 'juan' } })
  })
})

describe('resolveAvailabilityRules', () => {
  it('sin persona trae las del negocio', async () => {
    const { client, findMany } = fakeClient([negocio(1), deJuan(6)])
    const rules = await resolveAvailabilityRules(client, 'biz', null)
    expect(rules.map((r) => r.dayOfWeek)).toEqual([1])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz', professionalId: null, isActive: true } }),
    )
  })

  it('una persona con horario propio no ve el del negocio', async () => {
    const { client } = fakeClient([negocio(1), negocio(2), deJuan(6)])
    const rules = await resolveAvailabilityRules(client, 'biz', 'juan')
    expect(rules.map((r) => r.dayOfWeek)).toEqual([6])
  })

  it('una persona sin horario propio HEREDA el del negocio', async () => {
    const { client } = fakeClient([negocio(1), negocio(2)])
    const rules = await resolveAvailabilityRules(client, 'biz', 'juan')
    expect(rules.map((r) => r.dayOfWeek)).toEqual([1, 2])
  })

  it('una persona con sus días cerrados queda cerrada, no heredando', async () => {
    const { client } = fakeClient([negocio(1), deJuan(1, false)])
    expect(await resolveAvailabilityRules(client, 'biz', 'juan')).toEqual([])
  })
})

describe('resolveDayRule', () => {
  it('filtra el día en la query y respeta la herencia', async () => {
    const { client, findFirst } = fakeClient([negocio(3)])
    expect(await resolveDayRule(client, 'biz', 'juan', 3)).not.toBeNull()
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz', professionalId: null, dayOfWeek: 3, isActive: true },
      }),
    )
  })

  it('con horario propio el día que no trabaja da null, no el del negocio', async () => {
    const { client } = fakeClient([negocio(3), deJuan(6)])
    expect(await resolveDayRule(client, 'biz', 'juan', 3)).toBeNull()
    expect(await resolveDayRule(client, 'biz', 'juan', 6)).not.toBeNull()
  })

  // Que las dos vías coincidan es lo que evita ofrecer una hora que después se
  // rechaza: los slots salen de resolveAvailabilityRules y la validación al
  // escribir, de resolveDayRule.
  it('coincide con resolveAvailabilityRules para el mismo día', async () => {
    const rows = [negocio(1), negocio(2), deJuan(2), deJuan(5)]
    for (const dia of [1, 2, 5]) {
      const { client: a } = fakeClient(rows)
      const { client: b } = fakeClient(rows)
      const desdeLaLista = (await resolveAvailabilityRules(a, 'biz', 'juan')).some((r) => r.dayOfWeek === dia)
      const desdeElDia = (await resolveDayRule(b, 'biz', 'juan', dia)) !== null
      expect(desdeElDia, `día ${dia}`).toBe(desdeLaLista)
    }
  })
})

// El predicado en memoria y la condición de Prisma son la lectura y la escritura del
// MISMO contrato: los lectores usan `bookingScopeCondition` y la validación al escribir
// usa esto, porque su query no puede filtrar por persona (trae todo con FOR UPDATE para
// que el sweep de holds abandonados pueda barrerlos, y el EXCLUDE de la base es por
// negocio). Si se separan, el funnel ofrece una hora que la escritura rechaza.
describe('bookingBlocksProfessional', () => {
  const deAna = { professionalId: 'ana' }
  const sinDueno = { professionalId: null }

  it('una reserva SIN persona nueva choca contra todo', () => {
    expect(bookingBlocksProfessional(deAna, null)).toBe(true)
    expect(bookingBlocksProfessional(sinDueno, null)).toBe(true)
    expect(bookingBlocksProfessional(deAna, undefined as unknown as null)).toBe(true)
  })

  it('la cita de Ana no le tapa la hora a Juan', () => {
    expect(bookingBlocksProfessional(deAna, 'juan')).toBe(false)
  })

  it('la cita de Ana sí le tapa la hora a Ana', () => {
    expect(bookingBlocksProfessional(deAna, 'ana')).toBe(true)
  })

  // Las de antes de que hubiera equipo no tienen dueño: no sabemos quién las iba a
  // atender, así que le bloquean la hora a cualquiera.
  it('una cita sin dueño le tapa la hora a todos', () => {
    expect(bookingBlocksProfessional(sinDueno, 'juan')).toBe(true)
    expect(bookingBlocksProfessional(sinDueno, 'ana')).toBe(true)
  })

  // Las dos formas tienen que estar de acuerdo sobre cuándo NO filtran, que es la
  // mitad conservadora de la asimetría.
  it('coincide con bookingScopeCondition en cuándo no filtra', () => {
    for (const id of [null, '', 'juan']) {
      const filtraEnPrisma = Object.keys(bookingScopeCondition(id)).length > 0
      const filtraEnMemoria = !bookingBlocksProfessional(deAna, id)
      expect(filtraEnMemoria, String(id)).toBe(filtraEnPrisma)
    }
  })
})

/**
 * La herencia en memoria, que es la que usa "cualquiera disponible" para repartir una
 * sola lectura entre varias personas. Tiene que dar lo MISMO que `resolveRuleScope` +
 * `resolveAvailabilityRules`, que es la versión en SQL de la misma regla.
 */
describe('rulesForProfessional', () => {
  const salon = { professionalId: null, dayOfWeek: 1, isActive: true }
  const salonMartes = { professionalId: null, dayOfWeek: 2, isActive: true }
  const deAna = { professionalId: 'ana', dayOfWeek: 1, isActive: true }
  const deJuan = { professionalId: 'juan', dayOfWeek: 1, isActive: true }

  it('quien tiene filas propias se rige por las suyas, y sólo por las suyas', () => {
    expect(rulesForProfessional([salon, salonMartes, deAna, deJuan], 'ana')).toEqual([deAna])
  })

  it('quien no tiene ninguna hereda el horario del salón', () => {
    expect(rulesForProfessional([salon, salonMartes, deAna], 'juan')).toEqual([salon, salonMartes])
  })

  /**
   * El borde que invierte el sentido, igual que en `resolveRuleScope`: la EXISTENCIA
   * se pregunta sin mirar `isActive`. Alguien con su único día cerrado está cerrado; si
   * la existencia filtrara los activos, quedaría abierto en el horario del salón.
   */
  it('una semana entera cerrada es horario propio, no herencia', () => {
    const anaCerrada = { professionalId: 'ana', dayOfWeek: 1, isActive: false }
    expect(rulesForProfessional([salon, anaCerrada], 'ana')).toEqual([])
  })

  // Y lo que devuelve son los días que SÍ atiende: un día cerrado del salón no puede
  // salir de acá como si estuviera abierto.
  it('devuelve sólo los días activos', () => {
    const salonDomingoCerrado = { professionalId: null, dayOfWeek: 0, isActive: false }
    expect(rulesForProfessional([salon, salonDomingoCerrado], 'juan')).toEqual([salon])
  })
})

/**
 * El `where` de "las citas que ocupan cupo ese día". Vive junto porque la lista de
 * estados no está cerrada —`pending_confirmation` ocupa para la app aunque el EXCLUDE
 * de la base lo ignore— y lo comparten los tres lectores de horarios y el reparto.
 */
describe('bookingsOfDayWhere', () => {
  const inicio = new Date('2026-06-15T04:00:00Z')
  const fin = new Date('2026-06-16T03:59:59Z')

  it('acota por SOLAPE con el día, no por fecha de creación', () => {
    expect(bookingsOfDayWhere('biz-1', inicio, fin)).toMatchObject({
      businessId: 'biz-1',
      startDateTime: { lte: fin },
      endDateTime: { gte: inicio },
    })
  })

  // Las liberadas no ocupan: una cancelada no le tapa la hora a nadie.
  it('deja afuera los estados liberados y adentro los que ocupan', () => {
    const where = bookingsOfDayWhere('biz-1', inicio, fin)
    const fuera = (where.status as { notIn: string[] }).notIn
    expect(fuera).toContain('cancelled')
    expect(fuera).toContain('expired')
    expect(fuera).not.toContain('confirmed')
    expect(fuera).not.toContain('pending_confirmation')
  })
})
