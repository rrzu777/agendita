import { addMinutes } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { getLocalDayOfWeek } from './timezone'

export interface TimeSlot {
  start: Date
  end: Date
}

export interface BookingLike {
  startDateTime: Date
  endDateTime: Date
  status: string
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
}

/**
 * Genera slots disponibles para un día y servicio dado.
 *
 * El step increment entre slots es igual a `durationMinutes`.
 * Esto significa que para un servicio de 60 min, los slots son
 * 09:00, 10:00, 11:00, etc. Para 90 min: 09:00, 10:30, 12:00.
 *
 * Devuelve instantes Date UTC reales. Por ejemplo, para negocio
 * America/Santiago con regla 09:00, el primer slot será 13:00Z.
 */
export function generateSlots(
  date: Date,
  durationMinutes: number,
  rules: AvailabilityRuleLike[],
  blocks: TimeBlockLike[],
  bookings: BookingLike[],
  options: GenerateSlotsOptions = {}
): TimeSlot[] {
  const { timezone = 'America/Santiago', now = new Date() } = options

  const localDateStr = formatInTimeZone(date, timezone, 'yyyy-MM-dd')
  const localDayOfWeek = getLocalDayOfWeek(date, timezone)

  const rule = rules.find((r) => r.dayOfWeek === localDayOfWeek && r.isActive)
  if (!rule) return []

  // Construir timestamps UTC reales para inicio y fin de disponibilidad
  const availabilityStart = fromZonedTime(`${localDateStr} ${rule.startTime}`, timezone)
  const availabilityEnd = fromZonedTime(`${localDateStr} ${rule.endTime}`, timezone)

  // Filtrar horarios pasados para el día actual en timezone del negocio
  const nowLocalStr = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  const isToday = localDateStr === nowLocalStr
  const cutoff = isToday ? addMinutes(now, 1) : undefined

  const slots: TimeSlot[] = []
  let current = availabilityStart

  while (addMinutes(current, durationMinutes) <= availabilityEnd) {
    const slotEnd = addMinutes(current, durationMinutes)

    if (cutoff && current < cutoff) {
      current = addMinutes(current, durationMinutes)
      continue
    }

    const blockedByTimeBlock = blocks.some(
      (block) => current < block.endDateTime && block.startDateTime < slotEnd
    )

    const blockedByBooking = bookings.some((booking) => {
      if (booking.status === 'cancelled' || booking.status === 'no_show') return false
      return current < booking.endDateTime && booking.startDateTime < slotEnd
    })

    if (!blockedByTimeBlock && !blockedByBooking) {
      slots.push({ start: new Date(current), end: slotEnd })
    }

    current = addMinutes(current, durationMinutes)
  }

  return slots
}
