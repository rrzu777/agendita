'use client'

import { BookingData } from './wizard'
import type { Service } from '@prisma/client'
import { Clock, Plus, Sparkles } from 'lucide-react'

interface StepServiceProps {
  data: BookingData
  services: Service[]
  onSelect: (data: Partial<BookingData>) => void
}

export function StepService({ data, services, onSelect }: StepServiceProps) {
  if (services.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-secondary text-primary">
          <Sparkles className="size-7" />
        </div>
        <h3 className="mb-2 font-heading text-2xl font-semibold text-primary">Aún no hay servicios</h3>
        <p className="text-base text-muted-foreground">
          Este negocio todavía no publicó sus servicios.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold leading-tight tracking-tight text-primary sm:text-4xl">¿Qué te hacemos hoy?</h2>
      <p className="mb-7 text-base text-muted-foreground">Elige un servicio para empezar tu reserva.</p>

      <div className="space-y-3">
        {services.map((service) => {
          const color = service.pastelColor || '#f4dbca'
          const isSelected = data.serviceId === service.id
          return (
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
              className="group w-full rounded-[1.75rem] border p-4 text-left transition-all hover:-translate-y-0.5 sm:p-5"
              style={{
                backgroundColor: `${color}24`,
                borderColor: isSelected ? color : `${color}66`,
                boxShadow: isSelected ? `0 0 0 2px ${color}` : 'none',
              }}
            >
              <div className="flex items-center gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-sm sm:size-14">
                  <Sparkles className="size-5 sm:size-6" />
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-heading text-lg font-semibold leading-snug text-primary sm:text-xl">{service.name}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {service.durationMinutes} min
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-primary">${service.price.toLocaleString('es-CL')}</span>
                    {service.depositAmount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>abono ${service.depositAmount.toLocaleString('es-CL')}</span>
                      </>
                    )}
                  </p>
                  {service.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground/90">{service.description}</p>
                  )}
                </div>

                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-primary transition-transform group-hover:scale-105">
                  <Plus className="size-4" />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
