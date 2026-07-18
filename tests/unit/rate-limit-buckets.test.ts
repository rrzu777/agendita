import { describe, expect, it } from 'vitest'
import { RATE_LIMITS } from '@/lib/rate-limit'

describe('RATE_LIMITS', () => {
  it('registra el bucket de bulk email con presupuesto holgado', () => {
    const bucket = RATE_LIMITS['send-campaign-bulk-email']
    expect(bucket).toBeDefined()
    expect(bucket.maxRequests).toBeGreaterThanOrEqual(60)
    expect(bucket.windowMs).toBe(60_000)
  })
})
