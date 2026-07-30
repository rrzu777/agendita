import { ServiceModality } from '@prisma/client'
import { UserError } from '@/lib/actions/result'

/**
 * Modalidad de atención: dónde se presta el servicio.
 *
 * Es un atributo **del servicio**, no del rubro. Nada de `if (category === ...)`:
 * una masajista puede ofrecer "en el local" y "a domicilio" para el mismo
 * servicio, y quien hace constelaciones atiende online sin necesitar un rubro
 * propio en `BusinessCategory`.
 *
 * **No toca la agenda.** El tiempo de traslado entre domicilios es un problema
 * real de disponibilidad y merece su propia iniciativa; acá la modalidad es
 * información de la cita, no una restricción de slots.
 */

export const MODALITY_LABELS: Record<ServiceModality, string> = {
  on_site: 'En el local',
  at_home: 'A domicilio',
  online: 'Online',
}

/** Orden estable para pickers y checkboxes (el del enum, no el de un Object.keys). */
export const MODALITY_ORDER: ServiceModality[] = [
  ServiceModality.on_site,
  ServiceModality.at_home,
  ServiceModality.online,
]

/** Ayuda corta por modalidad, para el formulario de servicios. */
export const MODALITY_HINTS: Record<ServiceModality, string> = {
  on_site: 'La clienta va a tu dirección.',
  at_home: 'Vos vas a la dirección de la clienta, que la escribe al reservar.',
  online: 'Por videollamada. El link sale de tu sala fija, en Ajustes.',
}

export function modalityLabel(modality: string): string {
  return (MODALITY_LABELS as Partial<Record<string, string>>)[modality] ?? modality
}

/** Ordena una lista de modalidades según MODALITY_ORDER (entrada sin ordenar). */
export function sortModalities(modalities: ServiceModality[]): ServiceModality[] {
  return MODALITY_ORDER.filter((m) => modalities.includes(m))
}

/**
 * Tilda o destilda una modalidad **sin dejar la lista en cero**: sin ninguna, ni un
 * servicio ni una persona pueden atender nada.
 *
 * Vive acá y no adentro de un formulario porque ese piso de "al menos una" es el
 * único guard del lado del cliente del `.min(1)` de los schemas de Zod, y estaba
 * escrito dos veces (servicios y equipo). Duplicado, arreglar una copia dejaba la
 * otra mostrando el error recién al guardar y sólo en una pantalla.
 */
export function toggleModalityIn(
  list: ServiceModality[],
  modality: ServiceModality,
): ServiceModality[] {
  if (list.includes(modality)) {
    return list.length === 1 ? list : list.filter((m) => m !== modality)
  }
  return sortModalities([...list, modality])
}

/**
 * Modalidad efectiva de una reserva nueva, server-authoritative.
 *
 * - Un servicio con una sola modalidad la impone y **el pedido del cliente se
 *   ignora**: no hay nada que elegir, y así un payload viejo o manipulado no
 *   puede pedir domicilio sobre un servicio que sólo se hace en el local.
 * - Con varias, la pedida tiene que estar entre las ofrecidas.
 * - Sin modalidad pedida y con varias ofrecidas, gana la primera del orden
 *   canónico (el funnel siempre manda una; esto cubre callers viejos).
 */
export function resolveBookingModality(
  available: ServiceModality[],
  requested: ServiceModality | null | undefined,
): ServiceModality {
  const offered = sortModalities(available)
  // Un servicio sin modalidades es un dato corrupto; tratarlo como "en el local"
  // es más útil que tirar en medio de una reserva.
  if (offered.length === 0) return ServiceModality.on_site
  if (offered.length === 1) return offered[0]
  if (!requested) return offered[0]
  if (!offered.includes(requested)) {
    throw new UserError('Ese servicio no se ofrece en esa modalidad')
  }
  return requested
}

/**
 * Qué mostrar de "dónde" en una reserva ya creada (dashboard, /mi).
 *
 * `detail` es null en el local: la dirección del negocio ya está en su propia
 * página y repetirla en cada fila es ruido. El equivalente para emails vive en
 * `templates.ts` (`whereRows`) y sí incluye la del negocio, porque ahí la clienta
 * no tiene dónde más buscarla.
 */
export function bookingWhere(booking: {
  modality: ServiceModality
  serviceAddress?: string | null
  meetingUrl?: string | null
}): { label: string; detail: string | null; isLink: boolean } {
  if (booking.modality === ServiceModality.at_home) {
    return { label: MODALITY_LABELS.at_home, detail: booking.serviceAddress ?? null, isLink: false }
  }
  if (booking.modality === ServiceModality.online) {
    return { label: MODALITY_LABELS.online, detail: booking.meetingUrl ?? null, isLink: true }
  }
  return { label: MODALITY_LABELS.on_site, detail: null, isLink: false }
}

/** True cuando vale la pena mostrar la modalidad: en el local es el default y no
 *  aporta nada en una lista. */
export function isNotableModality(modality: ServiceModality): boolean {
  return modality !== ServiceModality.on_site
}

/** A domicilio: sin dirección la reserva no sirve, así que es obligatoria. */
export function requiresServiceAddress(modality: ServiceModality): boolean {
  return modality === ServiceModality.at_home
}

/** Normaliza y valida la dirección según la modalidad. Devuelve lo que se guarda. */
export function resolveServiceAddress(
  modality: ServiceModality,
  raw: string | null | undefined,
): string | null {
  const address = raw?.trim() || null
  if (requiresServiceAddress(modality)) {
    if (!address) throw new UserError('Necesitamos la dirección para ir a domicilio')
    return address
  }
  // Fuera de domicilio la dirección se descarta: guardarla dejaría un dato que
  // nadie muestra y que contradice la modalidad.
  return null
}
