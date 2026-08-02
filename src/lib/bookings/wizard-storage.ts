import type { Service, ServiceModality } from '@prisma/client'
import { sortModalities, requiresServiceAddress } from '@/lib/services/modality'
import { NO_PROFESSIONAL, professionalChoice, professionalFields, samePick, type FunnelProfessional, type ProfessionalPick } from '@/lib/professionals/eligible'
import type { BookingData } from '@/components/booking/wizard'

/** Persistencia del wizard para el viaje a /ingresar y de vuelta (spec CTA funnel).
 *  Helpers puros (testeables): el wizard hace el sessionStorage.get/set. */

const TTL_MS = 30 * 60_000

export function wizardStorageKey(businessId: string): string {
  return `agendita:wizard:${businessId}`
}

interface SavedState {
  savedAt: number
  serviceId: string
  date: string | null
  timeSlotStart: string | null
  timeSlotEnd: string | null
  customerName: string
  customerPhone: string
  customerEmail: string
  customerBirthDate?: string
  customerNotes: string
  serviceModality: ServiceModality | null
  serviceAddress: string
  /** Sólo la elección: el nombre se re-deriva del equipo actual, como los del servicio. */
  professional: ProfessionalPick
  idempotencyKey: string | null
  promotionCode?: string
}

export function serializeWizardState(data: BookingData, now: number = Date.now()): string | null {
  if (!data.serviceId) return null
  const saved: SavedState = {
    savedAt: now,
    serviceId: data.serviceId,
    date: data.date ? data.date.toISOString() : null,
    timeSlotStart: data.timeSlot ? data.timeSlot.start.toISOString() : null,
    timeSlotEnd: data.timeSlot ? data.timeSlot.end.toISOString() : null,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    customerBirthDate: data.customerBirthDate ?? '',
    customerNotes: data.customerNotes,
    serviceModality: data.serviceModality,
    serviceAddress: data.serviceAddress,
    professional: data.professional,
    idempotencyKey: data.idempotencyKey,
    ...(data.promotionCode ? { promotionCode: data.promotionCode } : {}),
  }
  return JSON.stringify(saved)
}

/** Devuelve el BookingData completo a restaurar, o null si el estado no sirve
 *  (expirado, corrupto, o el servicio ya no existe/está inactivo — en ese caso
 *  se descarta TODO: nada de restauraciones parciales). Los campos denormalizados
 *  del servicio se re-derivan de la lista actual, no del snapshot. */
export function restoreWizardState(
  raw: string | null,
  services: Service[],
  professionals: FunnelProfessional[],
  now: number = Date.now(),
): BookingData | null {
  if (!raw) return null
  let saved: SavedState
  try {
    saved = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof saved?.savedAt !== 'number' || now - saved.savedAt > TTL_MS) return null

  const service = services.find((s) => s.id === saved.serviceId)
  if (!service || !service.isActive) return null

  const modalities = sortModalities(service.modalities)
  // La modalidad guardada se re-valida contra el servicio ACTUAL, igual que el
  // resto de los campos denormalizados: si la dueña dejó de ofrecer domicilio
  // mientras la clienta iba a /ingresar, la elección vieja no sobrevive.
  const modality =
    saved.serviceModality && modalities.includes(saved.serviceModality)
      ? saved.serviceModality
      : modalities.length === 1
        ? modalities[0]
        : null

  // La elección se re-valida contra el equipo ACTUAL y contra la modalidad que
  // sobrevivió arriba: alguien que se dio de baja, que dejó de hacer ese servicio o
  // que no viaja a domicilio ya no es una opción. Y con una sola elegible se
  // re-asigna sola, que es lo mismo que hace el funnel al elegir servicio.
  //
  // El `?? NO_PROFESSIONAL` cubre el estado guardado por una versión anterior del
  // wizard, que escribía un `professionalId` suelto: el TTL es de 30 minutos, así que
  // sólo pasa durante un deploy, y volver a preguntar es más barato que adivinar.
  const guardada = saved.professional ?? NO_PROFESSIONAL
  const persona = professionalFields(
    professionalChoice(professionals, service.id, modality),
    guardada,
  )

  // Si la reserva ya no va a nombre de lo que la clienta eligió, el horario guardado
  // tampoco sirve: se calculó contra ESA agenda. Se suelta acá y no en el wizard
  // porque es la misma regla que aplica el paso cuando cambia de persona a mano.
  //
  // Se compara contra lo GUARDADO y no contra "quedó vacío" a propósito: cuando queda
  // una sola elegible, `professionalFields` re-asigna sin preguntar —es lo mismo
  // que ve una clienta que entra de cero— y ahí tampoco vale la hora vieja. Un
  // "cualquiera" que sigue siendo "cualquiera" sí la conserva: la unión de horarios
  // no cambió por volver de /ingresar.
  const perdioLaPersona = guardada.kind !== 'none' && !samePick(persona.professional, guardada)

  return {
    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDuration: service.durationMinutes,
    serviceDeposit: service.depositAmount,
    serviceColor: service.pastelColor || '',
    serviceModalities: modalities,
    serviceModality: modality,
    // Se cuelga de la modalidad RESUELTA, no de la guardada: si el domicilio se
    // descartó arriba, la dirección tiene que irse con él o el formulario queda
    // con un dato que ya no corresponde a lo que se va a reservar.
    serviceAddress: modality && requiresServiceAddress(modality) ? (saved.serviceAddress ?? '') : '',
    ...persona,
    date: saved.date ? new Date(saved.date) : null,
    timeSlot: !perdioLaPersona && saved.timeSlotStart && saved.timeSlotEnd
      ? { start: new Date(saved.timeSlotStart), end: new Date(saved.timeSlotEnd) }
      : null,
    customerName: saved.customerName ?? '',
    customerPhone: saved.customerPhone ?? '',
    customerEmail: saved.customerEmail ?? '',
    customerBirthDate: saved.customerBirthDate ?? '',
    customerNotes: saved.customerNotes ?? '',
    idempotencyKey: saved.idempotencyKey ?? null,
    ...(saved.promotionCode ? { promotionCode: saved.promotionCode } : {}),
  }
}
