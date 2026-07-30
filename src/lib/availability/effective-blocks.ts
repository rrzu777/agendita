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
  const condition = blockScopeCondition(scope)

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
        anchorDate: { lte: rangeEnd },
        OR: [{ until: null }, { until: { gte: rangeStartDay } }],
        AND: condition,
      },
      include: { exceptions: true },
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
