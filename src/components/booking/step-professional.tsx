'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { User, Users } from 'lucide-react'
import { ANYONE_LABEL, type FunnelProfessional, type ProfessionalPick } from '@/lib/professionals/eligible'

interface StepProfessionalProps {
  options: FunnelProfessional[]
  selected: ProfessionalPick
  serviceName: string
  /** "Elegí tu barbero" | "Elegí tu manicurista" — del vocabulario del rubro. */
  title: string
  onSelect: (pick: ProfessionalPick) => void
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
      className={`group flex w-full items-center gap-4 rounded-[1.75rem] border p-4 text-left transition-all hover:-translate-y-0.5 sm:p-5 ${
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
export function StepProfessional({ options, selected, serviceName, title, onSelect, onBack }: StepProfessionalProps) {
  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold leading-tight tracking-tight text-primary sm:text-4xl">{title}</h2>
      <p className="mb-7 text-base text-muted-foreground">
        {serviceName} · cada persona tiene su propia agenda, así que los horarios cambian según a quién elijas.
      </p>

      <div className="space-y-3">
        <OptionCard
          icon={<Users className="size-5 sm:size-6" />}
          name={ANYONE_LABEL}
          detail="Ves los horarios de todo el equipo y te asignamos a quien esté libre a esa hora."
          isSelected={selected.kind === 'anyone'}
          onClick={() => onSelect({ kind: 'anyone' })}
        />

        {options.map((professional) => (
          <OptionCard
            key={professional.id}
            icon={<User className="size-5 sm:size-6" />}
            name={professional.name}
            detail={professional.bio}
            isSelected={selected.kind === 'person' && selected.id === professional.id}
            onClick={() => onSelect({ kind: 'person', id: professional.id })}
          />
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Button variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
      </div>
    </div>
  )
}
