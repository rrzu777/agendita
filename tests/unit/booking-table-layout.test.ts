import { describe, expect, it } from 'vitest'
import { BOOKING_STATUS_COLUMN, BOOKING_TABLE_MIN_WIDTH } from '@/app/dashboard/bookings/page'
import { TABLE_COL } from '@/components/ui/table-widths'

describe('booking desktop table layout', () => {
  it('reserves more room for a declared-transfer status than the generic badge column', () => {
    expect(BOOKING_STATUS_COLUMN).not.toBe(TABLE_COL.status)
    expect(BOOKING_STATUS_COLUMN).toBe('w-[232px]')
  })

  it('scrolls before squeezing the service column after widening status', () => {
    expect(BOOKING_TABLE_MIN_WIDTH).toBe('min-w-[980px]')
  })
})
