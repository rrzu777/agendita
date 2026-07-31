import Link from 'next/link'
import { Button } from '@/components/ui/button'

export interface ScheduleScopeOption {
  id: string
  name: string
}

/**
 * El nombre del parámetro que dice de quién es el horario que se está mirando. Vive acá
 * —con el componente que ESCRIBE los hrefs— y lo importa quien los lee, porque son las
 * dos mitades de un contrato: escrito literal en los dos lados, renombrarlo en uno deja
 * al otro cayendo siempre en el salón, que es un default plausible y por eso no falla
 * en ningún lado.
 */
export const SCOPE_PARAM = 'persona'

/**
 * De quién es el horario que se está mirando, resuelto contra la gente que atiende.
 *
 * Lo que no matchea —un id ajeno, o de alguien que se dio de baja después de que
 * alguien guardó el link— cae en el salón. Pasarlo crudo a `getWeeklySchedule` haría
 * tirar `ForbiddenError` y **se caería la pantalla entera por un parámetro de la URL**;
 * el salón siempre existe y es el estado por defecto.
 *
 * Vive acá y no en la página porque la mitad de bloqueos de esta misma pantalla necesita
 * exactamente la misma resolución: con dos copias, las dos mitades de una pantalla
 * pueden discrepar sobre una sola URL sin que falle nada.
 */
export function resolveScheduleScope<T extends ScheduleScopeOption>(
  professionals: T[],
  params: { [SCOPE_PARAM]?: string },
): T | null {
  return professionals.find((p) => p.id === params[SCOPE_PARAM]) ?? null
}

interface ScheduleScopePickerProps {
  professionals: ScheduleScopeOption[]
  /** `null` = el salón. */
  selectedId: string | null
  /** El sustantivo de oficio en plural, del vocabulario del rubro ("Barberos"). */
  professionalsLabel: string
}

/**
 * El selector de alcance. Sin JS: cada opción es un link, así que la página entera se
 * re-renderiza en el servidor con el alcance elegido. Elegir persona cambia lo que
 * muestran varias secciones —el horario, y más adelante los bloqueos—, y hacerlo por URL
 * es lo que mantiene todas de acuerdo sin pasarse el estado entre componentes cliente.
 *
 * No se dibuja cuando el negocio no tiene equipo: sin nadie a quién elegir, un selector
 * con una sola opción es ruido en la pantalla que las dueñas ya tenían.
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
          // `Button asChild` y no clases a mano: es el mismo control que el botón de
          // soltar el horario, que queda justo abajo. Con pills escritas aparte los dos
          // ya se ven distintos en modo oscuro y enfocan distinto con el teclado.
          <Button
            key={option.id ?? 'salon'}
            variant={isSelected ? 'default' : 'outline'}
            size="sm"
            className="rounded-full px-4"
            asChild
          >
            <Link
              href={option.id === null
                ? '/dashboard/availability'
                : `/dashboard/availability?${SCOPE_PARAM}=${option.id}`}
              aria-current={isSelected ? 'page' : undefined}
            >
              {option.name}
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}
