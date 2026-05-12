'use client'

import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function CalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { locale: es })
  const calendarEnd = endOfWeek(monthEnd, { locale: es })
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  return (
    <div className="studio-card p-5 md:p-7">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} aria-label="Mes anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-2xl font-semibold capitalize tracking-normal text-primary">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} aria-label="Mes siguiente">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div key={day} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {day}
          </div>
        ))}
        {days.map((day) => (
          <button
            key={day.toISOString()}
            onClick={() => setSelectedDate(day)}
            className={`
              flex aspect-square items-center justify-center rounded-xl text-sm font-semibold transition-colors
              ${!isSameMonth(day, currentMonth) ? 'text-muted-foreground/35' : 'text-primary'}
              ${selectedDate && isSameDay(day, selectedDate) ? 'bg-primary text-primary-foreground hover:bg-primary' : 'hover:bg-accent'}
            `}
          >
            {format(day, 'd')}
          </button>
        ))}
      </div>

      {selectedDate && (
        <div className="mt-6 rounded-xl border border-border/60 bg-muted/40 p-5">
          <h3 className="mb-2 font-semibold text-primary">
            {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-sm text-muted-foreground">No hay reservas para este día</p>
        </div>
      )}
    </div>
  )
}
