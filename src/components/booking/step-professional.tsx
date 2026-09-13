'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { User, Users } from 'lucide-react'
import { ANYONE_LABEL, type FunnelProfessional, type ProfessionalPick } from '@/lib/professionals/eligible'
import type { BookingData } from './wizard'
import { getAvailabilityPreview } from '@/server/actions/availability'
import { wizardServiceIds } from '@/lib/bookings/wizard-selection'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'

interface StepProfessionalProps {
  preview?: { businessId: string; timezone: string; data: BookingData }
  options: FunnelProfessional[]
  selected: ProfessionalPick
  serviceName: string
  /** Título del rubro, por ejemplo "Elige tu barbero" o "Elige tu manicurista". */
  title: string
  onSelect: (pick: ProfessionalPick) => void
  onContinue: () => void
  onBack: () => void
}

function OptionCard({
  icon,
  name,
  detail,
  isSelected,
  onClick,
}: {
  icon: ReactNode
  name: string
  detail: string | null
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`group flex min-h-16 w-full items-center gap-4 rounded-[var(--radius)] border p-4 text-left transition-colors sm:p-5 ${
        isSelected
          ? 'border-primary bg-secondary/60 shadow-[var(--cream-shadow)]'
          : 'border-border/70 bg-card hover:border-primary'
      }`}
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary shadow-sm sm:size-14">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-heading text-lg font-semibold leading-snug text-primary sm:text-xl">{name}</h3>
        {detail && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground/90">{detail}</p>
        )}
      </div>
    </button>
  )
}

/**
 * Con quién se atiende. El paso existe sólo cuando hay dos o más personas que hacen
 * ese servicio: con una sola no hay nada que preguntar y la reserva igual queda a su
 * nombre (ver `professionalChoice`).
 *
 * "Cualquiera disponible" va **primero** porque es la respuesta de la mayoría —quien
 * ya tiene a alguien lo busca igual— y porque es la que más horarios ofrece: los de
 * todo el equipo juntos. A quién le toca se decide al reservar, no acá.
 *
 * El título sale del vocabulario y el resto del copy no nombra el oficio: en la
 * lista van nombres propios, que no necesitan género, y así una frase de acá no se
 * vuelve "la estilista" en un salón de estilistas varones. Es la misma regla que ya
 * sigue la pantalla de equipo del panel.
 */
export function StepProfessional({ options, selected, serviceName, title, onSelect, onContinue, onBack, preview }: StepProfessionalProps) {
  const query = preview ? JSON.stringify([preview.businessId, wizardServiceIds(preview.data), preview.data.serviceModality, preview.timezone]) : ''
  const [result, setResult] = useState<{ query: string; value: Awaited<ReturnType<typeof getAvailabilityPreview>> } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!preview) return
    let cancelled = false
    getAvailabilityPreview({ businessId: preview.businessId, serviceIds: wizardServiceIds(preview.data), modality: preview.data.serviceModality, professional: { kind: 'anyone' }, from: getLocalDateStr(new Date(), preview.timezone), days: 14 })
      .then(value => { if (!cancelled) setResult({ query, value }) })
      .catch(() => { if (!cancelled) setResult({ query, value: { ok: false, error: 'No pudimos consultar la próxima hora.' } }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query carries all preview dimensions.
  }, [query, retry])
  const current = result?.query === query ? result.value : null
  function nextLabel(id?: string) {
    if (!preview) return ''
    if (!current) return 'Consultando próxima hora…'
    if (!current.ok) return 'Consulta los horarios al continuar.'
    const next = id ? current.data.professionals.find(p => p.id === id)?.firstSlot : current.data.days.find(d => d.firstSlot)?.firstSlot
    return next ? `Próxima hora: ${formatBookingDateTime(next.start, preview.timezone)}` : 'Sin horas en los próximos 14 días. Puedes revisar fechas posteriores.'
  }
  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold leading-tight tracking-tight text-primary sm:text-4xl">{title}</h2>
      <p className="mb-7 text-base text-muted-foreground">
        Elegir una persona es opcional. {serviceName}: todos los servicios serán con la misma persona.
      </p>

      <div className="space-y-3">
        <OptionCard
          icon={<Users className="size-5 sm:size-6" />}
          name={ANYONE_LABEL}
          detail={`Ves los horarios de todo el equipo. ${nextLabel()}`}
          isSelected={selected.kind === 'anyone' || selected.kind === 'none'}
          onClick={() => onSelect({ kind: 'anyone' })}
        />

        {options.map((professional) => (
          <OptionCard
            key={professional.id}
            icon={<User className="size-5 sm:size-6" />}
            name={professional.name}
            detail={[professional.bio, nextLabel(professional.id)].filter(Boolean).join(' ')}
            isSelected={selected.kind === 'person' && selected.id === professional.id}
            onClick={() => onSelect({ kind: 'person', id: professional.id })}
          />
        ))}
      </div>

      {current && !current.ok && <div role="alert" className="mt-4 text-sm"><p>{current.error}</p><button type="button" className="inline-flex min-h-11 items-center px-2 underline" onClick={() => { setResult(null); setRetry(n => n + 1) }}>Reintentar consulta</button></div>}

      <div className="mt-8 flex gap-3">
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
        <Button className="h-12 flex-1 rounded-full" onClick={() => { if (selected.kind === 'none') onSelect({ kind: 'anyone' }); onContinue() }}>Continuar</Button>
      </div>
    </div>
  )
}
