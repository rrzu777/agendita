import type { Prisma, ServiceModality } from '@prisma/client'

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
 * La MISMA regla de arriba, escrita para Postgres.
 *
 * Vive pegada a `professionalChoice` y no en el módulo del servidor a propósito: son
 * las dos caras de una sola decisión —quién puede tomar esta reserva— y separarlas es
 * cómo se llega a que el funnel ofrezca a alguien que la escritura después rechaza.
 * Es el mismo criterio con el que `lib/availability/scope.ts` guarda juntas su
 * condición de Prisma y su fragmento de SQL crudo.
 *
 * Las dos fallas son mudas y asimétricas: si el filtro del navegador queda más
 * permisivo, la clienta elige a alguien y se entera del rechazo **en el paso de
 * pago**; si queda más restrictivo, la persona desaparece de la lista y nadie se
 * entera nunca. `tests/integration/funnel-profesional.test.ts` las ata: recorre una
 * matriz de persona × servicio × modalidad y exige que las dos contesten lo mismo.
 *
 * El `import type` de Prisma se borra al compilar, así que esto no le agrega nada al
 * bundle del navegador.
 *
 * `modality` acá NO es opcional: en el servidor es la modalidad ya resuelta, y un
 * `undefined` haría que Prisma borre la clave y el chequeo pase a ser "en cualquier
 * lado". El caso "todavía no hay modalidad" sólo existe en la pantalla.
 */
export function professionalEligibilityWhere(
  serviceId: string,
  modality: ServiceModality,
): Prisma.ProfessionalWhereInput {
  return {
    services: { some: { id: serviceId } },
    modalities: { has: modality },
  }
}

/**
 * La persona a nombre de quien queda la reserva, o `null`.
 *
 * Existe porque el caso `ask` tiene dos estados —todavía no eligió, o ya eligió— y la
 * diferencia entre "sin persona" y "falta elegir" no se puede leer del id suelto: los
 * dos son `null`. Acá el `null` de `ask` significa "el paso está pendiente" y el
 * wizard no deja pasar de ahí.
 *
 * También es el cerrojo contra el estado viejo: si la clienta eligió a alguien y
 * después volvió atrás y cambió de servicio, `elegido` puede ser de una persona que ya
 * no está entre las opciones. Devolverlo igual escribiría una reserva a nombre de
 * quien no hace ese servicio; el server la rechazaría, pero recién en el pago.
 */
function resolveProfessional(
  choice: ProfessionalChoice,
  elegido: string | null,
): FunnelProfessional | null {
  if (choice.kind === 'none') return null
  if (choice.kind === 'auto') return choice.professional
  return choice.options.find((p) => p.id === elegido) ?? null
}

/**
 * Los dos campos que el wizard guarda de la persona, derivados de una sola vez.
 *
 * El nombre está denormalizado —como `serviceName`— para que la confirmación y el paso
 * de la hora no necesiten el equipo entero. Eso trae la invariante de que el nombre
 * corresponda al id, y por eso los dos salen de acá: mientras cada call site los
 * escribía por su cuenta, la invariante dependía de que nadie se olvidara. Olvidarse
 * dejaba "Te atiende Ana" sobre una reserva que quedó a nombre de otra, sin que nada
 * fallara.
 */
export function professionalFields(
  choice: ProfessionalChoice,
  elegido: string | null,
): { professionalId: string | null; professionalName: string } {
  const persona = resolveProfessional(choice, elegido)
  return { professionalId: persona?.id ?? null, professionalName: persona?.name ?? '' }
}

