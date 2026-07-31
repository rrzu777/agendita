import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_WEEKLY_SCHEDULE,
  projectWeek,
  materializeProfessionalSchedule,
  scheduleLockKey,
  setWeekday,
} from '@/lib/availability/weekly-schedule'
import type { Prisma } from '@prisma/client'

const mockLock = vi.fn()
vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryXactLock: (...a: unknown[]) => mockLock(...a),
}))

const BIZ = 'biz-1'
const JUAN = 'juan'

type SalonRule = { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }

/**
 * Una tx que registra el orden de las llamadas. El orden importa: el lock tiene que
 * tomarse ANTES de contar, o dos pestañas leen las dos "no tiene horario propio".
 */
function makeTx(opts: { own?: number; salon?: SalonRule[]; updated?: number } = {}) {
  const calls: string[] = []
  const createMany = vi.fn(async (_args: { data: Record<string, unknown>[] }) => {
    calls.push('createMany')
    return { count: _args.data.length }
  })
  const create = vi.fn(async () => {
    calls.push('create')
    return {}
  })
  const updateMany = vi.fn(async () => {
    calls.push('updateMany')
    return { count: opts.updated ?? 1 }
  })
  const tx = {
    availabilityRule: {
      count: vi.fn(async () => {
        calls.push('count')
        return opts.own ?? 0
      }),
      create,
      updateMany,
      findMany: vi.fn(async () => {
        calls.push('findMany')
        return opts.salon ?? []
      }),
      createMany,
    },
  } as unknown as Prisma.TransactionClient
  return { tx, calls, createMany, create, updateMany }
}

const semanaDelSalon: SalonRule[] = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '10:00', endTime: '15:00', isActive: false },
]

