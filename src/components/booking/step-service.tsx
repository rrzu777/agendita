'use client'

import { useState } from 'react'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'
import { BookingData } from './wizard'
import type { Service, ServiceModality } from '@prisma/client'
import { formatDuration } from '@/lib/format-duration'
import { formatMoney } from '@/lib/money'
import { MODALITY_LABELS, sortModalities } from '@/lib/services/modality'
import { Clock, Plus, Sparkles } from 'lucide-react'

interface StepServiceProps {
  data: BookingData
  services: Service[]
  currency: string
  onSelect: (data: Partial<BookingData>) => void
}

/** Campos denormalizados del servicio en BookingData, sin la modalidad. */
function serviceFields(service: Service, modalities: ServiceModality[]) {
  return {
    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDuration: service.durationMinutes,
    serviceDeposit: service.depositAmount,
    serviceColor: service.pastelColor,
    serviceModalities: modalities,
  }
}

export function StepService({ data, services, currency, onSelect }: StepServiceProps) {
  const analytics = usePublicAnalytics()
  // Servicio cuya tarjeta está desplegada esperando que elija dónde. Un solo id:
  // abrir otro cierra el anterior.
  const [pickingModalityFor, setPickingModalityFor] = useState<string | null>(null)

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
          const modalities = sortModalities(service.modalities)
          // Con una sola modalidad no hay nada que preguntar: el click avanza
          // igual que siempre. Con varias, despliega el "¿dónde?" y avanza recién
          // cuando elige, para no meter un paso más en el funnel.
          const needsModalityChoice = modalities.length > 1
          const isPicking = pickingModalityFor === service.id
          return (
            <div key={service.id}>
            <button
              onClick={() => {
                if (!needsModalityChoice || !isPicking) analytics.track({ type: 'service_considered', data: { serviceId: service.id } })
                if (needsModalityChoice) {
                  setPickingModalityFor(isPicking ? null : service.id)
                  return
                }
                onSelect({ ...serviceFields(service, modalities), serviceModality: modalities[0] ?? null, serviceAddress: '' })
              }}
              aria-expanded={needsModalityChoice ? isPicking : undefined}
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
                      {formatDuration(service.durationMinutes)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-primary">{formatMoney(service.price, currency)}</span>
                    {service.depositAmount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>abono {formatMoney(service.depositAmount, currency)}</span>
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
            {needsModalityChoice && isPicking && (
              <div className="mt-2 space-y-2 rounded-2xl border border-border bg-card p-3">
                <p className="text-sm font-semibold text-primary">¿Dónde te lo hacemos?</p>
                <div className="flex flex-wrap gap-2">
                  {modalities.map((modality) => (
                    <button
                      key={modality}
                      type="button"
                      onClick={() => onSelect({
                        ...serviceFields(service, modalities),
                        serviceModality: modality,
                        // Cambiar de modalidad tira la dirección: la de la vuelta
                        // anterior no tiene por qué valer para esta.
                        serviceAddress: '',
                      })}
                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-primary transition hover:border-primary hover:bg-secondary/50"
                    >
                      {MODALITY_LABELS[modality]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
