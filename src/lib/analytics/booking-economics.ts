export interface BookingEconomicsInput {
  id: string
  status: string
  finalAmount: number
  serviceId: string
  serviceLines: { serviceId: string; finalAmount: number }[]
}

/** Completed value is descriptive booked value, not proof of cash collection. */
export function aggregateCompletedBookingEconomics(rows: BookingEconomicsInput[]) {
  const bookings = [...new Map(rows.filter(row => row.status === 'completed').map(row => [row.id, row])).values()]
  const services = new Map<string, { serviceId: string; bookings: number; amount: number }>()
  for (const booking of bookings) {
    const lines = booking.serviceLines.length ? booking.serviceLines : [{ serviceId: booking.serviceId, finalAmount: booking.finalAmount }]
    for (const line of lines) {
      const current = services.get(line.serviceId) ?? { serviceId: line.serviceId, bookings: 0, amount: 0 }
      current.bookings++
      current.amount += line.finalAmount
      services.set(line.serviceId, current)
    }
  }
  return {
    bookings: bookings.length,
    amount: bookings.reduce((sum, booking) => sum + booking.finalAmount, 0),
    services: [...services.values()].sort((a, b) => a.serviceId.localeCompare(b.serviceId)),
  }
}