describe('projectWeek', () => {
  it('devuelve los 7 días, de domingo a sábado', () => {
    const week = projectWeek(semanaDelSalon)
    expect(week).toHaveLength(7)
    expect(week.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  // La ausencia de fila es "cerrado" en todo el proyecto: el domingo no existe en la
  // siembra y no puede aparecer abierto por proyectarlo.
  it('el día sin fila sale cerrado', () => {
    const domingo = projectWeek(semanaDelSalon)[0]
    expect(domingo.isActive).toBe(false)
  })

  it('conserva el isActive de la fila que sí existe', () => {
    const week = projectWeek(semanaDelSalon)
    expect(week[6]).toMatchObject({ startTime: '10:00', endTime: '15:00', isActive: false })
    expect(week[1].isActive).toBe(true)
  })

  // Sin filas del salón —un negocio en estado imposible— la proyección no puede
  // devolver menos de 7 días: `materializeProfessionalSchedule` cuenta lo que escribió
  // para saber si la persona ya tiene horario, y un createMany vacío la dejaría
  // heredando para siempre, materializando de nuevo en cada guardado.
  it('sin ninguna fila igual devuelve 7 días, todos cerrados', () => {
    const week = projectWeek([])
    expect(week).toHaveLength(7)
    expect(week.every((d) => !d.isActive)).toBe(true)
    // Y con horas de relleno usables: el día que la dueña lo abra ya trae algo escrito.
    expect(week[1]).toMatchObject({ startTime: '09:00', endTime: '18:00' })
  })

  /**
   * El guard que impide que la pantalla de una persona pueda editar el horario del
   * salón: cuando hereda, las filas que se le muestran son las del salón. Si sus ids
   * viajaran, el editor tendría en la mano exactamente lo que hace falta para pisarlas.
   */
  it('no deja pasar el id de la regla de origen', () => {
    const conId = semanaDelSalon.map((r, i) => ({ ...r, id: `regla-salon-${i}` }))
    for (const day of projectWeek(conId)) {
      expect(Object.keys(day).sort()).toEqual(['dayOfWeek', 'endTime', 'isActive', 'startTime'])
    }
  })
})

describe('materializeProfessionalSchedule', () => {
  it('no hace nada si la persona ya tiene horario propio', async () => {
    const { tx, createMany } = makeTx({ own: 7 })
    await materializeProfessionalSchedule(tx, BIZ, JUAN)
    expect(createMany).not.toHaveBeenCalled()
  })

  /**
   * **El test de regresión del track.** La herencia es todo-o-nada: en cuanto exista
   * una fila propia, los días que no se copiaron NO vuelven al horario del salón,
   * quedan cerrados. Materializar sólo el día editado dejaría a esa persona sin
   * atender el resto de la semana, en silencio.
   */
  it('copia la semana ENTERA de una sola vez, no el día que se está editando', async () => {
    const { tx, createMany } = makeTx({ own: 0, salon: semanaDelSalon })
    await materializeProfessionalSchedule(tx, BIZ, JUAN)

    expect(createMany).toHaveBeenCalledTimes(1)
    const rows = createMany.mock.calls[0][0].data as unknown as { dayOfWeek: number }[]
    expect(rows).toHaveLength(7)
    expect(rows.map((r) => r.dayOfWeek).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('las filas copiadas son de esa persona y de ese negocio', async () => {
    const { tx, createMany } = makeTx({ own: 0, salon: semanaDelSalon })
    await materializeProfessionalSchedule(tx, BIZ, JUAN)

    const rows = createMany.mock.calls[0][0].data as unknown as { businessId: string; professionalId: string }[]
    expect(rows.every((r) => r.businessId === BIZ && r.professionalId === JUAN)).toBe(true)
  })

  it('copia el horario del salón tal cual, incluidos los días cerrados', async () => {
    const { tx, createMany } = makeTx({ own: 0, salon: semanaDelSalon })
    await materializeProfessionalSchedule(tx, BIZ, JUAN)

    const rows = createMany.mock.calls[0][0].data as unknown as {
      dayOfWeek: number; startTime: string; endTime: string; isActive: boolean
    }[]
    expect(rows.find((r) => r.dayOfWeek === 1)).toMatchObject({ startTime: '09:00', endTime: '18:00', isActive: true })
    expect(rows.find((r) => r.dayOfWeek === 6)).toMatchObject({ startTime: '10:00', endTime: '15:00', isActive: false })
    expect(rows.find((r) => r.dayOfWeek === 0)?.isActive).toBe(false)
  })

  // Copia sólo el horario DEL SALÓN: si el where trajera las filas de todo el mundo,
  // una persona con horario propio se lo pasaría a la siguiente que se materialice.
  it('lee el horario del salón, no el de todo el equipo', async () => {
    const { tx } = makeTx({ own: 0, salon: semanaDelSalon })
    await materializeProfessionalSchedule(tx, BIZ, JUAN)

    expect(tx.availabilityRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BIZ, professionalId: null } }),
    )
  })

  /**
   * Dos pestañas guardando dos días distintos leerían las dos "no tiene horario
   * propio" y copiarían la semana dos veces. `AvailabilityRule` no tiene unique sobre
   * (negocio, persona, día), así que la base no lo atajaría: 14 filas y la mitad de
   * los días con dos horarios.
   */
  it('toma el lock ANTES de preguntar si ya tiene horario', async () => {
    mockLock.mockClear()
    const { tx, calls } = makeTx({ own: 0, salon: semanaDelSalon })
    mockLock.mockImplementation(() => { calls.push('lock') })

    await materializeProfessionalSchedule(tx, BIZ, JUAN)

    expect(calls).toEqual(['lock', 'count', 'findMany', 'createMany'])
    expect(mockLock).toHaveBeenCalledWith(tx, `availability-rules:${BIZ}:p:${JUAN}`)
  })
})

describe('scheduleLockKey', () => {
  // El salón y una persona se escriben en paralelo sin pisarse, pero el salón tampoco
  // puede quedar sin llave: abrir un día que no tiene fila también es "leer y crear".
  it('el salón tiene su propia llave, distinta de la de cualquier persona', () => {
    expect(scheduleLockKey(BIZ, null)).not.toBe(scheduleLockKey(BIZ, JUAN))
  })

  // Un id que fuera literalmente `salon` no puede colisionar con el salón.
  it('el id de una persona va prefijado', () => {
    expect(scheduleLockKey(BIZ, 'salon')).not.toBe(scheduleLockKey(BIZ, null))
  })
})

describe('setWeekday', () => {
  const lunes = { dayOfWeek: 1, startTime: '10:00', endTime: '16:00', isActive: true }

  it('con una persona, materializa antes de escribir el día', async () => {
    const { tx, calls } = makeTx({ own: 0, salon: semanaDelSalon })
    mockLock.mockImplementation(() => { calls.push('lock') })

    await setWeekday(tx, BIZ, JUAN, lunes)

    expect(calls).toEqual(['lock', 'lock', 'count', 'findMany', 'createMany', 'updateMany'])
  })

  // El salón no hereda de nadie: materializarlo no significaría nada, y copiar su
  // propio horario encima suyo sería duplicarlo.
  it('con el salón no materializa nada', async () => {
    const { tx, createMany, updateMany } = makeTx()

    await setWeekday(tx, BIZ, null, lunes)

    expect(createMany).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith({
      where: { businessId: BIZ, professionalId: null, dayOfWeek: 1 },
      data: { startTime: '10:00', endTime: '16:00', isActive: true },
    })
  })

  /**
   * **El bug que arregla la escritura unificada.** El negocio se siembra sin fila de
   * domingo; el editor viejo guardaba por id de regla, y sin fila no hay id: un negocio
   * que atiende domingo no tenía forma de decirlo desde la pantalla.
   */
  it('crea la fila del día que no existía', async () => {
    const { tx, create } = makeTx({ updated: 0 })

    await setWeekday(tx, BIZ, null, { dayOfWeek: 0, startTime: '11:00', endTime: '15:00', isActive: true })

    expect(create).toHaveBeenCalledWith({
      data: { businessId: BIZ, professionalId: null, dayOfWeek: 0, startTime: '11:00', endTime: '15:00', isActive: true },
    })
  })

  it('no crea nada si el día ya existía', async () => {
    const { tx, create } = makeTx({ own: 7, updated: 1 })

    await setWeekday(tx, BIZ, JUAN, lunes)

    expect(create).not.toHaveBeenCalled()
  })

  /**
   * Filas propias PARCIALES —hoy ningún camino de la app las crea, pero un backfill
   * sí— que la materialización nunca completa, porque tres filas ya cuentan como
   * "tiene horario propio". Crear la que falta repara ese estado en vez de guardar
   * nada y decir "guardado".
   */
  it('con filas propias parciales completa el día que falta', async () => {
    const { tx, createMany, create } = makeTx({ own: 3, updated: 0 })

    await setWeekday(tx, BIZ, JUAN, lunes)

    expect(createMany).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({
      data: { businessId: BIZ, professionalId: JUAN, dayOfWeek: 1, startTime: '10:00', endTime: '16:00', isActive: true },
    })
  })
})

describe('DEFAULT_WEEKLY_SCHEDULE', () => {
  // Estaba escrito dos veces a mano (create-for-user, recover-business). Que no se
  // vuelva a mover una sola de las dos copias.
  it('es lunes a viernes 09–18 y sábado 10–15, sin domingo', () => {
    expect(DEFAULT_WEEKLY_SCHEDULE.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6])
    expect(DEFAULT_WEEKLY_SCHEDULE.find((d) => d.dayOfWeek === 6)).toEqual({
      dayOfWeek: 6, startTime: '10:00', endTime: '15:00',
    })
  })
})
