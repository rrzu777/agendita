import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockExpireStaleHolds, mockRevalidateBusinessPublicPaths } = vi.hoisted(() => ({
  mockExpireStaleHolds: vi.fn(),
  mockRevalidateBusinessPublicPaths: vi.fn(),
}))

vi.mock('@/lib/cron/expire-holds', () => ({ expireStaleHolds: mockExpireStaleHolds }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths,
}))

const { POST } = await import('@/app/api/cron/expire-holds/route')

describe('/api/cron/expire-holds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-test-secret'
    mockExpireStaleHolds.mockResolvedValue({
      expired: 2,
      businessIds: ['business-1'],
      declaredTransferExpired: 1,
      packagesExpired: 3,
      requestsExpired: 4,
    })
  })

  it('returns a numeric zero errors field for the strict cron runner', async () => {
    const response = await POST(
      new NextRequest('https://www.agendita.cl/api/cron/expire-holds', {
        method: 'POST',
        headers: { authorization: 'Bearer cron-test-secret' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ expired: 2, errors: 0 })
  })
})
