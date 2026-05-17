import { addMinutes, startOfDay, isSameDay } from 'date-fns'
import { toBusinessLocalDate } from './timezone'

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

  const localDate = toBusinessLocalDate(date, timezone)
  const localNow = toBusinessLocalDate(now, timezone)
  const dayOfWeek = localDate.getDay()

  const rule = rules.find((r) => r.dayOfWeek === dayOfWeek && r.isActive)
  if (!rule) return []

  const dayStart = startOfDay(localDate)
  const [startHour, startMin] = rule.startTime.split(':').map(Number)
  const [endHour, endMin] = rule.endTime.split(':').map(Number)

  const availabilityStart = new Date(dayStart)
  availabilityStart.setHours(startHour, startMin, 0, 0)

  const availabilityEnd = new Date(dayStart)
  availabilityEnd.setHours(endHour, endMin, 0, 0)

  const isToday = isSameDay(localDate, localNow)
  const cutoff = isToday ? addMinutes(localNow, 1) : undefined

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
