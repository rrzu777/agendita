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
  if (services.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
          <svg className="size-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-primary">No hay servicios disponibles</h3>
        <p className="text-sm text-muted-foreground">
          Este negocio aún no tiene servicios configurados.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-2 text-4xl font-semibold tracking-normal text-primary">¿Qué servicio necesitas?</h2>
      <p className="mb-8 text-lg text-muted-foreground">Selecciona el tratamiento que quieres reservar.</p>
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
                      {service.durationMinutes} minutos
                    </p>
                    {service.description && (
                      <p className="mt-5 text-base leading-relaxed text-muted-foreground">{service.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <div className="text-3xl font-semibold leading-none tracking-normal text-primary">
                      ${service.price.toLocaleString('es-CL')}
                    </div>
                    {service.depositAmount > 0 && (
                      <div className="mt-2 text-sm font-semibold text-muted-foreground">
                        Abono requerido: ${service.depositAmount.toLocaleString('es-CL')}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}
