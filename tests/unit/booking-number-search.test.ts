import { describe, expect, it } from 'vitest'
import { bookingSearchClearPath, parseBookingNumberSearch } from '@/lib/bookings/search'

describe('parseBookingNumberSearch', () => {
  it('accepts an optional hash and trims whitespace', () => {
    expect(parseBookingNumberSearch('  #3318  ')).toBe(3318)
    expect(parseBookingNumberSearch('3318')).toBe(3318)
  })

  it('rejects malformed, zero, and unsafe numbers', () => {
    expect(parseBookingNumberSearch('')).toBeNull()
    expect(parseBookingNumberSearch('#0')).toBeNull()
    expect(parseBookingNumberSearch('#3318x')).toBeNull()
    expect(parseBookingNumberSearch('#9007199254740992')).toBeNull()
  })

  it('keeps the transfers cursor when clearing a booking search', () => {
    expect(bookingSearchClearPath('transfer-50')).toBe('/dashboard/bookings?transferCursor=transfer-50')
    expect(bookingSearchClearPath(undefined)).toBe('/dashboard/bookings')
  })
})
