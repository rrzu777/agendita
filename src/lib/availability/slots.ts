import { addMinutes, startOfDay, isWithinInterval } from 'date-fns'

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

export function generateSlots(
  date: Date,
  durationMinutes: number,
  rules: AvailabilityRuleLike[],
  blocks: TimeBlockLike[],
  bookings: BookingLike[]
): TimeSlot[] {
  const dayOfWeek = date.getDay()
  const rule = rules.find(r => r.dayOfWeek === dayOfWeek && r.isActive)
  
  if (!rule) return []
  
  const dayStart = startOfDay(date)
  const [startHour, startMin] = rule.startTime.split(':').map(Number)
  const [endHour, endMin] = rule.endTime.split(':').map(Number)
  
  const availabilityStart = new Date(dayStart)
  availabilityStart.setHours(startHour, startMin, 0, 0)
  
  const availabilityEnd = new Date(dayStart)
  availabilityEnd.setHours(endHour, endMin, 0, 0)
  
  const slots: TimeSlot[] = []
  let current = availabilityStart
  
  while (addMinutes(current, durationMinutes) <= availabilityEnd) {
    const slotEnd = addMinutes(current, durationMinutes)
    
    const blockedByTimeBlock = blocks.some(block =>
      current < block.endDateTime && block.startDateTime < slotEnd
    )
    
    const blockedByBooking = bookings.some(booking => {
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
