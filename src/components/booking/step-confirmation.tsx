'use client'

import { Button } from '@/components/ui/button'
import { BookingData } from './wizard'
import Link from 'next/link'

export function StepConfirmation({ data, bookingId }: { data: BookingData; bookingId: string | null }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-2">Reserva confirmada!</h2>
      <p className="text-gray-600 mb-6">Tu reserva ha sido confirmada.</p>

      <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left space-y-2">
        <div className="flex justify-between"><span className="text-gray-600">Servicio</span><span className="font-medium">{data.serviceName}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Fecha y hora</span><span className="font-medium">{data.date?.toLocaleDateString('es-CL')} {data.timeSlot?.start.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Precio total</span><span className="font-medium">${data.servicePrice.toLocaleString('es-CL')}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">Abono pagado</span><span className="font-medium text-green-600">${data.serviceDeposit.toLocaleString('es-CL')}</span></div>
        <div className="flex justify-between border-t pt-2"><span className="text-gray-600">Saldo pendiente</span><span className="font-bold">${(data.servicePrice - data.serviceDeposit).toLocaleString('es-CL')}</span></div>
      </div>

      <p className="text-sm text-gray-500 mb-6">Numero de reserva: {bookingId}</p>

      <Link href="/">
        <Button className="bg-pink-500 hover:bg-pink-600">Volver al inicio</Button>
      </Link>
    </div>
  )
}
