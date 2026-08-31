'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { getAvailableTimeSlotsResult } from '@/server/actions/availability'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'
import { formatInTimeZone } from 'date-fns-tz'
import { pickCacheKey } from '@/lib/professionals/eligible'
import { LEAD_TIME_MINUTES } from '@/lib/availability/constants'
import { formatBookingDate, formatBookingTime } from '@/lib/bookings/format-booking-datetime'
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
  const analytics = usePublicAnalytics()
  const selectionRevision = analytics.revision()
  const captureIdentity = analytics.attemptIdentity()
  const pickKey = pickCacheKey(data.professional)
  const [slots, setSlots] = useState<{ start: Date; end: Date }[]>([])
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const generationRef = useRef(0)
  const queryContextRef = useRef<string | null>(null)

  useEffect(() => {
    if (!data.date || !data.serviceId) return

    const generation = ++generationRef.current
    const queryContext = JSON.stringify([businessId, data.serviceId, data.date.toISOString(), pickKey, data.serviceModality])
    const sameBookingContext = queryContextRef.current === queryContext
    queryContextRef.current = queryContext
    const revision = analytics.revision()
    let cancelled = false
    const current = () => !cancelled && generationRef.current === generation
    const requestGeneration = analytics.ready ? analytics.nextAvailabilityGeneration() : null
    const queryId = requestGeneration === null ? null : crypto.randomUUID()
    function observe(result: 'available' | 'empty' | 'error', reason?: 'outside_booking_window' | 'lead_time_restricted' | 'not_offered' | 'no_capacity' | 'unknown') {
      // Capture identity/revision can disappear on a storage failure; that must not hide Booking's slots.
      if (analytics.revision() !== revision || analytics.attemptIdentity() !== captureIdentity) return
      if (!queryId || requestGeneration === null || !data.serviceId || !data.serviceModality || !data.date) return
      analytics.track({ type: 'availability_result', data: { serviceId: data.serviceId, modality: data.serviceModality, professional: data.professional.kind === 'person' ? { kind: 'person', professionalId: data.professional.id } : data.professional, localDate: formatInTimeZone(data.date, timezone, 'yyyy-MM-dd'), queryId, requestGeneration, result, ...(result === 'empty' ? { reason: reason ?? 'unknown' } : {}) } })
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loading state before fetch is a standard UI pattern
    setLoading(true)
    setError(null)
    // Consent/revision refreshes must not erase an otherwise valid Booking choice.
    // Actual dimension changes still invalidate immediately; responses revalidate the slot.
    if (!sameBookingContext) setSelectedSlot(null)

    // Con persona, los horarios son los SUYOS: su horario semanal (o el del
    // negocio, si no tiene propio), sus bloqueos y los del negocio, y las citas que
    // le tapan la hora. Con "cualquiera disponible", la unión de los de todo el
    // equipo elegible. Sin nadie, el horario del negocio de siempre.
    getAvailableTimeSlotsResult({
      businessId,
      serviceId: data.serviceId,
      date: data.date,
      professional: data.professional,
      modality: data.serviceModality,
    })
      .then((res) => {
        if (!current()) return
        if (!res.ok) {
          setSlots([])
          setSelectedSlot(null)
          setError(res.error)
          observe('error')
          return
        }
        setSlots(res.data.slots)
        setSelectedSlot(selected => selected
          ? res.data.slots.find(slot => slot.start.getTime() === selected.start.getTime() && slot.end.getTime() === selected.end.getTime()) ?? null
          : null)
        observe(res.data.slots.length ? 'available' : 'empty', res.data.emptyReason ?? undefined)
      })
      .catch(() => {
        if (!current()) return
        setSlots([])
        setSelectedSlot(null)
        setError('No se pudieron cargar los horarios')
        observe('error')
      })
      .finally(() => {
        if (current()) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // La elección entra como clave y no como objeto: `professionalFields` arma uno
    // NUEVO en cada llamada, así que la identidad cambiaría sin que cambie la
    // elección y esto es la lectura más caliente del producto. `pickKey` la
    // representa entera —`kind` más el id—, así que no se pierde nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pickKey` representa a `data.professional`
  }, [businessId, data.date, data.serviceId, pickKey, data.serviceModality, retryKey, analytics.ready, selectionRevision, captureIdentity])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="mb-4 size-7 animate-spin text-primary" />
        Cargando horarios disponibles...
      </div>
    )
  }

  if (error !== null) {
    return (
      <div>
        <h2 className="mb-2 font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">No pudimos cargar los horarios</h2>
        <p className="mb-6 text-muted-foreground">{error}</p>
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
        {/* La persona se nombra acá y no sólo en su paso: es lo que explica que
            los horarios cambien, y es la única pantalla que la ve alguien a quien
            el funnel se la asignó sin preguntar (una sola elegible). */}
        {data.serviceName}{data.professionalName ? ` · ${data.professionalName}` : ''} · {data.date ? formatBookingDate(data.date, timezone) : ''}
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
