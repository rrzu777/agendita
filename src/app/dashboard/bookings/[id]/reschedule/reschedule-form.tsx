'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { rescheduleBooking } from '@/server/actions/bookings'
import { CalendarCheck2, Clock } from 'lucide-react'

interface RescheduleFormProps {
  bookingId: string
  customerName: string
  serviceName: string
  currentDate: string
  currentTime: string
  businessId: string
}

export function RescheduleForm({
  bookingId,
  customerName,
  serviceName,
  currentDate,
  currentTime,
}: RescheduleFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const form = e.currentTarget
    const formData = new FormData(form)
    const dateStr = formData.get('date') as string
    const timeStr = formData.get('time') as string

    if (!dateStr || !timeStr) {
      setError('Selecciona una fecha y hora')
      setLoading(false)
      return
    }

    const newStartDateTime = new Date(`${dateStr}T${timeStr}:00`)

    try {
      await rescheduleBooking(bookingId, newStartDateTime)
      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard/bookings')
        router.refresh()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reprogramar')
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
          <p className="mt-1 text-muted-foreground">Redirigiendo...</p>
        </CardContent>
      </Card>
    )
  }

  const today = new Date().toISOString().split('T')[0]

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

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Nueva fecha *</Label>
              <Input id="date" name="date" type="date" required min={today} className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Nueva hora *</Label>
              <Input id="time" name="time" type="time" required className="h-10" />
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Reprogramando...' : 'Reprogramar reserva'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
