import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_WEEKLY_SCHEDULE,
  projectWeek,
  materializeProfessionalSchedule,
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
function makeTx(opts: { own?: number; salon?: SalonRule[] } = {}) {
  const calls: string[] = []
  const createMany = vi.fn(async (_args: { data: Record<string, unknown>[] }) => {
    calls.push('createMany')
    return { count: _args.data.length }
  })
  const tx = {
    availabilityRule: {
      count: vi.fn(async () => {
        calls.push('count')
        return opts.own ?? 0
      }),
      findMany: vi.fn(async () => {
        calls.push('findMany')
        return opts.salon ?? []
      }),
      createMany,
    },
  } as unknown as Prisma.TransactionClient
  return { tx, calls, createMany }
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

    expect(calls[0]).toBe('lock')
    expect(calls).toEqual(['lock', 'count', 'findMany', 'createMany'])
    expect(mockLock).toHaveBeenCalledWith(tx, `availability-rules:${BIZ}:${JUAN}`)
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
