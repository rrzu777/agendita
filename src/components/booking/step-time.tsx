'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { getAvailableTimeSlots } from '@/server/actions/availability'

interface StepTimeProps {
  businessId: string
  data: BookingData
  onSelect: (slot: { start: Date; end: Date }) => void
  onBack: () => void
}

export function StepTime({ businessId, data, onSelect, onBack }: StepTimeProps) {
  const [slots, setSlots] = useState<{ start: Date; end: Date }[]>([])
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!data.date || !data.serviceId) return

    let ignore = false
    setLoading(true)
    setErrorMessage('')
    setSelectedSlot(null)

    getAvailableTimeSlots(businessId, data.serviceId, data.date)
      .then((availableSlots) => {
        if (ignore) return
        setSlots(availableSlots)
      })
      .catch((error) => {
        if (ignore) return
        setSlots([])
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los horarios')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [businessId, data.date, data.serviceId])

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Cargando horarios disponibles...</div>
  }

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-2">No hay horarios disponibles</h2>
        <p className="text-gray-600 mb-6">
          {errorMessage || 'No hay horarios disponibles para esta fecha. Por favor, selecciona otra fecha.'}
        </p>
        <Button variant="outline" onClick={onBack}>Atrás</Button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Elige una hora</h2>
      <p className="text-gray-600 mb-6">
        {data.serviceName} — {data.date?.toLocaleDateString('es-CL')}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {slots.map((slot) => (
          <button
            key={slot.start.toISOString()}
            onClick={() => setSelectedSlot(slot)}
            className={`
              p-3 rounded-lg border text-center transition
              ${selectedSlot?.start.getTime() === slot.start.getTime()
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-gray-200 hover:border-pink-300'}
            `}
          >
            <div className="font-semibold">{format(slot.start, 'HH:mm')}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="outline" onClick={onBack}>Atrás</Button>
        <Button className="flex-1 bg-pink-500 hover:bg-pink-600" disabled={!selectedSlot}
          onClick={() => selectedSlot && onSelect(selectedSlot)}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
