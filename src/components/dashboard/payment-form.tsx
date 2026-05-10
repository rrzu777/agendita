'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createPayment } from '@/server/actions/payments'
import { createLedgerEntry } from '@/server/actions/ledger'
import { confirmPayment } from '@/server/actions/bookings'

export function PaymentForm({ bookings }: { bookings: any[] }) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    const bookingId = formData.get('bookingId') as string
    const amount = parseInt(formData.get('amount') as string)
    const paymentType = formData.get('paymentType') as string
    const paymentMethod = formData.get('paymentMethod') as string

    const booking = bookings.find(b => b.id === bookingId)
    if (!booking) return

    const payment = await createPayment({
      businessId: 'mock-business-1',
      bookingId,
      customerId: booking.customerId,
      provider: 'manual',
      providerPaymentId: null,
      amount,
      currency: 'CLP',
      status: 'approved',
      paymentType: paymentType as any,
      paymentMethod,
      paidAt: new Date(),
      rawPayload: null,
    })

    await confirmPayment(bookingId, amount)

    await createLedgerEntry({
      businessId: 'mock-business-1',
      bookingId,
      paymentId: payment.id,
      customerId: booking.customerId,
      type: paymentType === 'deposit' ? 'deposit_paid' : paymentType === 'final_payment' ? 'final_payment_paid' : 'full_payment_paid',
      direction: 'income',
      amount,
      currency: 'CLP',
      description: `Pago ${paymentType} registrado manualmente`,
      occurredAt: new Date(),
      createdByUserId: null,
    })

    setOpen(false)
    window.location.reload()
  }

  const pendingBookings = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show' && b.remainingBalance > 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-pink-500 hover:bg-pink-600">Registrar pago</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago manual</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label>Reserva</Label>
            <select name="bookingId" required className="w-full border rounded-md p-2">
              <option value="">Selecciona una reserva</option>
              {pendingBookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  Reserva {booking.id.slice(-4)} — ${booking.remainingBalance.toLocaleString('es-CL')} pendiente
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tipo de pago</Label>
            <select name="paymentType" required className="w-full border rounded-md p-2">
              <option value="deposit">Abono</option>
              <option value="final_payment">Pago final</option>
              <option value="full_payment">Pago total</option>
            </select>
          </div>
          <div>
            <Label>Monto (CLP)</Label>
            <Input name="amount" type="number" required />
          </div>
          <div>
            <Label>Método de pago</Label>
            <Input name="paymentMethod" placeholder="Efectivo, transferencia, etc." required />
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600">
            Registrar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
