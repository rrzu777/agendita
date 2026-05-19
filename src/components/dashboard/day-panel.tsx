'use client'

import { useMemo } from 'react'
import { format, compareAsc } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import { BookingCard, type CalendarBooking } from './booking-card'
import { TimeBlockCard, type CalendarTimeBlock } from './time-block-card'

interface DayPanelProps {
  bookings: CalendarBooking[]
  timeBlocks: CalendarTimeBlock[]
  selectedDate: string | null
  businessCurrency: string
  timezone: string
}

export function DayPanel({ bookings, timeBlocks, selectedDate, businessCurrency, timezone }: DayPanelProps) {
  const items = useMemo(() => {
    if (!selectedDate) return []
    const dayBookings = bookings
      .filter((b) => {
        return formatInTimeZone(new Date(b.startDateTime), timezone, 'yyyy-MM-dd') === selectedDate
      })
      .map((b) => ({ ...b, type: 'booking' as const }))

    const dayBlocks = timeBlocks
      .filter((tb) => {
        return formatInTimeZone(new Date(tb.startDateTime), timezone, 'yyyy-MM-dd') === selectedDate
      })
      .map((tb) => ({ ...tb, type: 'timeBlock' as const }))

    return [...dayBookings, ...dayBlocks].sort((a, b) =>
      compareAsc(new Date(a.startDateTime), new Date(b.startDateTime))
    )
  }, [bookings, timeBlocks, selectedDate, timezone])

  if (!selectedDate) {
    return (
      <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-5">
        <p className="text-sm text-muted-foreground">Selecciona un día para ver la agenda</p>
      </div>
    )
  }

  const headerDate = new Date(`${selectedDate}T00:00:00`)

  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-5">
        <h3 className="mb-2 font-semibold text-primary">
          {format(headerDate, "EEEE d 'de' MMMM", { locale: es })}
        </h3>
        <p className="text-sm text-muted-foreground">No hay reservas para este día</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-3">
      <h3 className="font-semibold text-primary">
        {format(headerDate, "EEEE d 'de' MMMM", { locale: es })}
      </h3>
      {items.map((item) =>
        item.type === 'booking' ? (
          <BookingCard key={item.id} booking={item} businessCurrency={businessCurrency} />
        ) : (
          <TimeBlockCard key={item.id} timeBlock={item} />
        )
      )}
    </div>
  )
}
