import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface ScheduleScopeOption {
  id: string
  name: string
}

interface ScheduleScopePickerProps {
  professionals: ScheduleScopeOption[]
  /** `null` = el salón. */
  selectedId: string | null
  /** El sustantivo de oficio en plural, del vocabulario del rubro ("Barberos"). */
  professionalsLabel: string
}

/**
 * De quién es el horario que se está editando. Sin JS: cada opción es un link con
 * `?persona=`, así que la página entera se re-renderiza en el servidor con el alcance
 * elegido. Elegir persona cambia lo que muestran varias secciones —el horario, y más
 * adelante los bloqueos—, y hacerlo por URL es lo que mantiene todas de acuerdo sin
 * pasarse el estado entre componentes cliente.
 *
 * No se dibuja cuando el negocio no tiene equipo: sin nadie a quién elegir, un selector
 * con una sola opción es ruido.
 */
export function ScheduleScopePicker({
  professionals,
  selectedId,
  professionalsLabel,
}: ScheduleScopePickerProps) {
  if (professionals.length === 0) return null

  const options = [{ id: null as string | null, name: 'Todo el salón' }, ...professionals]

  return (
    <nav aria-label={`Horario del salón o de cada ${professionalsLabel.toLowerCase()}`} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = option.id === selectedId
        return (
          <Link
            key={option.id ?? 'salon'}
            href={option.id === null ? '/dashboard/availability' : `/dashboard/availability?persona=${option.id}`}
            aria-current={isSelected ? 'page' : undefined}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border/60 bg-card text-muted-foreground hover:text-primary',
            )}
          >
            {option.name}
          </Link>
        )
      })}
    </nav>
  )
}
