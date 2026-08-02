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
 * Qué columnas hacen falta para armar un `FunnelProfessional`, escrito una sola vez.
 *
 * Lo usan la query pública del negocio y la del cálculo de "cualquiera disponible", y
 * es la misma lista a propósito: si una trajera menos campos que la otra, el filtro de
 * elegibilidad daría distinto en cada superficie sin que nada fallara.
 *
 * Es un objeto literal —`satisfies` sólo lo tipa— así que no arrastra Prisma al bundle
 * del navegador.
 */
export const funnelProfessionalSelect = {
  id: true,
  name: true,
  bio: true,
  modalities: true,
  services: { select: { id: true } },
} satisfies Prisma.ProfessionalSelect

/** Aplana la relación de Prisma: al funnel le sirve la lista de ids, no el anidado. */
export function toFunnelProfessionals(
  rows: {
    id: string
    name: string
    bio: string | null
    modalities: ServiceModality[]
    services: { id: string }[]
  }[],
): FunnelProfessional[] {
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    bio: p.bio,
    modalities: p.modalities,
    serviceIds: p.services.map((s) => s.id),
  }))
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

/** La gente que puede tomar esta reserva, sin importar si el funnel pregunta o no. */
export function eligibleProfessionals(choice: ProfessionalChoice): FunnelProfessional[] {
  if (choice.kind === 'none') return []
  return choice.kind === 'auto' ? [choice.professional] : choice.options
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
 * Cómo se llama la opción "me da igual" en toda la app. No entra al vocabulario por
 * rubro (`lib/vocabulary`) a propósito: no varía ni por género ni por oficio, y ese
 * módulo guarda sólo lo que varía.
 */
export const ANYONE_LABEL = 'Cualquiera disponible'

/**
 * A nombre de quién va la reserva, tal como quedó elegido en el funnel.
 *
 * Es un tipo cerrado y no un `professionalId: string | null` porque **hay tres
 * respuestas, no dos**, y las dos que comparten el `null` significan cosas opuestas:
 *
 * - `none` — no hay equipo elegible. La reserva va sin persona y contra la agenda
 *   choca contra TODAS (ver `bookingBlocksProfessional`). Es lo que pasa hoy en un
 *   negocio sin equipo cargado. En un paso `ask` significa además "todavía no
 *   eligió", y el wizard no deja pasar de ahí.
 * - `anyone` — "Cualquiera disponible". Los horarios que se ofrecen son la UNIÓN de
 *   los del equipo elegible, y **quién atiende lo decide el servidor adentro de la
 *   transacción** (`assertSlotAndResolveProfessional`). El navegador nunca resuelve
 *   esto: entre que se muestra la hora y se escribe la reserva, la persona que
 *   parecía libre puede haberse ocupado.
 * - `person` — esa y nadie más.
 *
 * Con un booleano al lado del id, `{ id: 'juan', anyone: true }` sería representable
 * y no querría decir nada; peor, un lector que mirara sólo el id trataría `anyone`
 * como `none` —horario del negocio en vez de la unión del equipo— sin un error en
 * ningún lado. Es el mismo criterio de `BlockScope`.
 */
export type ProfessionalPick =
  | { kind: 'none' }
  | { kind: 'anyone' }
  | { kind: 'person'; id: string }

/** El caso vacío, escrito una sola vez: es el default de todos los callers viejos. */
export const NO_PROFESSIONAL: ProfessionalPick = { kind: 'none' }

/** ¿Es la misma elección? Cambiarla invalida la hora elegida: la agenda es otra. */
export function samePick(a: ProfessionalPick, b: ProfessionalPick): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== 'person' || a.id === (b as { id: string }).id
}

/**
 * Los dos campos que el wizard guarda de la persona, derivados de una sola vez a
 * partir de lo que el equipo permite (`choice`) y de lo que la clienta traía elegido.
 *
 * El nombre está denormalizado —como `serviceName`— para que el paso de la hora no
 * necesite el equipo entero. Eso trae la invariante de que el nombre corresponda a la
 * elección, y por eso los dos salen de acá: mientras cada call site los escribía por
 * su cuenta, la invariante dependía de que nadie se olvidara. Olvidarse dejaba
 * "Te atiende Ana" sobre una reserva que quedó a nombre de otra, sin que nada fallara.
 *
 * También es el cerrojo contra el estado viejo: si la clienta eligió a alguien y
 * después volvió atrás y cambió de servicio, `previa` puede apuntar a una persona que
 * ya no está entre las opciones. Devolverla igual escribiría una reserva a nombre de
 * quien no hace ese servicio; el server la rechazaría, pero recién en el pago.
 *
 * **`anyone` sobrevive mientras el paso siga existiendo**, y colapsa solo cuando deja
 * de haber algo que elegir: con una sola elegible, "cualquiera" ES esa persona y la
 * reserva queda a su nombre —así la confirmación la puede nombrar—; sin ninguna, se
 * cae junto con el paso.
 */
export function professionalFields(
  choice: ProfessionalChoice,
  previa: ProfessionalPick,
): { professional: ProfessionalPick; professionalName: string } {
  if (choice.kind === 'none') return { professional: NO_PROFESSIONAL, professionalName: '' }
  if (choice.kind === 'auto') {
    return {
      professional: { kind: 'person', id: choice.professional.id },
      professionalName: choice.professional.name,
    }
  }
  if (previa.kind === 'anyone') return { professional: previa, professionalName: ANYONE_LABEL }

  const persona = previa.kind === 'person' ? choice.options.find((p) => p.id === previa.id) : undefined
  return persona
    ? { professional: { kind: 'person', id: persona.id }, professionalName: persona.name }
    : { professional: NO_PROFESSIONAL, professionalName: '' }
}

