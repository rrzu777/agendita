'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createManualPayment } from '@/server/actions/payments'
import { Plus } from 'lucide-react'

// Opciones comunes + "Otro" (campo libre). El valor guardado es la etiqueta,
// que es lo que se muestra en el historial de pagos.
const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Mercado Pago'] as const
const OTHER = 'Otro'

export function PaymentForm({ bookings }: { bookings: { id: string; service: { name: string } | null; customer: { name: string } | null; finalAmount: number; remainingBalance: number; depositPaid: number; status: string }[] }) {
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [otherMethod, setOtherMethod] = useState('')

  async function handleSubmit(formData: FormData) {
    const bookingId = formData.get('bookingId') as string
    const amount = parseInt(formData.get('amount') as string)
    const paymentMethod = method === OTHER ? otherMethod.trim() : method

    if (!paymentMethod) return

    await createManualPayment({
      bookingId,
      amount,
      currency: 'CLP',
      paymentMethod,
    })

    setOpen(false)
    window.location.reload()
  }

  const pendingBookings = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show' && b.remainingBalance > 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 font-semibold">
          <Plus className="mr-2 size-4" />
          Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">Registrar pago manual</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow">Reserva</Label>
            <select name="bookingId" required className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none">
              <option value="">Selecciona una reserva</option>
              {pendingBookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.customer?.name ? `${booking.customer.name} — ` : `Reserva ${booking.id.slice(-4)} — `}
                  ${booking.remainingBalance.toLocaleString('es-CL')} pendiente
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Monto (CLP)</Label>
            <Input className="studio-input" name="amount" type="number" required />
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Método de pago</Label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value={OTHER}>{OTHER}…</option>
            </select>
            {method === OTHER && (
              <Input
                className="studio-input"
                value={otherMethod}
                onChange={(e) => setOtherMethod(e.target.value)}
                placeholder="Especifica el método"
                required
                autoFocus
              />
            )}
          </div>
          <Button type="submit" className="h-12 w-full font-semibold">
            Registrar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
