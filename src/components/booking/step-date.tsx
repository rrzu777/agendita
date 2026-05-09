'use client'

import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isBefore, startOfDay } from 'date-fns'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'

export function StepDate({ data, onSelect, onBack }: { data: BookingData; onSelect: (date: Date) => void; onBack: () => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(data.date)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Elige una fecha</h2>
      <p className="text-gray-600 mb-6">{data.serviceName} — {data.serviceDuration} min</p>

      <div className="flex justify-between items-center mb-4">
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>←</Button>
        <span className="font-semibold capitalize">{format(currentMonth, 'MMMM yyyy')}</span>
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>→</Button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-4">
        {weekDays.map(d => <div key={d} className="text-center text-xs text-gray-500 py-2">{d}</div>)}
        {days.map((day) => {
          const isPast = isBefore(day, startOfDay(new Date()))
          const isSelected = selectedDate && isSameDay(day, selectedDate)
          return (
            <button
              key={day.toISOString()}
              disabled={isPast}
              onClick={() => setSelectedDate(day)}
              className={`
                aspect-square flex items-center justify-center rounded-lg text-sm
                ${isPast ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100'}
                ${isSelected ? 'bg-pink-500 text-white' : ''}
              `}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="outline" onClick={onBack}>Atrás</Button>
        <Button className="flex-1 bg-pink-500 hover:bg-pink-600" disabled={!selectedDate}
          onClick={() => selectedDate && onSelect(selectedDate)}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
