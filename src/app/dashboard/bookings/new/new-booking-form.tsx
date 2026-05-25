'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { createBookingFromDashboard } from '@/server/actions/bookings'
import { CalendarCheck2, Phone, User, Mail, Scissors, FileText } from 'lucide-react'
import type { Service } from '@prisma/client'

interface NewBookingFormProps {
  businessId: string
  services: Service[]
}

export function NewBookingForm({ businessId, services }: NewBookingFormProps) {
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

    const serviceId = formData.get('serviceId') as string
    const customerName = formData.get('customerName') as string
    const customerPhone = formData.get('customerPhone') as string
    const customerEmail = formData.get('customerEmail') as string
    const dateStr = formData.get('date') as string
    const timeStr = formData.get('time') as string
    const internalNotes = formData.get('internalNotes') as string
    const markDepositPaid = formData.get('markDepositPaid') === 'on'

    if (!serviceId || !customerName || !customerPhone || !dateStr || !timeStr) {
      setError('Completa todos los campos requeridos')
      setLoading(false)
      return
    }

    const startDateTime = new Date(`${dateStr}T${timeStr}:00`)

    try {
      await createBookingFromDashboard({
        serviceId,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        startDateTime,
        internalNotes: internalNotes || undefined,
        markDepositPaid,
      })
      setSuccess(true)
      setTimeout(() => {
        router.push('/dashboard/bookings')
        router.refresh()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la reserva')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <CalendarCheck2 className="mx-auto mb-3 size-10 text-green-600" />
          <h3 className="text-xl font-semibold text-primary">Reserva creada</h3>
          <p className="mt-1 text-muted-foreground">Redirigiendo a la lista de reservas...</p>
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

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Servicio</h3>
              <div className="space-y-2">
                <Label htmlFor="serviceId">Servicio *</Label>
                <select
                  id="serviceId"
                  name="serviceId"
                  required
                  className="studio-input w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
                >
                  <option value="">Selecciona un servicio</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — ${s.price.toLocaleString('es-CL')} ({s.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Cliente</h3>
              <div className="space-y-2">
                <Label htmlFor="customerName">Nombre *</Label>
                <Input id="customerName" name="customerName" required placeholder="Nombre de la clienta" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerPhone">Teléfono *</Label>
                <Input id="customerPhone" name="customerPhone" required placeholder="+56912345678" className="h-10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerEmail">Email (opcional)</Label>
                <Input id="customerEmail" name="customerEmail" type="email" placeholder="cliente@email.com" className="h-10" />
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha *</Label>
              <Input id="date" name="date" type="date" required min={today} className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Hora *</Label>
              <Input id="time" name="time" type="time" required className="h-10" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internalNotes">Notas internas (opcional)</Label>
            <textarea
              id="internalNotes"
              name="internalNotes"
              rows={2}
              className="studio-input w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Ej: Llegó por WhatsApp, prefiere color rojo..."
            />
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <input
              type="checkbox"
              id="markDepositPaid"
              name="markDepositPaid"
              className="size-4 rounded border-border accent-primary"
            />
            <Label htmlFor="markDepositPaid" className="cursor-pointer text-sm">
              Marcar abono como pagado (efectivo / transferencia)
            </Label>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="flex-1 shadow-[0_14px_32px_rgba(51,41,32,0.18)]">
              {loading ? 'Creando reserva...' : 'Crear reserva'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
