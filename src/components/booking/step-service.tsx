'use client'

import { mockBusiness } from '@/lib/data/mock-business'
import { Card, CardContent } from '@/components/ui/card'
import { BookingData } from './wizard'

export function StepService({ data, onSelect }: { data: BookingData; onSelect: (data: Partial<BookingData>) => void }) {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Elige un servicio</h2>
      <p className="text-gray-600 mb-6">Selecciona el servicio que deseas agendar</p>
      <div className="space-y-4">
        {mockBusiness.services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect({
              serviceId: service.id,
              serviceName: service.name,
              servicePrice: service.price,
              serviceDuration: service.durationMinutes,
              serviceDeposit: service.depositAmount,
              serviceColor: service.pastelColor,
            })}
            className="w-full text-left"
          >
            <Card className="hover:shadow-md transition-shadow border-0 shadow-sm overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: service.pastelColor }} />
              <CardContent className="p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{service.name}</h3>
                    <p className="text-gray-600 text-sm mt-1">{service.description}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">${service.price.toLocaleString('es-CL')}</div>
                    <div className="text-sm text-gray-500">{service.durationMinutes} min</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-500">
                  Abono requerido: <span className="font-medium">${service.depositAmount.toLocaleString('es-CL')}</span>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}
