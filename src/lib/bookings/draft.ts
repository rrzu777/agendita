/**
 * Lo que hay que resolver server-side antes de crear una reserva, sea del funnel
 * público o del panel: el servicio, dónde se atiende y cuánta plata y cuánto
 * tiempo ocupa.
 *
 * Existe porque los dos `createBooking` hacían esta misma secuencia palabra por
 * palabra, y todo acá es **server-authoritative**: nada de esto puede venir del
 * cliente. El precio y la duración salen de la fila del servicio, no del payload;
 * la modalidad se re-deriva contra las que el servicio realmente ofrece.
 *
 * Sin `'use server'` a propósito: es una función server-side común, no un endpoint.
 */
import type { Service } from '@prisma/client'
import { ServiceModality } from '@prisma/client'
import { addMinutes } from 'date-fns'
import { prisma } from '@/lib/db'
import { UserError } from '@/lib/actions/result'
import { resolveBookingModality, resolveServiceAddress } from '@/lib/services/modality'
import { normalizeServiceSelection, resolveSelectedServices } from './selection'
import { snapshotServiceLines, type ServiceLineSnapshot } from './service-lines'

export interface BookingDraft {
  service: Service
  services: Service[]
  serviceIds: string[]
  lines: ServiceLineSnapshot[]
  durationMinutes: number
  modality: ServiceModality
  serviceAddress: string | null
  meetingUrl: string | null
  totalPrice: number
  depositRequired: number
  finalAmount: number
  endDateTime: Date
}

/**
 * Resuelve el servicio y todo lo que se deriva de él. Lanza `UserError` si el
 * servicio no es del negocio o está inactivo, y si la modalidad pedida no se
 * ofrece (vía `resolveBookingModality`).
 *
 * `finalAmount` arranca igual a `totalPrice`: el descuento se aplica después,
 * adentro de la transacción, y recién ahí se recalculan los montos
 * (`recomputeBookingAmountsAfterDiscount`).
 */
export async function resolveBookingDraft(args: {
  businessId: string
  serviceId?: string
  serviceIds?: string[]
  startDateTime: Date
  /** Elección del cliente. Se ignora cuando el servicio tiene una sola modalidad. */
  modality?: ServiceModality
  serviceAddress?: string
  /** `Business.defaultMeetingUrl`. Se copia a la reserva, no se lee en vivo. */
  defaultMeetingUrl: string | null
}): Promise<BookingDraft> {
  const serviceIds = normalizeServiceSelection(args)
  // Preserve the legacy single-row read; multi selections are validated in full.
  const rows = serviceIds.length === 1
    ? [await prisma.service.findFirst({ where: { id: serviceIds[0], businessId: args.businessId, isActive: true } })].filter((s): s is Service => s !== null)
    : await prisma.service.findMany({ where: { id: { in: serviceIds }, businessId: args.businessId, isActive: true } })
  const service = rows.find(s => s.id === serviceIds[0])
  if (!service) {
    throw new UserError('Servicio no disponible')
  }

  const selection = serviceIds.length > 1 ? resolveSelectedServices(args.businessId, serviceIds, rows) : {
    services: [service], modalities: service.modalities, totalPrice: service.price,
    depositRequired: service.depositAmount, durationMinutes: service.durationMinutes,
  }
  const modality = resolveBookingModality(selection.modalities, args.modality)
  const serviceAddress = resolveServiceAddress(modality, args.serviceAddress)
  // La sala se copia AHORA: si el negocio la cambia después, las citas ya
  // avisadas conservan el link que la clienta recibió por email.
  const meetingUrl = modality === ServiceModality.online ? args.defaultMeetingUrl : null

  return {
    service,
    services: selection.services,
    serviceIds,
    lines: snapshotServiceLines(selection.services),
    durationMinutes: selection.durationMinutes,
    modality,
    serviceAddress,
    meetingUrl,
    totalPrice: selection.totalPrice,
    depositRequired: selection.depositRequired,
    finalAmount: selection.totalPrice,
    endDateTime: addMinutes(args.startDateTime, selection.durationMinutes),
  }
}
