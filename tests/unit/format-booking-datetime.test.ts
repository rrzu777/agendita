import { describe, it, expect } from 'vitest'
import { formatBookingDate, formatBookingTime, formatBookingDateTime } from '@/lib/booking/format-booking-datetime'

describe('format-booking-datetime', () => {
  // 2026-07-09T13:00Z = 09:00 en Santiago (UTC-4), 22:00 en Tokio
  const instant = new Date('2026-07-09T13:00:00Z')

  it('formats in the business timezone, not the device timezone', () => {
    expect(formatBookingTime(instant, 'America/Santiago')).toBe('09:00')
    expect(formatBookingTime(instant, 'Asia/Tokyo')).toBe('22:00')
  })

  it('formats dates crossing midnight in the business timezone', () => {
    // 2026-07-10T01:00Z = 9 de julio 21:00 en Santiago, 10 de julio 10:00 en Tokio
    const lateInstant = new Date('2026-07-10T01:00:00Z')
    expect(formatBookingDate(lateInstant, 'America/Santiago')).toBe('09-07-2026')
    expect(formatBookingDate(lateInstant, 'Asia/Tokyo')).toBe('10-07-2026')
  })

  it('combines date and time', () => {
    expect(formatBookingDateTime(instant, 'America/Santiago')).toBe('09-07-2026 09:00')
  })
})
