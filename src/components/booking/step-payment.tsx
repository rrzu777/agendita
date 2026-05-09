'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import { createBooking, confirmPayment } from '@/server/actions/bookings'

export function StepPayment({ data, onSuccess, onBack }: { data: BookingData; onSuccess: (id: string) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(false)

  async function handlePayment() {
    setLoading(true)
    
    const booking = await createBooking({
      serviceId: data.serviceId!,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      startDateTime: data.timeSlot!.start,
      endDateTime: data.timeSlot!.end,
      totalPrice: data.servicePrice,
      depositRequired: data.serviceDeposit,
      finalAmount: data.servicePrice,
    })

    await new Promise(resolve => setTimeout(resolve, 1500))
    await confirmPayment(booking.id, data.serviceDeposit)

    onSuccess(booking.id)
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Pago de abono</h2>
      <p className="text-gray-600 mb-6">Resumen de tu reserva</p>

      <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
        <div className="flex justify-between"><span className="text-gray-600">Servicio</span><span className="font-medium">{data.serviceName}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Fecha y hora</span><span className="font-medium">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Precio total</span><span className="font-medium">${data.servicePrice.toLocaleString('es-CL')}</span></div>
        <div className="border-t pt-2 flex justify-between"><span className="text-gray-600">Abono a pagar</span><span className="font-bold text-pink-600">${data.serviceDeposit.toLocaleString('es-CL')}</span></div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">Modo de desarrollo: El pago se simulara automaticamente.</p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} disabled={loading}>Atras</Button>
        <Button className="flex-1 bg-pink-500 hover:bg-pink-600" onClick={handlePayment} disabled={loading}>
          {loading ? 'Procesando...' : `Pagar abono $${data.serviceDeposit.toLocaleString('es-CL')}`}
        </Button>
      </div>
    </div>
  )
}
