'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { getAvailableTimeSlots } from '@/server/actions/availability'
import { LEAD_TIME_MINUTES } from '@/lib/availability/constants'
import { formatBookingDate, formatBookingTime } from '@/lib/booking/format-booking-datetime'
import { Clock3, Loader2 } from 'lucide-react'

const LEAD_TIME_HINT = `Los horarios con menos de ${LEAD_TIME_MINUTES / 60} horas de anticipación no se muestran.`

interface StepTimeProps {
  businessId: string
  timezone: string
  data: BookingData
  onSelect: (slot: { start: Date; end: Date }) => void
  onBack: () => void
}

export function StepTime({ businessId, timezone, data, onSelect, onBack }: StepTimeProps) {
  const [slots, setSlots] = useState<{ start: Date; end: Date }[]>([])
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [hasError, setHasError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const ignoreRef = useRef(false)

  useEffect(() => {
    if (!data.date || !data.serviceId) return

    ignoreRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loading state before fetch is a standard UI pattern
    setLoading(true)
    setErrorMessage('')
    setHasError(false)
    setSelectedSlot(null)

    getAvailableTimeSlots(businessId, data.serviceId, data.date)
      .then((availableSlots) => {
        if (ignoreRef.current) return
        setSlots(availableSlots)
      })
      .catch((error) => {
        if (ignoreRef.current) return
        setSlots([])
        setHasError(true)
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los horarios')
      })
      .finally(() => {
        if (!ignoreRef.current) setLoading(false)
      })

    return () => {
      ignoreRef.current = true
    }
  }, [businessId, data.date, data.serviceId, retryKey])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="mb-4 size-7 animate-spin text-primary" />
        Cargando horarios disponibles...
      </div>
    )
  }

  if (hasError) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">No pudimos cargar los horarios</h2>
        <p className="mb-6 text-muted-foreground">
          {errorMessage || 'Ocurrió un error al cargar los horarios. Intenta de nuevo.'}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          <Button className="h-12 rounded-full px-6" onClick={() => setRetryKey((k) => k + 1)}>Reintentar</Button>
        </div>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">No hay horarios disponibles</h2>
        <p className="mb-2 text-muted-foreground">
          No hay horarios disponibles para esta fecha. Por favor, selecciona otra fecha.
        </p>
        <p className="mb-6 text-sm text-muted-foreground">{LEAD_TIME_HINT}</p>
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Elige una hora</h2>
      <p className="mb-7 text-base text-muted-foreground">
        {data.serviceName} · {data.date ? formatBookingDate(data.date, timezone) : ''}
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
              {formatBookingTime(slot.start, timezone)}
            </div>
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-muted-foreground">{LEAD_TIME_HINT}</p>

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
