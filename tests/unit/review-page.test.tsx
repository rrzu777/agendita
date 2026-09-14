import { describe, expect, it, vi } from 'vitest'

const getReviewRequest = vi.fn()
vi.mock('@/server/actions/reviews', () => ({ getReviewRequest }))
vi.mock('@/components/client/client-shell', () => ({
  TenantPublicShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/platform/platform-shell', () => ({
  MarketingShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/app/review/[bookingId]/review-form', () => ({ ReviewForm: () => null }))

const { default: ReviewPage } = await import('@/app/review/[bookingId]/page')

describe('review page recovery contract', () => {
  it('lets unexpected server failures reach the route error boundary', async () => {
    getReviewRequest.mockRejectedValueOnce(new Error('database secret'))

    await expect(ReviewPage({
      params: Promise.resolve({ bookingId: 'booking-1' }),
      searchParams: Promise.resolve({ token: 'token-1' }),
    })).rejects.toThrow('database secret')
  })
})
