'use client'

import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isBefore, startOfDay } from 'date-fns'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { formatDuration } from '@/lib/format-duration'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function StepDate({ data, onSelect, onBack }: { data: BookingData; onSelect: (date: Date) => void; onBack: () => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(data.date)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Elige una fecha</h2>
      <p className="mb-7 text-base text-muted-foreground">{data.serviceName} · {formatDuration(data.serviceDuration)}</p>

      <div className="flex justify-between items-center mb-4">
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} aria-label="Mes anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="font-semibold capitalize text-primary">{format(currentMonth, 'MMMM yyyy')}</span>
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} aria-label="Mes siguiente">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {weekDays.map(d => <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{d}</div>)}
        {days.map((day) => {
          const isPast = isBefore(day, startOfDay(new Date()))
          const isSelected = selectedDate && isSameDay(day, selectedDate)
          return (
            <button
              key={day.toISOString()}
              disabled={isPast}
              onClick={() => setSelectedDate(day)}
              className={`
                flex aspect-square items-center justify-center rounded-full text-sm font-semibold transition-colors
                ${isPast ? 'cursor-not-allowed text-muted-foreground/35' : 'hover:bg-accent'}
                ${isSelected ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-foreground'}
              `}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>

      <div className="mt-8 flex gap-3">
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
        <Button className="h-12 flex-1 rounded-full text-base font-semibold" disabled={!selectedDate}
          onClick={() => selectedDate && onSelect(selectedDate)}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
