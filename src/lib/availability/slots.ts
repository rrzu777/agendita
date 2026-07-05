import { addMinutes, addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek } from './timezone'
import { LEAD_TIME_MINUTES } from './constants'

export interface TimeSlot {
  start: Date
  end: Date
}

export interface BookingLike {
  startDateTime: Date
  endDateTime: Date
  status: string
  holdExpiresAt?: Date | null
}

export interface TimeBlockLike {
  startDateTime: Date
  endDateTime: Date
}

export interface AvailabilityRuleLike {
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
}

export interface GenerateSlotsOptions {
  timezone?: string
  now?: Date
  leadTimeMinutes?: number
  bookingWindowDays?: number
}

/**
 * Genera slots disponibles para un día y servicio dado, por sustracción de
 * intervalos: ventana de la regla − bloqueos − reservas activas = intervalos
 * libres; en cada intervalo libre se anclan slots a su inicio con paso =
 * `durationMinutes`. Así los slots quedan pegados al término de cada cita o
 * bloqueo (agenda compacta, sin espacio libre desperdiciado), incluso cuando
 * una reserva existente no calza con la grilla de apertura.
 *
 * Devuelve instantes Date UTC reales. Por ejemplo, para negocio
 * America/Santiago con regla 09:00, el primer slot será 13:00Z.
 *
 * Filtra slots por leadTimeMinutes (default 120) y bookingWindowDays (default
 * 90) por slot — no por día — para alinearse con assertSlotIsAvailable. El
 * lead time solo filtra candidatos: el grid no se corre con el reloj, los
 * slots desaparecen al cruzar el corte pero nunca cambian de hora.
 */
export function generateSlots(
  date: Date,
  durationMinutes: number,
  rules: AvailabilityRuleLike[],
  blocks: TimeBlockLike[],
  bookings: BookingLike[],
  options: GenerateSlotsOptions = {}
): TimeSlot[] {
  const {
    timezone = 'America/Santiago',
    now = new Date(),
    leadTimeMinutes = LEAD_TIME_MINUTES,
    bookingWindowDays = 90,
  } = options

  const localDateStr = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
  const localDayOfWeek = getLocalDayOfWeek(date, timezone)

  const rule = rules.find((r) => r.dayOfWeek === localDayOfWeek && r.isActive)
  if (!rule) return []

  // Construir timestamps UTC reales para inicio y fin de disponibilidad
  const availabilityStart = fromZonedTime(`${localDateStr} ${rule.startTime}`, timezone)
  const availabilityEnd = fromZonedTime(`${localDateStr} ${rule.endTime}`, timezone)

  // Lead time: no mostrar slots que requieran menos de leadTimeMinutes de antelación
  const cutoff = addMinutes(now, leadTimeMinutes)
  // Paridad con assertSlotIsAvailable: rechaza startDateTime > now + window,
  // así que el filtro es por slot (no por día) para no ofrecer inbookeables
  // en el último día de la ventana.
  const maxStart = addDays(now, bookingWindowDays)

  const blocksSlot = (booking: BookingLike): boolean => {
    if (booking.status === 'cancelled' || booking.status === 'no_show' || booking.status === 'expired') return false
    // A pending_payment hold that has already expired no longer blocks the
    // slot, even if the cron hasn't flipped it to `expired` yet. Mirrors the
    // server-side guard in assertSlotIsAvailable.
    if (booking.status === 'pending_payment' && booking.holdExpiresAt && booking.holdExpiresAt <= now) return false
    return true
  }

  // Obstáculos que intersectan la ventana del día, ordenados por inicio
  const obstacles = [
    ...blocks.map((b) => ({ start: b.startDateTime, end: b.endDateTime })),
    ...bookings.filter(blocksSlot).map((b) => ({ start: b.startDateTime, end: b.endDateTime })),
  ]
    .filter((o) => o.start < availabilityEnd && o.end > availabilityStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  // Barrido: intervalos libres = ventana − obstáculos
  const freeIntervals: { start: Date; end: Date }[] = []
  let cursor = availabilityStart
  for (const obstacle of obstacles) {
    if (obstacle.start > cursor) {
      freeIntervals.push({ start: cursor, end: obstacle.start < availabilityEnd ? obstacle.start : availabilityEnd })
    }
    if (obstacle.end > cursor) cursor = obstacle.end
  }
  if (cursor < availabilityEnd) {
    freeIntervals.push({ start: cursor, end: availabilityEnd })
  }

  // Slots anclados al inicio de cada intervalo libre (agenda compacta)
  const slots: TimeSlot[] = []
  for (const interval of freeIntervals) {
    let current = interval.start
    while (addMinutes(current, durationMinutes) <= interval.end) {
      if (current >= cutoff && current <= maxStart) {
        slots.push({ start: new Date(current), end: addMinutes(current, durationMinutes) })
      }
      current = addMinutes(current, durationMinutes)
    }
  }

  return slots
}
