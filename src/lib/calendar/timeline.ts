import { formatInTimeZone } from 'date-fns-tz'
import { endOfLocalDay, localDateTimeToUtc, startOfLocalDay } from '@/lib/availability/timezone'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Minutos transcurridos desde la medianoche local del negocio (0–1439). */
export function localMinutesFromMidnight(date: Date, timeZone: string): number {
  const hh = parseInt(formatInTimeZone(date, timeZone, 'HH'), 10)
  const mm = parseInt(formatInTimeZone(date, timeZone, 'mm'), 10)
  return hh * 60 + mm
}

/** Clave de día local (yyyy-MM-dd) en la zona del negocio. */
export function localDayKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd')
}

export interface TimelineItem {
  startDateTime: string
  endDateTime: string
}

export interface PositionedItem<T> {
  item: T
  /** offset en minutos desde el inicio del eje */
  topMin: number
  /** duración real del intervalo, en minutos */
  heightMin: number
  /** columna asignada cuando hay solapes (0-based) */
  lane: number
  /** total de columnas en el cluster de solape */
  lanes: number
}

/** Tramo pintable dentro de un único día local. `item` conserva siempre el
 * intervalo original para que los drawers/editores nunca reciban fechas clippeadas. */
export interface TimelineSegment<T extends TimelineItem> {
  item: T
  dayKey: string
  segmentStart: Date
  segmentEnd: Date
  continuesFromPreviousDay: boolean
  continuesToNextDay: boolean
}

export interface PositionedSegment<T extends TimelineItem> {
  segment: TimelineSegment<T>
  topMin: number
  heightMin: number
  lane: number
  lanes: number
}

export interface TimelineTick {
  instant: Date
  offsetMin: number
  label: string
}

export interface TimelineAxis {
  start: Date
  end: Date
  durationMin: number
  ticks: TimelineTick[]
}

/** Intersecta intervalos UTC contra días locales reales y half-open. */
export function segmentItemsByLocalDays<T extends TimelineItem>(
  items: T[],
  dayKeys: string[],
  timeZone: string,
): TimelineSegment<T>[] {
  const segments: TimelineSegment<T>[] = []

  for (const dayKey of dayKeys) {
    const dayStart = startOfLocalDay(dayKey, timeZone)
    const dayEnd = new Date(endOfLocalDay(dayKey, timeZone).getTime() + 1)
    for (const item of items) {
      const originalStart = new Date(item.startDateTime)
      const originalEnd = new Date(item.endDateTime)
      if (
        !Number.isFinite(originalStart.getTime()) ||
        !Number.isFinite(originalEnd.getTime()) ||
        originalEnd <= originalStart ||
        originalStart >= dayEnd ||
        originalEnd <= dayStart
      ) continue

      const segmentStart = new Date(Math.max(originalStart.getTime(), dayStart.getTime()))
      const segmentEnd = new Date(Math.min(originalEnd.getTime(), dayEnd.getTime()))
      segments.push({
        item,
        dayKey,
        segmentStart,
        segmentEnd,
        continuesFromPreviousDay: originalStart < segmentStart,
        continuesToNextDay: originalEnd > segmentEnd,
      })
    }
  }

  return segments
}

function localHourInstant(dayKey: string, hour: number, timeZone: string, dayStart: Date, dayEnd: Date): Date {
  if (hour <= 0) return dayStart
  if (hour >= 24) return dayEnd
  return localDateTimeToUtc(dayKey, `${String(hour).padStart(2, '0')}:00`, timeZone)
}

/** Construye un eje sobre tiempo transcurrido real. En DST los ticks avanzan
 * por instantes, por eso saltan horas inexistentes y repiten las ambiguas. */
export function buildTimelineAxis<T extends TimelineItem>(
  dayKey: string,
  segments: TimelineSegment<T>[],
  timeZone: string,
  defaultStartHour = 8,
  defaultEndHour = 20,
): TimelineAxis {
  const dayStart = startOfLocalDay(dayKey, timeZone)
  const dayEnd = new Date(endOfLocalDay(dayKey, timeZone).getTime() + 1)
  const defaultStart = localHourInstant(dayKey, defaultStartHour, timeZone, dayStart, dayEnd)
  const defaultEnd = localHourInstant(dayKey, defaultEndHour, timeZone, dayStart, dayEnd)
  const earliest = Math.min(defaultStart.getTime(), ...segments.map((segment) => segment.segmentStart.getTime()))
  const latest = Math.max(defaultEnd.getTime(), ...segments.map((segment) => segment.segmentEnd.getTime()))
  const startOffset = Math.max(0, Math.floor((earliest - dayStart.getTime()) / HOUR_MS) * HOUR_MS)
  const endOffset = Math.min(
    dayEnd.getTime() - dayStart.getTime(),
    Math.ceil((latest - dayStart.getTime()) / HOUR_MS) * HOUR_MS,
  )
  const start = new Date(dayStart.getTime() + startOffset)
  const end = new Date(dayStart.getTime() + Math.max(startOffset + HOUR_MS, endOffset))

  const rawTicks: Array<Omit<TimelineTick, 'label'> & { clock: string; utcOffset: string }> = []
  for (let instantMs = start.getTime(); instantMs < end.getTime(); instantMs += HOUR_MS) {
    const instant = new Date(instantMs)
    rawTicks.push({
      instant,
      offsetMin: (instantMs - start.getTime()) / MINUTE_MS,
      clock: formatInTimeZone(instant, timeZone, 'HH:mm'),
      utcOffset: formatInTimeZone(instant, timeZone, 'xxx'),
    })
  }
  const clockCounts = new Map<string, number>()
  for (const tick of rawTicks) clockCounts.set(tick.clock, (clockCounts.get(tick.clock) ?? 0) + 1)
  const ticks = rawTicks.map(({ instant, offsetMin, clock, utcOffset }) => ({
    instant,
    offsetMin,
    label: (clockCounts.get(clock) ?? 0) > 1 ? `${clock} (${utcOffset})` : clock,
  }))

  return {
    start,
    end,
    durationMin: (end.getTime() - start.getTime()) / MINUTE_MS,
    ticks,
  }
}

