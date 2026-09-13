'use client'

import { useEffect, useState } from 'react'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'
import type { BookingData } from './wizard'
import type { Service } from '@prisma/client'
import type { ServiceModality } from '@prisma/client'
import { formatDuration } from '@/lib/format-duration'
import { formatMoney } from '@/lib/money'
import { MODALITY_LABELS } from '@/lib/services/modality'
import { wizardServiceFields, wizardServiceIds } from '@/lib/bookings/wizard-selection'
import { Button } from '@/components/ui/button'
import { Check, Plus } from 'lucide-react'

interface StepServiceProps {
  data: BookingData
  services: Service[]
  currency: string
  onSelect: (data: Partial<BookingData>) => void
  onContinue: () => void
  onInteraction?: () => void
  selectionError?: string | null
  selectionCompatible?: (serviceIds: string[], modality: ServiceModality | null) => boolean
}

export function StepService({ data, services, currency, onSelect, onContinue, onInteraction, selectionError, selectionCompatible }: StepServiceProps) {
  const analytics = usePublicAnalytics()
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // Until React owns the server-rendered buttons, a fast click would be lost.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration readiness is client-only state.
    setHydrated(true)
  }, [])
  const selectedIds = wizardServiceIds(data)
  const groups = new Map<string, Service[]>()
  for (const service of services) {
    const category = (service as Service & { category?: string | null }).category?.trim() || 'Servicios'
    groups.set(category, [...(groups.get(category) ?? []), service])
  }
  function toggle(service: Service) {
    onInteraction?.()
    analytics.track({ type: 'service_considered', data: { serviceId: service.id } })
    const ids = selectedIds.includes(service.id) ? selectedIds.filter(id => id !== service.id) : [...selectedIds, service.id]
    const action = selectedIds.includes(service.id) ? 'remove' as const : 'add' as const
    try {
      const selection = wizardServiceFields(ids, services)
      const modality = data.serviceModality && selection.serviceModalities.includes(data.serviceModality) ? data.serviceModality : selection.serviceModalities.length === 1 ? selection.serviceModalities[0] : null
      const result = selectionCompatible?.(ids, modality) === false ? 'incompatible' as const : 'accepted' as const
      analytics.track({ type: 'service_selection_changed', data: { serviceId: service.id, action, result, selectedServiceIds: ids } })
      onSelect({ ...selection, serviceModality: modality, ...(modality !== data.serviceModality ? { serviceAddress: '' } : {}) })
      setError(null)
    } catch (e) {
      analytics.track({ type: 'service_selection_changed', data: { serviceId: service.id, action, result: 'incompatible', selectedServiceIds: selectedIds } })
      setError(e instanceof Error ? e.message : 'No pudimos agregar el servicio')
    }
  }
  return (
    <div>
      <h2 className="mb-2 font-heading text-3xl font-semibold text-primary sm:text-4xl">¿Qué te hacemos hoy?</h2>
      <p className="mb-6 text-muted-foreground">Elige uno o varios servicios para una misma cita. Te atenderá la misma persona.</p>
      {!services.length && <p className="py-8">Este negocio todavía no publicó sus servicios.</p>}
      {[...groups].map(([category, rows]) => <section key={category} className="mb-6" aria-label={category}>
        {groups.size > 1 && <h3 className="mb-3 font-heading text-lg font-semibold text-primary">{category}</h3>}
        <div className="divide-y divide-border/60">
          {rows.map(service => {
            const selected = selectedIds.includes(service.id)
            return <button key={service.id} type="button" aria-pressed={selected} disabled={!hydrated} onClick={() => toggle(service)} className={`flex min-h-20 w-full items-center gap-4 rounded-xl px-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected ? 'bg-secondary/50' : 'hover:bg-muted/50'}`}>
              <span className="min-w-0 flex-1">
                <span className="block break-words font-heading text-lg font-semibold text-primary">{service.name}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{formatDuration(service.durationMinutes)} · {formatMoney(service.price, currency)}{service.depositAmount > 0 ? ` · abono ${formatMoney(service.depositAmount, currency)}` : ' · sin abono'}</span>
                {service.description && <span className="mt-1 block text-sm text-muted-foreground">{service.description}</span>}
              </span>
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{selected ? <Check className="size-4" /> : <Plus className="size-4" />}</span>
            </button>
          })}
        </div>
      </section>)}
      {data.serviceModalities.length > 1 && <fieldset className="mb-6">
        <legend className="mb-2 font-semibold">¿Dónde te lo hacemos? (requerido)</legend>
        <div className="flex flex-wrap gap-2">{data.serviceModalities.map(modality => <label key={modality} className="flex items-center gap-2 rounded-full border border-border px-4 py-3">
          <input type="radio" name="booking-modality" checked={data.serviceModality === modality} onChange={() => onSelect({ serviceModality: modality, serviceAddress: '' })} />{MODALITY_LABELS[modality]}
        </label>)}</div>
      </fieldset>}
      {(error || selectionError) && <p role="alert" className="mb-4 text-sm text-destructive">{error || selectionError}</p>}
      {!!selectedIds.length && <div className="sticky bottom-0 -mx-2 border-t border-border bg-card px-2 pb-2 pt-4" aria-live="polite">
        <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
          <span>{selectedIds.length} {selectedIds.length === 1 ? 'servicio' : 'servicios'} · {formatDuration(data.serviceDuration)}</span>
          <span className="font-semibold">Total {formatMoney(data.servicePrice, currency)}</span>
          <span className="w-full text-muted-foreground">{data.serviceDeposit > 0 ? `Abono: ${formatMoney(data.serviceDeposit, currency)}` : 'Sin abono. Pago según las condiciones del negocio.'}</span>
        </div>
        <Button className="h-12 w-full rounded-full" disabled={!data.serviceModality || !!selectionError} onClick={onContinue}>Continuar</Button>
      </div>}
    </div>
  )
}
