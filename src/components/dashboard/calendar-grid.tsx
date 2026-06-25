import Link from 'next/link'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const statusDotColors: Record<string, string> = {
  pending_payment: 'bg-orange-400',
  confirmed: 'bg-green-400',
  completed: 'bg-gray-400',
  cancelled: 'bg-gray-300',
  no_show: 'bg-red-400',
}

interface CalendarGridProps {
  bookingsByDay: Record<string, Array<{ status: string }>>
  currentMonth: Date
  selectedDate: string | null
}

export function CalendarGrid({ bookingsByDay, currentMonth, selectedDate }: CalendarGridProps) {
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { locale: es })
  const calendarEnd = endOfWeek(monthEnd, { locale: es })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const prevMonth = format(subMonths(currentMonth, 1), 'yyyy-MM')
  const nextMonth = format(addMonths(currentMonth, 1), 'yyyy-MM')
  const currentMonthStr = format(currentMonth, 'yyyy-MM')

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  return (
    <div className="studio-card p-5 md:p-7">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/dashboard/calendar?month=${prevMonth}`} aria-label="Mes anterior">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <h2 className="font-heading text-2xl font-semibold capitalize tracking-tight text-primary">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <Button variant="outline" size="icon" asChild>
          <Link href={`/dashboard/calendar?month=${nextMonth}`} aria-label="Mes siguiente">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {day}
          </div>
        ))}
        {days.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd')
          const dayBookings = bookingsByDay[dayKey] || []
          const statusSet = new Set(dayBookings.map((b) => b.status))
          const isSelected = selectedDate === dayKey
          const isCurrentMonth = isSameMonth(day, currentMonth)

          return (
            <Link
              key={day.toISOString()}
              href={`/dashboard/calendar?date=${dayKey}&month=${currentMonthStr}`}
              className={`
                flex aspect-square flex-col items-center justify-center rounded-xl text-sm font-semibold transition-colors
                ${!isCurrentMonth ? 'text-muted-foreground/35' : 'text-primary'}
                ${isSelected ? 'bg-primary text-primary-foreground hover:bg-primary' : 'hover:bg-accent'}
              `}
            >
              <span>{format(day, 'd')}</span>
              {dayBookings.length > 0 && (
                <div className="mt-1 flex items-center gap-0.5">
                  {Array.from(statusSet)
                    .slice(0, 3)
                    .map((status) => (
                      <span
                        key={status}
                        className={`block size-1.5 rounded-full ${statusDotColors[status] || 'bg-gray-400'}`}
                      />
                    ))}
                  {dayBookings.length > 3 && (
                    <span className="text-[9px] leading-none text-muted-foreground">
                      +{dayBookings.length - 3}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
