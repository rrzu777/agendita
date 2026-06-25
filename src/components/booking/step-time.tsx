'use client'

import { useState, useEffect, useRef } from 'react'
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
  const ignoreRef = useRef(false)

  useEffect(() => {
    if (!data.date || !data.serviceId) return

    ignoreRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loading state before fetch is a standard UI pattern
    setLoading(true)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing error/reset UI is required before each fetch attempt
    setErrorMessage('')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing previous slot selection avoids stale state on new fetch
    setSelectedSlot(null)

    getAvailableTimeSlots(businessId, data.serviceId, data.date)
      .then((availableSlots) => {
        if (ignoreRef.current) return
        setSlots(availableSlots)
      })
      .catch((error) => {
        if (ignoreRef.current) return
        setSlots([])
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los horarios')
      })
      .finally(() => {
        if (!ignoreRef.current) setLoading(false)
      })

    return () => {
      ignoreRef.current = true
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
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">No hay horarios disponibles</h2>
        <p className="mb-6 text-muted-foreground">
          {errorMessage || 'No hay horarios disponibles para esta fecha. Por favor, selecciona otra fecha.'}
        </p>
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Elige una hora</h2>
      <p className="mb-7 text-base text-muted-foreground">
        {data.serviceName} · {data.date?.toLocaleDateString('es-CL')}
      </p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {slots.map((slot) => (
          <button
            key={slot.start.toISOString()}
            onClick={() => setSelectedSlot(slot)}
            className={`
              rounded-2xl border p-4 text-center transition-all
              ${selectedSlot?.start.getTime() === slot.start.getTime()
                ? 'border-primary bg-primary text-primary-foreground shadow-[var(--cream-shadow)]'
                : 'border-border/70 bg-card text-primary hover:-translate-y-0.5 hover:border-primary'}
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
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
        <Button className="h-12 flex-1 rounded-full text-base font-semibold" disabled={!selectedSlot}
          onClick={() => selectedSlot && onSelect(selectedSlot)}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
