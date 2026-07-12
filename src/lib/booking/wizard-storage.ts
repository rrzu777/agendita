import type { Service } from '@prisma/client'
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
  customerNotes: string
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
    customerNotes: data.customerNotes,
    idempotencyKey: data.idempotencyKey,
    ...(data.promotionCode ? { promotionCode: data.promotionCode } : {}),
  }
  return JSON.stringify(saved)
}

/** Devuelve el BookingData completo a restaurar, o null si el estado no sirve
 *  (expirado, corrupto, o el servicio ya no existe/está inactivo — en ese caso
 *  se descarta TODO: nada de restauraciones parciales). Los campos denormalizados
 *  del servicio se re-derivan de la lista actual, no del snapshot. */
export function restoreWizardState(raw: string | null, services: Service[], now: number = Date.now()): BookingData | null {
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

  return {
    serviceId: service.id,
    serviceName: service.name,
    servicePrice: service.price,
    serviceDuration: service.durationMinutes,
    serviceDeposit: service.depositAmount,
    serviceColor: service.pastelColor || '',
    date: saved.date ? new Date(saved.date) : null,
    timeSlot: saved.timeSlotStart && saved.timeSlotEnd
      ? { start: new Date(saved.timeSlotStart), end: new Date(saved.timeSlotEnd) }
      : null,
    customerName: saved.customerName ?? '',
    customerPhone: saved.customerPhone ?? '',
    customerEmail: saved.customerEmail ?? '',
    customerNotes: saved.customerNotes ?? '',
    idempotencyKey: saved.idempotencyKey ?? null,
    ...(saved.promotionCode ? { promotionCode: saved.promotionCode } : {}),
  }
}
