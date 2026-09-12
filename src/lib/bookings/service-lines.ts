import type { SelectableBookingService } from './selection'

export interface ServiceLineSnapshot {
  serviceId: string
  position: number
  name: string
  durationMinutes: number
  price: number
  depositAmount: number
  discountAmount: number
  finalAmount: number
}

/** Internal pipeline: resolveSelectedServices -> snapshotServiceLines -> allocateLineDiscount.
 * Never pass client amounts or unvalidated catalogue rows to these arithmetic helpers. */
export function snapshotServiceLines(services: Pick<SelectableBookingService, 'id' | 'name' | 'durationMinutes' | 'price' | 'depositAmount'>[]): ServiceLineSnapshot[] {
  return services.map((service, position) => ({
    serviceId: service.id, position, name: service.name, durationMinutes: service.durationMinutes,
    price: service.price, depositAmount: service.depositAmount, discountAmount: 0, finalAmount: service.price,
  }))
}

/** Largest remainder, using BigInt so large valid CLP totals do not lose cents. */
export function allocateLineDiscount(lines: ServiceLineSnapshot[], amount: number, eligibleServiceIds: string[]): ServiceLineSnapshot[] {
  const eligible = new Set(eligibleServiceIds)
  const base = lines.reduce((sum, line) => sum + (eligible.has(line.serviceId) ? line.price : 0), 0)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > base || lines.some(l => l.discountAmount !== 0)) {
    throw new Error('Invalid service line discount allocation')
  }
  const allocations = lines.map((line, index) => {
    const weighted = eligible.has(line.serviceId) ? BigInt(line.price) * BigInt(amount) : BigInt(0)
    return { index, amount: base ? Number(weighted / BigInt(base)) : 0, remainder: base ? weighted % BigInt(base) : BigInt(0) }
  })
  let remaining = amount - allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
  for (const allocation of [...allocations].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!remaining) break
    if (!eligible.has(lines[allocation.index].serviceId) || !lines[allocation.index].price) continue
    allocation.amount++
    remaining--
  }
  return lines.map((line, index) => ({
    ...line, discountAmount: allocations[index].amount, finalAmount: line.price - allocations[index].amount,
    depositAmount: Math.min(line.depositAmount, line.price - allocations[index].amount),
  }))
}

/** No historical name/price is invented for legacy bookings without line snapshots. */
export function bookingServiceName(booking: {
  service?: { name: string } | null
  serviceLines?: { position: number; name: string }[]
}): string {
  return booking.serviceLines?.length
    ? [...booking.serviceLines].sort((a, b) => a.position - b.position).map(l => l.name).join(' + ')
    : booking.service?.name ?? 'Servicio'
}

/** Catalogue edits must not change the occupied duration of an existing booking. */
export function bookingDurationMinutes(booking: { startDateTime: Date; endDateTime: Date }): number {
  const minutes = (booking.endDateTime.getTime() - booking.startDateTime.getTime()) / 60000
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new Error('Invalid persisted booking duration')
  return minutes
}
