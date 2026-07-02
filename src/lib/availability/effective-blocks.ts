import { prisma } from '@/lib/db'
import { expandSeries, type EffectiveBlock } from '@/lib/calendar/expand-series'

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
        OR: [{ until: null }, { until: { gte: rangeStart } }],
      },
      include: { exceptions: true },
    }),
  ])

  const blocks: EffectiveBlock[] = oneOff.map((b) => ({
    id: b.id,
    startDateTime: b.startDateTime,
    endDateTime: b.endDateTime,
    reason: b.reason,
  }))

  for (const s of series) {
    blocks.push(...expandSeries(s, s.exceptions, rangeStart, rangeEnd, timezone))
  }

  return blocks
}
