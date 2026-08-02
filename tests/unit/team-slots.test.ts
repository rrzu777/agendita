import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServiceModality } from '@prisma/client'

// `generateSlots` NO se mockea: lo que se prueba es que la unión de verdad —con la
// grilla re-anclada en cada obstáculo— quede bien deduplicada y ordenada.
const mockPrisma = {
  professional: { findMany: vi.fn() },
  availabilityRule: { findMany: vi.fn() },
  booking: { findMany: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

const getEffectiveBlocks = vi.fn()
vi.mock('@/lib/availability/effective-blocks', () => ({
  getEffectiveBlocks: (...args: unknown[]) => getEffectiveBlocks(...args),
}))

const { getTeamAvailableSlots } = await import('@/lib/availability/team-slots')

// Lunes. En junio Santiago está en UTC-4, así que la regla 09:00–12:00 local es
// 13:00Z–16:00Z y un servicio de 60' da tres horas: 13, 14 y 15.
const DIA = new Date('2026-06-15T15:00:00Z')
const LUNES = 1
const SERVICE = { id: 'svc-1', durationMinutes: 60, modalities: ['on_site'] as ServiceModality[] }

const OPCIONES = {
  timezone: 'America/Santiago',
  now: new Date('2026-06-01T12:00:00Z'),
  bookingWindowDays: 90,
  slotStepMinutes: null,
}

function persona(id: string, extra: Partial<{ modalities: ServiceModality[]; serviceIds: string[] }> = {}) {
  return {
    id,
    name: id,
    bio: null,
    modalities: extra.modalities ?? (['on_site'] as ServiceModality[]),
    services: (extra.serviceIds ?? ['svc-1']).map((sid) => ({ id: sid })),
  }
}

function regla(professionalId: string | null, startTime = '09:00', endTime = '12:00', isActive = true) {
  return { professionalId, dayOfWeek: LUNES, startTime, endTime, isActive }
}

function pedir(requestedModality: ServiceModality | null = 'on_site') {
  return getTeamAvailableSlots({
    businessId: 'biz-1',
    service: SERVICE,
    date: DIA,
    requestedModality,
    timezone: 'America/Santiago',
    slotOptions: OPCIONES,
  })
}

const horas = (slots: { start: Date }[]) => slots.map((s) => s.start.toISOString().slice(11, 16))

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.professional.findMany.mockResolvedValue([persona('juan'), persona('ana')])
  mockPrisma.availabilityRule.findMany.mockResolvedValue([regla(null)])
  mockPrisma.booking.findMany.mockResolvedValue([])
  getEffectiveBlocks.mockResolvedValue([])
})

