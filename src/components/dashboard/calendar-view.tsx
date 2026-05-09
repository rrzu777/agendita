'use client'

import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'

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
    <div>
      <div className="flex justify-between items-center mb-6">
        <Button variant="outline" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
          ← Anterior
        </Button>
        <h2 className="text-xl font-bold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h2>
        <Button variant="outline" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
          Siguiente →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
        {days.map((day) => (
          <button
            key={day.toISOString()}
            onClick={() => setSelectedDate(day)}
            className={`
              aspect-square flex items-center justify-center rounded-lg text-sm
              ${!isSameMonth(day, currentMonth) ? 'text-gray-300' : 'text-gray-900'}
              ${selectedDate && isSameDay(day, selectedDate) ? 'bg-pink-500 text-white' : 'hover:bg-gray-100'}
            `}
          >
            {format(day, 'd')}
          </button>
        ))}
      </div>

      {selectedDate && (
        <div className="mt-6 p-4 bg-white rounded-lg border">
          <h3 className="font-semibold mb-2">
            {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-gray-500 text-sm">No hay reservas para este día</p>
        </div>
      )}
    </div>
  )
}
