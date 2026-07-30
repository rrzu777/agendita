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
 * servidor, cuando el payload no trae modalidades.
 *
 * Ojo con lo que esto NO garantiza: derivar de una lista vacía devuelve
 * `[on_site]`, así que un alta sin servicios asignados igual queda "en el local" y
 * un negocio 100% online se puede quedar con un servicio que nadie da. Lo que
 * evita ese estado es el default del formulario, que arranca con todos los
 * servicios activos tildados — o sea que la defensa vive en el cliente y esto es
 * sólo el cálculo. Si algún día hay otra vía de alta, la defensa hay que
 * repetirla ahí; no alcanza con llamar a esta función.
 *
 * El `[on_site]` de la lista vacía es el mismo default que el schema: devolver
 * una lista vacía dejaría a la persona sin poder atender nada, que es peor.
 */
export function deriveModalities(
  services: { modalities: ServiceModality[] }[],
): ServiceModality[] {
  const union = new Set(services.flatMap((s) => s.modalities))
  if (union.size === 0) return [ServiceModality.on_site]
  return sortModalities([...union])
}
