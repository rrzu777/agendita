import { describe, expect, it } from 'vitest'
import { aggregateCompletedBookingEconomics } from '@/lib/analytics/booking-economics'

describe('multi-service booking economics', () => {
  it('counts a booking once globally and each persisted line once by service', () => {
    const result = aggregateCompletedBookingEconomics([{
      id: 'booking-a', status: 'completed', finalAmount: 19000, serviceId: 'service-a',
      serviceLines: [
        { serviceId: 'service-a', finalAmount: 15000 },
        { serviceId: 'service-b', finalAmount: 4000 },
      ],
    }])
    expect(result).toEqual({ bookings: 1, amount: 19000, services: [
      { serviceId: 'service-a', bookings: 1, amount: 15000 },
      { serviceId: 'service-b', bookings: 1, amount: 4000 },
    ] })
  })

  it('deduplicates replayed booking rows and supports historical rows without lines', () => {
    const legacy = { id: 'legacy', status: 'completed', finalAmount: 5000, serviceId: 'service-a', serviceLines: [] }
    expect(aggregateCompletedBookingEconomics([legacy, legacy])).toEqual({ bookings: 1, amount: 5000, services: [{ serviceId: 'service-a', bookings: 1, amount: 5000 }] })
  })
})
