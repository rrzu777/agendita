'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { rescheduleBooking } from '@/server/actions/bookings'
import { getAvailableSlotsForReschedule } from '@/server/actions/availability'
import { CalendarCheck2, Clock3, Loader2, MessageCircle } from 'lucide-react'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { buildBookingRescheduledWhatsappUrl } from '@/lib/notifications/whatsapp'

interface RescheduleFormProps {
  bookingId: string
  customerName: string
  customerPhone: string
  serviceName: string
  currentDate: string
  currentTime: string
  timezone: string
  businessAddress?: string | null
}

export function RescheduleForm({
  bookingId,
  customerName,
  customerPhone,
  serviceName,
  currentDate,
  currentTime,
  timezone,
  businessAddress,
}: RescheduleFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [whatsappUrl, setWhatsappUrl] = useState('')
  const [date, setDate] = useState(currentDate)
  const [slots, setSlots] = useState<{ start: Date; end: Date }[]>([])
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null)
  const ignoreRef = useRef(false)
  const requestIdRef = useRef(0)

  /* eslint-disable react-hooks/set-state-in-effect -- standard loading/reset-before-fetch;
     concurrent responses are de-duped via requestIdRef/ignoreRef below. */
  useEffect(() => {
    if (!date) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    ignoreRef.current = false
    setLoadingSlots(true)
    setError('')
    setSelectedSlot(null)

    getAvailableSlotsForReschedule(bookingId, fromZonedTime(`${date} 00:00`, timezone))
      .then((res) => {
        if (ignoreRef.current || requestIdRef.current !== requestId) return
        if (!res.ok) {
          setSlots([])
          setError(res.error)
          return
        }
        setSlots(res.data.map((slot) => ({
          start: new Date(slot.start),
          end: new Date(slot.end),
        })))
      })
      .catch(() => {
        if (ignoreRef.current || requestIdRef.current !== requestId) return
        setSlots([])
        setError('No se pudieron cargar los horarios')
      })
      .finally(() => {
        if (!ignoreRef.current && requestIdRef.current === requestId) setLoadingSlots(false)
      })

    return () => {
      ignoreRef.current = true
    }
  }, [bookingId, date, timezone])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!selectedSlot) {
      setError('Selecciona un horario disponible')
      setLoading(false)
      return
    }

    try {
      const res = await rescheduleBooking(bookingId, selectedSlot.start)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const canSendWhatsapp = customerPhone.replace(/\D/g, '').length > 0
      setWhatsappUrl(canSendWhatsapp
        ? buildBookingRescheduledWhatsappUrl(customerPhone, {
            customerName,
            serviceName,
            previousStartDateTime: fromZonedTime(`${currentDate} ${currentTime}`, timezone),
            newStartDateTime: selectedSlot.start,
            businessTimezone: timezone,
            businessAddress,
          })
        : '')
      setSuccess(true)
    } catch {
      setError('Error al reprogramar')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <CalendarCheck2 className="mx-auto mb-3 size-10 text-green-600" />
          <h3 className="text-xl font-semibold text-primary">Reserva reprogramada</h3>
          <p className="mt-1 text-muted-foreground">Se avisará por email si la clienta tiene correo registrado.</p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            {whatsappUrl && (
              <Button asChild>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 size-4" />
                  Enviar WhatsApp
                </a>
              </Button>
            )}
            <Button
              type="button"
              variant={whatsappUrl ? 'outline' : 'default'}
              onClick={() => {
                router.push('/dashboard/bookings')
                router.refresh()
              }}
            >
              Volver a reservas
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')

  return (
    <Card>
      <CardContent className="p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-semibold text-primary">{serviceName}</p>
            <p className="text-sm text-muted-foreground">Cliente: {customerName}</p>
            <p className="text-sm text-muted-foreground">
              Fecha actual: {currentDate} a las {currentTime}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Nueva fecha *</Label>
            <Input id="date" name="date" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-3">
            <Label>Horarios disponibles *</Label>
            {loadingSlots ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando horarios...
              </div>
            ) : slots.length === 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                No hay horarios disponibles para esta fecha.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {slots.map((slot) => {
                  const start = new Date(slot.start)
                  const selected = selectedSlot?.start.getTime() === start.getTime()
                  return (
                    <button
                      key={start.toISOString()}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl border p-3 text-center transition ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-primary hover:border-primary hover:bg-accent'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2 font-semibold">
                        <Clock3 className="size-4" />
                        {formatInTimeZone(start, timezone, 'HH:mm')}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selectedSlot && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-semibold text-primary">Resumen del cambio</p>
              <p className="text-sm text-muted-foreground">Cliente: {customerName}</p>
              <p className="text-sm text-muted-foreground">Servicio: {serviceName}</p>
              <p className="text-sm text-muted-foreground">Antes: {currentDate} a las {currentTime}</p>
              <p className="text-sm text-muted-foreground">
                Nuevo: {date} a las {formatInTimeZone(selectedSlot.start, timezone, 'HH:mm')}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || loadingSlots || !selectedSlot} className="flex-1">
              {loading ? 'Reprogramando...' : 'Reprogramar reserva'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
