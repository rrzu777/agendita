'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { createBooking } from '@/server/actions/bookings'
import { initiatePayment, verifyAndConfirmPayment } from '@/server/actions/payments'
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react'

export function StepPayment({ data, businessId, onSuccess, onBack }: { data: BookingData; businessId: string; onSuccess: (id: string) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'review' | 'processing' | 'success' | 'error'>('review')
  const [errorMessage, setErrorMessage] = useState('')

  async function handlePayment() {
    setLoading(true)
    setStep('processing')
    setErrorMessage('')

    try {
      // Create booking
      const booking = await createBooking({
        serviceId: data.serviceId!,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail,
        startDateTime: data.timeSlot!.start,
      }, businessId)

      // Initiate payment with provider
      const paymentResult = await initiatePayment({
        bookingId: booking.id,
        amount: data.serviceDeposit,
        currency: 'CLP',
        description: `Abono para ${data.serviceName}`,
      })

      // Verify payment (server-side) with timeout
      await new Promise(resolve => setTimeout(resolve, 1500))

      const verifyPromise = verifyAndConfirmPayment(paymentResult.paymentId, booking.id)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al verificar el pago')), 10000)
      )
      await Promise.race([verifyPromise, timeoutPromise])

      setStep('success')
      onSuccess(booking.id)
    } catch (err) {
      console.error('Payment error:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Error al procesar el pago')
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'processing') {
    return (
      <div className="py-14 text-center">
        <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
        <h2 className="mb-2 text-2xl font-semibold tracking-normal text-primary">Procesando pago...</h2>
        <p className="text-muted-foreground">Por favor no cierres esta ventana</p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="py-12 text-center">
        <AlertCircle className="mx-auto mb-4 size-9 text-destructive" />
        <h2 className="mb-2 text-2xl font-semibold tracking-normal text-primary">Error en el pago</h2>
        <p className="mb-5 text-muted-foreground">{errorMessage || 'No se pudo procesar el pago'}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={onBack}>Atrás</Button>
          <Button onClick={() => setStep('review')}>Intentar de nuevo</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-2 text-4xl font-semibold tracking-normal text-primary">Pago de abono</h2>
      <p className="mb-8 text-lg text-muted-foreground">Resumen de tu reserva</p>

      <div className="mb-6 space-y-3 rounded-xl bg-muted/55 p-5">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Servicio</span><span className="font-semibold text-primary">{data.serviceName}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fecha y hora</span><span className="font-semibold text-primary">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Precio total</span><span className="font-semibold text-primary">${data.servicePrice.toLocaleString('es-CL')}</span></div>
        <div className="flex justify-between gap-4 border-t border-border/60 pt-3"><span className="text-muted-foreground">Abono a pagar</span><span className="font-semibold text-primary">${data.serviceDeposit.toLocaleString('es-CL')}</span></div>
      </div>

      <div className="mb-6 flex gap-3 rounded-xl border border-border/70 bg-secondary/40 p-4 text-sm text-primary">
        <CreditCard className="mt-0.5 size-5 shrink-0" />
        <p>Modo de desarrollo: el pago se procesará con el proveedor simulado.</p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} disabled={loading}>Atrás</Button>
        <Button className="h-12 flex-1 text-base font-semibold" onClick={handlePayment} disabled={loading}>
          {loading ? 'Procesando...' : `Pagar abono $${data.serviceDeposit.toLocaleString('es-CL')}`}
        </Button>
      </div>
    </div>
  )
}
