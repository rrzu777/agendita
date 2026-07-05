import { prisma } from '@/lib/db'
import { expandSeries, type EffectiveBlock } from '@/lib/calendar/expand-series'
import { getLocalDateStr, startOfLocalDay } from '@/lib/availability/timezone'

export type { EffectiveBlock } from '@/lib/calendar/expand-series'

/**
 * Devuelve los bloqueos efectivos (sueltos + ocurrencias de series activas)
 * que solapan el rango [rangeStart, rangeEnd]. Forma compatible con los
 * consumidores existentes: { startDateTime, endDateTime, reason }.
 */
export async function getEffectiveBlocks(
  businessId: string,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Promise<EffectiveBlock[]> {
  // `until` se guarda como marcador de día (00:00 local). Comparar contra el
  // instante intra-día `rangeStart` descartaría el último día de una serie acotada
  // (p.ej. slot 13:00 con until = ese día 00:00). Comparamos contra el piso del
  // día local para que la query sea un SUPERCONJUNTO seguro; expandSeries filtra
  // el día con precisión.
  const rangeStartDay = startOfLocalDay(getLocalDateStr(rangeStart, timezone), timezone)

  const [oneOff, series] = await Promise.all([
    prisma.timeBlock.findMany({
      where: { businessId, startDateTime: { lte: rangeEnd }, endDateTime: { gte: rangeStart } },
      orderBy: { startDateTime: 'asc' },
    }),
    prisma.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: rangeEnd },
        OR: [{ until: null }, { until: { gte: rangeStartDay } }],
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
  }))

  for (const s of series) {
    blocks.push(...expandSeries(s, s.exceptions, rangeStart, rangeEnd, timezone))
  }

  return blocks
}
