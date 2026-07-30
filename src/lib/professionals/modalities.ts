import { ServiceModality } from '@prisma/client'
import { sortModalities } from '@/lib/services/modality'

/**
 * Las modalidades que le corresponden a alguien por los servicios que hace: la
 * UNIÓN, no la intersección.
 *
 * Por qué la unión: si hace un servicio a domicilio y otro en el local, trabaja
 * en las dos, y la intersección la dejaría sin ninguna. El recorte por persona
 * ("Juan no viaja") es una decisión de la dueña, que destilda a mano; esto es
 * sólo el punto de partida.
 *
 * Por qué existe como función y no como un `useState` adentro del formulario: se
 * usa en DOS lugares — el formulario, para pre-marcar los checkboxes, y el
 * servidor, cuando el payload no trae modalidades. Si sólo viviera en la UI, un
 * alta por otra vía dejaría a la persona en `on_site` a secas y un servicio
 * online-only se quedaría sin nadie que lo pueda dar, sin que el negocio se
 * entere.
 *
 * Sin servicios (o con servicios sin modalidades, que es un dato corrupto)
 * devuelve `[on_site]`, el mismo default que el schema: una lista vacía dejaría
 * a la persona sin poder atender nada.
 */
export function deriveModalities(
  services: { modalities: ServiceModality[] }[],
): ServiceModality[] {
  const union = new Set(services.flatMap((s) => s.modalities))
  if (union.size === 0) return [ServiceModality.on_site]
  return sortModalities([...union])
}
