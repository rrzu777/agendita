'use client'

import { Card, CardContent } from '@/components/ui/card'
import { BookingData } from './wizard'
import type { Service } from '@prisma/client'
import { Clock3 } from 'lucide-react'

interface StepServiceProps {
  data: BookingData
  services: Service[]
  onSelect: (data: Partial<BookingData>) => void
}

export function StepService({ data, services, onSelect }: StepServiceProps) {
  return (
    <div>
      <h2 className="mb-2 text-4xl font-semibold tracking-normal text-primary">Selecciona un servicio</h2>
      <p className="mb-8 text-lg text-muted-foreground">Elige el tratamiento que deseas realizarte hoy.</p>
      <div className="space-y-4">
        {services.map((service) => (
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
            <Card className={`rounded-2xl border bg-card transition-all hover:border-primary hover:shadow-[var(--cream-shadow)] ${data.serviceId === service.id ? 'border-primary bg-secondary/35 shadow-[var(--cream-shadow)]' : 'border-border/70'}`}>
              <CardContent className="p-5 sm:p-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-2xl font-semibold leading-tight text-primary">{service.name}</h3>
                    <p className="mt-4 flex items-center gap-2 text-base text-muted-foreground">
                      <Clock3 className="size-5 text-primary" />
                      {service.durationMinutes} min
                    </p>
                    {service.description && (
                      <p className="mt-5 text-base leading-relaxed text-muted-foreground">{service.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <div className="text-3xl font-semibold leading-none tracking-normal text-primary">
                      CLP {service.price.toLocaleString('es-CL')}
                    </div>
                    {service.depositAmount > 0 && (
                      <div className="mt-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Abono: CLP {service.depositAmount.toLocaleString('es-CL')}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
      <div className="mt-8 rounded-2xl border border-border/70 bg-muted/50 p-5 text-base leading-relaxed text-muted-foreground">
        Todos nuestros servicios incluyen preparación básica y confirmación digital de la reserva.
      </div>
    </div>
  )
}
