import { prisma } from '@/lib/db'
import { expandSeries, type EffectiveBlock } from '@/lib/calendar/expand-series'
import { getLocalDateStr, startOfLocalDay } from '@/lib/availability/timezone'

export type { EffectiveBlock } from '@/lib/calendar/expand-series'

/**
 * De quién son los bloqueos que cuentan. Es un tipo y no un `professionalId`
 * opcional por tres motivos, y los tres ya mordieron en este repo:
 *
 * 1. **`null` y "todos" no son lo mismo.** Un bloqueo con `professionalId = null`
 *    cierra para todo el negocio; los de una persona son sólo suyos. El
 *    calendario del panel tiene que MOSTRAR los de todo el equipo, y el cálculo
 *    de slots del negocio tiene que IGNORARLOS —las vacaciones de Juan no cierran
 *    el local—. Con un solo `null` para las dos cosas, una de las dos queda mal.
 * 2. **Un `undefined` en un `where` de Prisma no filtra: matchea todo.** Un
 *    parámetro obligatorio con casos nombrados no puede llegar en `undefined`.
 * 3. **El orden posicional era una trampa**: `timezone` y `professionalId` son los
 *    dos `string` y cambiarlos de lugar compilaba. Por eso la firma es un objeto.
 */
export type BlockScope =
  /** Sólo los del negocio (`professionalId = null`). El comportamiento de siempre. */
  | { kind: 'business' }
  /** Los del negocio MÁS los de esa persona: los dos la dejan sin atender. */
  | { kind: 'professional'; professionalId: string }
  /** Todos, de cualquiera. Para MOSTRAR (el calendario), nunca para calcular slots. */
  | { kind: 'everyone' }

/**
 * Cláusula de `professionalId` para un alcance, pensada para ir adentro de un
 * `AND` y NO desparramada con spread: la query de series ya tiene su propio `OR`
 * (el de `until`) y un segundo `OR` en el mismo nivel lo sobrescribe en silencio,
 * con lo que la serie perdería el filtro de fecha de fin.
 */
export function blockScopeCondition(scope: BlockScope): { professionalId?: string | null; OR?: { professionalId: string | null }[] } {
  switch (scope.kind) {
    case 'business':
      return { professionalId: null }
    case 'professional':
      return { OR: [{ professionalId: null }, { professionalId: scope.professionalId }] }
    case 'everyone':
      return {}
  }
}

/**
 * Devuelve los bloqueos efectivos (sueltos + ocurrencias de series activas)
 * que solapan el rango [rangeStart, rangeEnd]. Forma compatible con los
 * consumidores existentes: { startDateTime, endDateTime, reason }.
 */
export async function getEffectiveBlocks({
  businessId,
  rangeStart,
  rangeEnd,
  timezone,
  scope,
}: {
  businessId: string
  rangeStart: Date
  rangeEnd: Date
  timezone: string
  scope: BlockScope
}): Promise<EffectiveBlock[]> {
  // `until` se guarda como marcador de día (00:00 local). Comparar contra el
  // instante intra-día `rangeStart` descartaría el último día de una serie acotada
  // (p.ej. slot 13:00 con until = ese día 00:00). Comparamos contra el piso del
  // día local para que la query sea un SUPERCONJUNTO seguro; expandSeries filtra
  // el día con precisión.
  const rangeStartDay = startOfLocalDay(getLocalDateStr(rangeStart, timezone), timezone)
  const condition = blockScopeCondition(scope)

  const [oneOff, series] = await Promise.all([
    prisma.timeBlock.findMany({
      where: {
        businessId,
        startDateTime: { lte: rangeEnd },
        endDateTime: { gte: rangeStart },
        AND: [condition],
      },
      orderBy: { startDateTime: 'asc' },
    }),
    prisma.timeBlockSeries.findMany({
      where: {
        businessId,
        isActive: true,
        anchorDate: { lte: rangeEnd },
        OR: [{ until: null }, { until: { gte: rangeStartDay } }],
        AND: [condition],
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
