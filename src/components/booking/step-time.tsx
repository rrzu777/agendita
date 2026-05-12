'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { getAvailableTimeSlots } from '@/server/actions/availability'
import { Clock3, Loader2 } from 'lucide-react'

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
    return (
      <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="mb-4 size-7 animate-spin text-primary" />
        Cargando horarios disponibles...
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-3xl font-semibold tracking-normal text-primary">No hay horarios disponibles</h2>
        <p className="mb-6 text-muted-foreground">
          {errorMessage || 'No hay horarios disponibles para esta fecha. Por favor, selecciona otra fecha.'}
        </p>
        <Button variant="outline" onClick={onBack}>Atrás</Button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-2 text-4xl font-semibold tracking-normal text-primary">Elige una hora</h2>
      <p className="mb-8 text-lg text-muted-foreground">
        {data.serviceName} — {data.date?.toLocaleDateString('es-CL')}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {slots.map((slot) => (
          <button
            key={slot.start.toISOString()}
            onClick={() => setSelectedSlot(slot)}
            className={`
              rounded-xl border p-4 text-center transition
              ${selectedSlot?.start.getTime() === slot.start.getTime()
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-primary hover:border-primary hover:bg-accent'}
            `}
          >
            <div className="flex items-center justify-center gap-2 font-semibold">
              <Clock3 className="size-4" />
              {format(slot.start, 'HH:mm')}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Button variant="outline" onClick={onBack}>Atrás</Button>
        <Button className="h-12 flex-1 text-base font-semibold" disabled={!selectedSlot}
          onClick={() => selectedSlot && onSelect(selectedSlot)}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
