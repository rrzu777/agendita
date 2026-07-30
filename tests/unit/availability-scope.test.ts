import { describe, it, expect, vi } from 'vitest'
import {
  blockScopeFor,
  bookingScopeCondition,
  hasOwnAvailabilityRules,
  resolveAvailabilityRules,
  resolveDayRule,
} from '@/lib/availability/scope'
import { blockScopeCondition } from '@/lib/availability/effective-blocks'

// Estos tests miran los WHERE que se arman, no filas de una base. Es a propósito:
// lo que puede salir mal acá no es el resultado de una query sino el filtro que se
// le pasa — un `undefined` de más y el filtro deja de filtrar.

type RuleRow = { dayOfWeek: number; isActive: boolean; professionalId: string | null }

function fakeClient(rows: RuleRow[]) {
  const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter(
      (r) =>
        r.professionalId === (where.professionalId as string | null) &&
        (where.isActive === undefined || r.isActive === where.isActive),
    ),
  )
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find(
      (r) =>
        r.professionalId === (where.professionalId as string | null) &&
        r.dayOfWeek === where.dayOfWeek &&
        r.isActive === where.isActive,
    ) ?? null,
  )
  const count = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter((r) => r.professionalId === (where.professionalId as string | null)).length,
  )
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

describe('hasOwnAvailabilityRules', () => {
  it('es false sin filas propias y true con una sola', async () => {
    const sin = fakeClient([negocio(1)])
    expect(await hasOwnAvailabilityRules(sin.client, 'biz', 'juan')).toBe(false)

    const con = fakeClient([negocio(1), deJuan(6)])
    expect(await hasOwnAvailabilityRules(con.client, 'biz', 'juan')).toBe(true)
  })

  // El borde que invierte el sentido de todo: si la pregunta filtrara por isActive,
  // cerrarle la semana entera a alguien lo dejaría "sin filas propias" y por lo
  // tanto ABIERTO en el horario del salón.
  it('no filtra por isActive: una semana entera cerrada sigue siendo horario propio', async () => {
    const { client, count } = fakeClient([negocio(1), deJuan(1, false), deJuan(2, false)])
    expect(await hasOwnAvailabilityRules(client, 'biz', 'juan')).toBe(true)
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
