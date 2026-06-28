import { formatInTimeZone } from 'date-fns-tz'

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
  /** alto en minutos (mínimo 30 para legibilidad) */
  heightMin: number
  /** columna asignada cuando hay solapes (0-based) */
  lane: number
  /** total de columnas en el cluster de solape */
  lanes: number
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
      heightMin: Math.max(30, endMin - startMin),
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
