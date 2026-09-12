import type { ServiceModality } from '@prisma/client'
import { UserError } from '@/lib/actions/result'
import { MODALITY_ORDER } from '@/lib/services/modality'

export const MAX_BOOKING_SERVICES = 10

/** The legacy pointer must be the first line, not an alternative selection. */
export function normalizeServiceSelection(input: { serviceId?: unknown; serviceIds?: unknown }): string[] {
  const ids = input.serviceIds === undefined ? [input.serviceId] : input.serviceIds
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BOOKING_SERVICES ||
    ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
    new Set(ids).size !== ids.length ||
    (input.serviceId !== undefined && input.serviceId !== ids[0])) {
    throw new UserError('Elige entre 1 y 10 servicios distintos para esta reserva')
  }
  return [...ids] as string[]
}

export interface SelectableBookingService {
  id: string
  businessId: string
  isActive: boolean
  name: string
  price: number
  depositAmount: number
  durationMinutes: number
  modalities: ServiceModality[]
}

/** Rows come from the server catalogue. Order comes from the bounded selection. */
export function resolveSelectedServices<T extends SelectableBookingService>(businessId: string, serviceIds: string[], rows: T[]) {
  const ids = normalizeServiceSelection({ serviceIds })
  const services = ids.map(id => {
    const service = rows.find(row => row.id === id && row.businessId === businessId && row.isActive)
    if (!service) throw new UserError('Uno de los servicios ya no está disponible')
    if (!Number.isSafeInteger(service.price) || service.price < 0 ||
      !Number.isSafeInteger(service.depositAmount) || service.depositAmount < 0 || service.depositAmount > service.price ||
      !Number.isSafeInteger(service.durationMinutes) || service.durationMinutes <= 0) {
      throw new UserError('Uno de los servicios tiene una configuración inválida')
    }
    return service
  })
  const modalities = MODALITY_ORDER.filter(m => services.every(s => s.modalities.includes(m)))
  if (!modalities.length) throw new UserError('Estos servicios no comparten una modalidad de atención')
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0)
  const depositRequired = services.reduce((sum, s) => sum + s.depositAmount, 0)
  const durationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0)
  if ([totalPrice, depositRequired, durationMinutes].some(n => !Number.isSafeInteger(n) || n > 2147483647)) {
    throw new UserError('La selección excede los límites de una reserva')
  }
  return { services, modalities, totalPrice, depositRequired, durationMinutes }
}
