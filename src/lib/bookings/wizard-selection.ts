import type { Service } from '@prisma/client'
import type { BookingData } from '@/components/booking/wizard'
import { normalizeServiceSelection } from './selection'
import { MODALITY_ORDER } from '@/lib/services/modality'

export function wizardServiceIds(data: Pick<BookingData, 'serviceId' | 'serviceIds'>): string[] {
  return data.serviceIds ?? (data.serviceId ? [data.serviceId] : [])
}

/** Display only. The server independently resolves all amounts and eligibility. */
export function wizardServiceFields(ids: string[], catalogue: Service[]) {
  const selected = ids.length ? normalizeServiceSelection({ serviceIds: ids }).map(id => {
    const service = catalogue.find(s => s.id === id && s.isActive)
    if (!service) throw new Error('Uno de los servicios ya no está disponible')
    return service
  }) : []
  const serviceModalities = selected.length ? MODALITY_ORDER.filter(m => selected.every(s => s.modalities.includes(m))) : []
  if (selected.length && !serviceModalities.length) throw new Error('Estos servicios no comparten una modalidad de atención. Resérvalos por separado.')
  return {
    serviceId: selected[0]?.id ?? null,
    serviceIds: ids,
    services: selected.map(s => ({ id: s.id, name: s.name, price: s.price, durationMinutes: s.durationMinutes, depositAmount: s.depositAmount })),
    serviceName: selected.map(s => s.name).join(' + '),
    servicePrice: selected.reduce((sum, s) => sum + s.price, 0),
    serviceDuration: selected.reduce((sum, s) => sum + s.durationMinutes, 0),
    serviceDeposit: selected.reduce((sum, s) => sum + s.depositAmount, 0),
    serviceColor: selected[0]?.pastelColor ?? '',
    serviceModalities,
  }
}
