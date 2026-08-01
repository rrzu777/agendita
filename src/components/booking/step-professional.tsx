'use client'

import { Button } from '@/components/ui/button'
import { User } from 'lucide-react'
import type { FunnelProfessional } from '@/lib/professionals/eligible'

interface StepProfessionalProps {
  options: FunnelProfessional[]
  selectedId: string | null
  serviceName: string
  /** "Elegí tu barbero" | "Elegí tu manicurista" — del vocabulario del rubro. */
  title: string
  onSelect: (professional: FunnelProfessional) => void
  onBack: () => void
}

/**
 * Con quién se atiende. El paso existe sólo cuando hay dos o más personas que hacen
 * ese servicio: con una sola no hay nada que preguntar y la reserva igual queda a su
 * nombre (ver `professionalChoice`).
 *
 * El título sale del vocabulario y el resto del copy no nombra el oficio: en la
 * lista van nombres propios, que no necesitan género, y así una frase de acá no se
 * vuelve "la estilista" en un salón de estilistas varones. Es la misma regla que ya
 * sigue la pantalla de equipo del panel.
 */
export function StepProfessional({ options, selectedId, serviceName, title, onSelect, onBack }: StepProfessionalProps) {
  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold leading-tight tracking-tight text-primary sm:text-4xl">{title}</h2>
      <p className="mb-7 text-base text-muted-foreground">
        {serviceName} · cada persona tiene su propia agenda, así que los horarios cambian según a quién elijas.
      </p>

      <div className="space-y-3">
        {options.map((professional) => {
          const isSelected = selectedId === professional.id
          return (
            <button
              key={professional.id}
              type="button"
              onClick={() => onSelect(professional)}
              aria-pressed={isSelected}
              className={`group flex w-full items-center gap-4 rounded-[1.75rem] border p-4 text-left transition-all hover:-translate-y-0.5 sm:p-5 ${
                isSelected
                  ? 'border-primary bg-secondary/60 shadow-[var(--cream-shadow)]'
                  : 'border-border/70 bg-card hover:border-primary'
              }`}
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary shadow-sm sm:size-14">
                <User className="size-5 sm:size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-heading text-lg font-semibold leading-snug text-primary sm:text-xl">{professional.name}</h3>
                {professional.bio && (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground/90">{professional.bio}</p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-8 flex gap-3">
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
      </div>
    </div>
  )
}
