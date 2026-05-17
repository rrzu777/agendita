'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createManualPayment } from '@/server/actions/payments'
import { Plus } from 'lucide-react'

export function PaymentForm({ bookings }: { bookings: any[] }) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    const bookingId = formData.get('bookingId') as string
    const amount = parseInt(formData.get('amount') as string)
    const paymentType = formData.get('paymentType') as string
    const paymentMethod = formData.get('paymentMethod') as string

    const booking = bookings.find(b => b.id === bookingId)
    if (!booking) return

    await createManualPayment({
      bookingId,
      amount,
      currency: 'CLP',
      paymentType,
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
          <DialogTitle className="text-2xl font-semibold tracking-normal text-primary">Registrar pago manual</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow">Reserva</Label>
            <select name="bookingId" required className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none">
              <option value="">Selecciona una reserva</option>
              {pendingBookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  Reserva {booking.id.slice(-4)} — ${booking.remainingBalance.toLocaleString('es-CL')} pendiente
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Tipo de pago</Label>
            <select name="paymentType" required className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none">
              <option value="deposit">Abono</option>
              <option value="final_payment">Pago final</option>
              <option value="full_payment">Pago total</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Monto (CLP)</Label>
            <Input className="studio-input" name="amount" type="number" required />
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Método de pago</Label>
            <Input className="studio-input" name="paymentMethod" placeholder="Efectivo, transferencia, etc." required />
          </div>
          <Button type="submit" className="h-12 w-full font-semibold">
            Registrar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
