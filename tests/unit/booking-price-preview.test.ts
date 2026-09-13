import { describe, expect, it } from 'vitest'
import { bookingPricePreview } from '@/lib/bookings/price-preview'
describe('multi-service payment preview', () => {
  it('a prepaid cut does not make its paid add-on free', () => {
    expect(bookingPricePreview({ price: 19000, deposit: 6000, serviceCount: 2 }, { discountAmount: 15000, depositRequired: 1000 })).toEqual({ finalPrice: 4000, deposit: 1000 })
  })
  it('uses server-allocated coupon deposits and keeps legacy single-package behavior', () => {
    expect(bookingPricePreview({ price: 19000, deposit: 6000, serviceCount: 2 }, null, { finalAmount: 4000, depositRequired: 1000 })).toEqual({ finalPrice: 4000, deposit: 1000 })
    expect(bookingPricePreview({ price: 15000, deposit: 5000, serviceCount: 1 }, {})).toEqual({ finalPrice: 0, deposit: 0 })
  })
})
