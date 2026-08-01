import { User } from 'lucide-react'

/**
 * De quién es un bloqueo ya guardado, para las tres listas que lo muestran (sueltos,
 * recurrentes y las tarjetas del calendario).
 *
 * **Quién decide si se dibuja es quien llama, no esto**: recibe `label` en `null` para
 * callar. El motivo es que "no hay nada que aclarar" significa cosas distintas en cada
 * lista —en un negocio sin equipo no hay dueños posibles; mirando el horario del
 * negocio todos los bloqueos son suyos por definición— y esa pregunta se contesta con
 * el contexto de la pantalla, que acá no está. Con la regla adentro, la tercera lista
 * hubiera necesitado una excepción.
 */
export function BlockOwnerTag({ label }: { label: string | null }) {
  if (label === null) return null

  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <User className="size-3" aria-hidden="true" />
      {label}
    </span>
  )
}