describe('los horarios de "cualquiera disponible"', () => {
  /**
   * Es el punto de la feature: dos personas libres a las 15:00 son UN horario en
   * pantalla. Sin deduplicar, la clienta ve la misma hora repetida tantas veces como
   * gente haya en el equipo.
   */
  it('une los horarios del equipo sin repetir instantes', async () => {
    expect(horas(await pedir())).toEqual(['13:00', '14:00', '15:00'])
  })

  /**
   * La cita de Juan no le tapa la hora a Ana. Éste es el motivo de ser de la unión:
   * a las 13:00 sigue habiendo con quién, aunque el primero esté ocupado.
   */
  it('una hora ocupada por uno sigue estando si el otro está libre', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{
      professionalId: 'juan',
      status: 'confirmed',
      holdExpiresAt: null,
      paymentStatus: 'unpaid',
      paymentMethod: null,
      startDateTime: new Date('2026-06-15T13:00:00Z'),
      endDateTime: new Date('2026-06-15T14:00:00Z'),
    }])

    expect(horas(await pedir())).toEqual(['13:00', '14:00', '15:00'])
  })

  it('y desaparece cuando la tienen ocupada los dos', async () => {
    mockPrisma.booking.findMany.mockResolvedValue(
      ['juan', 'ana'].map((professionalId) => ({
        professionalId,
        status: 'confirmed',
        holdExpiresAt: null,
        paymentStatus: 'unpaid',
        paymentMethod: null,
        startDateTime: new Date('2026-06-15T13:00:00Z'),
        endDateTime: new Date('2026-06-15T14:00:00Z'),
      })),
    )

    expect(horas(await pedir())).toEqual(['14:00', '15:00'])
  })

  /**
   * Los bloqueos se traen con alcance `everyone` —una sola consulta para todo el
   * equipo— y se reparten en memoria. Si el reparto fallara, las vacaciones de una
   * sola persona cerrarían el local, que es exactamente lo que advierte `BlockScope`.
   */
  it('el bloqueo de una persona no cierra la hora para el resto', async () => {
    getEffectiveBlocks.mockResolvedValue([{
      id: 'blk-1',
      professionalId: 'juan',
      startDateTime: new Date('2026-06-15T13:00:00Z'),
      endDateTime: new Date('2026-06-15T14:00:00Z'),
      reason: null,
      overlapToleranceMinutes: 0,
    }])

    expect(horas(await pedir())).toEqual(['13:00', '14:00', '15:00'])
    expect(getEffectiveBlocks.mock.calls[0][0]).toMatchObject({ scope: { kind: 'everyone' } })
  })

  it('el del negocio sí, porque le toca a todo el mundo', async () => {
    getEffectiveBlocks.mockResolvedValue([{
      id: 'blk-1',
      professionalId: null,
      startDateTime: new Date('2026-06-15T13:00:00Z'),
      endDateTime: new Date('2026-06-15T14:00:00Z'),
      reason: 'Almuerzo',
      overlapToleranceMinutes: 0,
    }])

    expect(horas(await pedir())).toEqual(['14:00', '15:00'])
  })

  /**
   * Ana tiene horario propio y Juan hereda el del salón. Es la misma herencia
   * todo-o-nada de `resolveRuleScope`, resuelta en memoria: si se rompiera, Ana
   * quedaría atendiendo en el horario del salón sin que nada fallara.
   */
  it('cada persona con su horario, y quien no tiene hereda el del salón', async () => {
    mockPrisma.availabilityRule.findMany.mockResolvedValue([
      regla(null, '09:00', '11:00'),
      regla('ana', '14:00', '16:00'),
    ])

    // Juan hereda 09–11 local (13Z, 14Z) y Ana abre 14–16 local (18Z, 19Z). Las
    // cuatro tienen que estar: si la herencia se rompiera para un lado sobrarían las
    // de Ana, y para el otro sobrarían las de Juan.
    expect(horas(await pedir())).toEqual(['13:00', '14:00', '18:00', '19:00'])
  })

  /**
   * La unión no cae en una grilla regular: cada persona re-ancla sus slots en el
   * borde de sus propias citas, así que sin ordenar explícitamente la lista sale en
   * el orden en que se recorrió el equipo.
   */
  it('sale ordenada aunque el equipo aporte horas intercaladas', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([{
      professionalId: 'juan',
      status: 'confirmed',
      holdExpiresAt: null,
      paymentStatus: 'unpaid',
      paymentMethod: null,
      startDateTime: new Date('2026-06-15T13:00:00Z'),
      endDateTime: new Date('2026-06-15T13:30:00Z'),
    }])

    // Juan re-ancla en 13:30Z; Ana sigue en la grilla de apertura.
    expect(horas(await pedir())).toEqual(['13:00', '13:30', '14:00', '14:30', '15:00'])
  })

  it('sólo suma a quien hace ese servicio', async () => {
    mockPrisma.professional.findMany.mockResolvedValue([persona('juan', { serviceIds: ['svc-2'] })])

    expect(await pedir()).toEqual([])
  })

  /**
   * La modalidad se re-deriva contra las del servicio, igual que al escribir: quien
   * no viaja no puede aportar horarios a una reserva a domicilio.
   */
  it('sólo suma a quien atiende en esa modalidad', async () => {
    SERVICE.modalities = ['on_site', 'at_home']
    mockPrisma.professional.findMany.mockResolvedValue([
      persona('juan', { modalities: ['on_site'] }),
      persona('ana', { modalities: ['on_site', 'at_home'] }),
    ])
    mockPrisma.availabilityRule.findMany.mockResolvedValue([regla(null), regla('juan', '14:00', '16:00')])

    // Si Juan colara, aparecerían sus 18:00Z/19:00Z.
    expect(horas(await pedir('at_home'))).toEqual(['13:00', '14:00', '15:00'])
    SERVICE.modalities = ['on_site']
  })

  it('sin equipo elegible no hay horarios que unir', async () => {
    mockPrisma.professional.findMany.mockResolvedValue([])

    expect(await pedir()).toEqual([])
  })
})