/** Empaqueta tramos usando sus instantes UTC, no la lectura del reloj local. */
export function packSegmentLanes<T extends TimelineItem>(
  segments: TimelineSegment<T>[],
  axisStart: Date,
): PositionedSegment<T>[] {
  const positioned: PositionedSegment<T>[] = [...segments]
    .sort((a, b) => a.segmentStart.getTime() - b.segmentStart.getTime() || a.segmentEnd.getTime() - b.segmentEnd.getTime())
    .map((segment) => ({
      segment,
      topMin: (segment.segmentStart.getTime() - axisStart.getTime()) / MINUTE_MS,
      heightMin: (segment.segmentEnd.getTime() - segment.segmentStart.getTime()) / MINUTE_MS,
      lane: 0,
      lanes: 1,
    }))

  let i = 0
  while (i < positioned.length) {
    let clusterEnd = positioned[i].topMin + positioned[i].heightMin
    let j = i + 1
    while (j < positioned.length && positioned[j].topMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, positioned[j].topMin + positioned[j].heightMin)
      j += 1
    }

    const laneEnds: number[] = []
    for (const position of positioned.slice(i, j)) {
      const availableLane = laneEnds.findIndex((laneEnd) => position.topMin >= laneEnd)
      position.lane = availableLane === -1 ? laneEnds.length : availableLane
      laneEnds[position.lane] = position.topMin + position.heightMin
    }
    for (const position of positioned.slice(i, j)) position.lanes = laneEnds.length
    i = j
  }

  return positioned
}

/**
 * Calcula el rango horario [startHour, endHour) a mostrar en el eje.
 * Por defecto 8:00–20:00, expandiéndose si hay citas fuera de ese rango.
 */
export function computeHourRange(
  items: TimelineItem[],
  timeZone: string,
  defaultStart = 8,
  defaultEnd = 20,
): { startHour: number; endHour: number } {
  let startHour = defaultStart
  let endHour = defaultEnd
  for (const it of items) {
    const startMin = localMinutesFromMidnight(new Date(it.startDateTime), timeZone)
    const endMin = localMinutesFromMidnight(new Date(it.endDateTime), timeZone)
    startHour = Math.min(startHour, Math.floor(startMin / 60))
    // endMin puede ser 0 si termina justo a medianoche del día siguiente
    const effectiveEnd = endMin === 0 ? 24 * 60 : endMin
    endHour = Math.max(endHour, Math.ceil(effectiveEnd / 60))
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) }
}

/**
 * Asigna columnas (lanes) a items que se solapan, estilo Google Calendar.
 * Items que comparten franja horaria se reparten el ancho.
 */
export function packLanes<T extends TimelineItem>(
  items: T[],
  timeZone: string,
  axisStartHour: number,
): PositionedItem<T>[] {
  const axisStartMin = axisStartHour * 60

  const sorted = [...items].sort(
    (a, b) =>
      localMinutesFromMidnight(new Date(a.startDateTime), timeZone) -
      localMinutesFromMidnight(new Date(b.startDateTime), timeZone),
  )

  const positioned: PositionedItem<T>[] = sorted.map((item) => {
    const startMin = localMinutesFromMidnight(new Date(item.startDateTime), timeZone)
    const rawEnd = localMinutesFromMidnight(new Date(item.endDateTime), timeZone)
    const endMin = rawEnd <= startMin ? 24 * 60 : rawEnd
    return {
      item,
      topMin: startMin - axisStartMin,
      heightMin: endMin - startMin,
      lane: 0,
      lanes: 1,
    }
  })

  // Agrupar en clusters de solape y asignar columnas dentro de cada cluster.
  let i = 0
  while (i < positioned.length) {
    let clusterEnd = positioned[i].topMin + positioned[i].heightMin
    let j = i + 1
    while (j < positioned.length && positioned[j].topMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, positioned[j].topMin + positioned[j].heightMin)
      j += 1
    }

    const cluster = positioned.slice(i, j)
    const laneEnds: number[] = []
    for (const p of cluster) {
      let placed = false
      for (let lane = 0; lane < laneEnds.length; lane += 1) {
        if (p.topMin >= laneEnds[lane]) {
          p.lane = lane
          laneEnds[lane] = p.topMin + p.heightMin
          placed = true
          break
        }
      }
      if (!placed) {
        p.lane = laneEnds.length
        laneEnds.push(p.topMin + p.heightMin)
      }
    }
    const lanes = laneEnds.length
    for (const p of cluster) p.lanes = lanes

    i = j
  }

  return positioned
}
