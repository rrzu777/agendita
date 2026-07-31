import { prisma } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'
import { expandSeries, type EffectiveBlock } from '@/lib/calendar/expand-series'
import { getLocalDateStr, startOfLocalDay } from '@/lib/availability/timezone'
import { blockScopeCondition, type BlockScope } from '@/lib/availability/scope'

export type { EffectiveBlock } from '@/lib/calendar/expand-series'

/**
 * Devuelve los bloqueos efectivos (sueltos + ocurrencias de series activas)
 * que solapan el rango [rangeStart, rangeEnd]. Forma compatible con los
 * consumidores existentes: { startDateTime, endDateTime, reason }.
 *
 * `client` existe para que la validación al escribir una reserva —que corre dentro de
 * una transacción y tiene que ver lo mismo que ella— use ESTA función en vez de
 * repetir las dos queries y el fan-out de series por su cuenta. Eran las dos puntas
 * del mismo contrato: el funnel ofrecía con una y la escritura validaba con la otra.
 */
export async function getEffectiveBlocks({
  businessId,
  rangeStart,
  rangeEnd,
  timezone,
  scope,
  client = prisma,
}: {
  businessId: string
  rangeStart: Date
  rangeEnd: Date
  timezone: string
  scope: BlockScope
  client?: PrismaClient | Prisma.TransactionClient
}): Promise<EffectiveBlock[]> {
  // `until` se guarda como marcador de día (00:00 local). Comparar contra el
  // instante intra-día `rangeStart` descartaría el último día de una serie acotada
  // (p.ej. slot 13:00 con until = ese día 00:00). Comparamos contra el piso del
  // día local para que la query sea un SUPERCONJUNTO seguro; expandSeries filtra
  // el día con precisión.
  const rangeStartDay = startOfLocalDay(getLocalDateStr(rangeStart, timezone), timezone)
  const rangeEndDay = startOfLocalDay(getLocalDateStr(rangeEnd, timezone), timezone)
  const condition = blockScopeCondition(scope)

  // Una excepción puede MOVER su ocurrencia a otro día, incluso fuera de
  // [anchorDate, until] (el diálogo deja elegir cualquier fecha). Es el mismo
  // criterio que usa `expandSeries` para repescarla, escrito acá porque si la
  // serie no entra en esta query no hay nada que repescar.
  const excepcionMovidaAlRango = {
    isSkipped: false,
    startDateTime: { lte: rangeEnd },
    endDateTime: { gte: rangeStart },
  }

  const [oneOff, series] = await Promise.all([
    client.timeBlock.findMany({
      where: {
        businessId,
        startDateTime: { lte: rangeEnd },
        endDateTime: { gte: rangeStart },
        AND: condition,
      },
      orderBy: { startDateTime: 'asc' },
    }),
    client.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        AND: condition,
        OR: [
          {
            anchorDate: { lte: rangeEnd },
            OR: [{ until: null }, { until: { gte: rangeStartDay } }],
          },
          { exceptions: { some: excepcionMovidaAlRango } },
        ],
      },
      // Acotadas y no todas: `expandSeries` necesita las del rango barrido (por su
      // día original, que es como se guardan los skips y los cambios de hora) más
      // las movidas hacia el rango. Traerlas todas hacía que cada consulta de
      // disponibilidad recorriera el historial completo de la serie.
      include: {
        exceptions: {
          where: {
            OR: [
              { occurrenceDate: { gte: rangeStartDay, lte: rangeEndDay } },
              excepcionMovidaAlRango,
            ],
          },
        },
      },
    }),
  ])

  const blocks: EffectiveBlock[] = oneOff.map((b) => ({
    id: b.id,
    startDateTime: b.startDateTime,
    endDateTime: b.endDateTime,
    reason: b.reason,
    overlapToleranceMinutes: b.overlapToleranceMinutes,
    professionalId: b.professionalId,
  }))

  for (const s of series) {
    blocks.push(...expandSeries(s, s.exceptions, rangeStart, rangeEnd, timezone))
  }

  return blocks
}
