import type { ServiceModality } from '@prisma/client'

/**
 * Lo que el funnel público sabe de cada persona del equipo. Es un tipo propio y no
 * el `Professional` de Prisma a propósito: esto viaja al navegador dentro del
 * payload de un negocio público, así que la lista de campos es la decisión de qué
 * se publica. `bio` entra porque ayuda a elegir; nada más.
 */
export interface FunnelProfessional {
  id: string
  name: string
  bio: string | null
  /** Dónde atiende. Se intersecta con la modalidad ya elegida en el paso 1. */
  modalities: ServiceModality[]
  /** Qué servicios hace. Los ids alcanzan: el nombre ya lo tiene el paso anterior. */
  serviceIds: string[]
}

/**
 * Qué tiene que hacer el funnel con el equipo, para el servicio y la modalidad que
 * la clienta ya eligió.
 *
 * Son tres casos y no un booleano porque **el paso no es lo único que cambia**: con
 * una sola persona elegible no hay nada que preguntar pero la reserva igual queda a
 * su nombre, y eso no se lee de "¿muestro el paso?". Devolver un tipo cerrado obliga
 * a cada caller a contestar los tres.
 *
 * - `none` — el funnel de siempre, la reserva va sin persona (`professionalId = null`,
 *   que contra la agenda significa "choca contra todas"). Es lo que pasa en un negocio
 *   sin equipo cargado, que hoy son todos.
 * - `auto` — hay exactamente una: se le asigna sin preguntar. **Esto cambia los
 *   horarios que se ofrecen**, porque pasan a salir de SU horario en vez del horario
 *   del negocio. Cuando no tiene horario propio hereda el del negocio y el resultado
 *   es idéntico al de hoy; cuando lo tiene, ofrecer el del negocio era el bug.
 * - `ask` — dos o más: el paso aparece.
 */
export type ProfessionalChoice =
  | { kind: 'none' }
  | { kind: 'auto'; professional: FunnelProfessional }
  | { kind: 'ask'; options: FunnelProfessional[] }

/**
 * `professionals` llega ya filtrada a la gente activa y ordenada por `sortOrder`
 * (lo hace la query pública); acá sólo se recorta por servicio y modalidad, y el
 * orden de entrada se respeta — es el que eligió la dueña.
 *
 * `modality` puede ser `null` mientras la clienta no llegó a elegir servicio. En ese
 * caso no se filtra por modalidad porque no hay nada con qué comparar; el caller no
 * llega a usar el resultado hasta que haya servicio.
 */
export function professionalChoice(
  professionals: FunnelProfessional[],
  serviceId: string | null,
  modality: ServiceModality | null,
): ProfessionalChoice {
  if (!serviceId) return { kind: 'none' }

  const options = professionals.filter(
    (p) =>
      p.serviceIds.includes(serviceId) &&
      // Un servicio a domicilio con alguien que no sale del local es una
      // combinación que existe en los datos y que no se puede ofrecer.
      (modality === null || p.modalities.includes(modality)),
  )

  if (options.length === 0) return { kind: 'none' }
  if (options.length === 1) return { kind: 'auto', professional: options[0] }
  return { kind: 'ask', options }
}

/**
 * El id que le corresponde a la reserva según la elección de la clienta.
 *
 * Existe porque el caso `ask` tiene dos estados —todavía no eligió, o ya eligió— y
 * la diferencia entre "sin persona" y "falta elegir" no se puede leer del
 * `professionalId` suelto: los dos son `null`. Acá el `null` de `ask` significa
 * "el paso está pendiente" y el wizard no deja pasar de ahí.
 *
 * También es el cerrojo contra el estado viejo: si la clienta eligió a alguien y
 * después volvió atrás y cambió de servicio, `elegido` puede ser de una persona que
 * ya no está entre las opciones. Devolverlo igual escribiría una reserva a nombre de
 * quien no hace ese servicio; el server la rechazaría, pero recién en el pago.
 */
export function resolveProfessionalId(choice: ProfessionalChoice, elegido: string | null): string | null {
  if (choice.kind === 'none') return null
  if (choice.kind === 'auto') return choice.professional.id
  return choice.options.some((p) => p.id === elegido) ? elegido : null
}
