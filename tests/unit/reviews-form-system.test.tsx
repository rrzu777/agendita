import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/reviews', () => ({
  approveReview: vi.fn(),
  hideReview: vi.fn(),
  submitReview: vi.fn(),
}))

import { submitReview } from '@/server/actions/reviews'

describe('reviews form system', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses a labeled form-density search and accessible filter segments', async () => {
    const { ReviewsClient } = await import('@/app/dashboard/reviews/reviews-client')
    await act(async () => root.render(
      <ReviewsClient reviews={[]} eligibleBookings={[]} pendingCount={0} />,
    ))

    const search = container.querySelector<HTMLInputElement>('#reviews-search')
    expect(search?.labels?.[0]?.textContent).toContain('Buscar reseñas')
    expect(search?.getAttribute('data-density')).toBe('form')

    const activeStatus = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === 'Todas' && item.getAttribute('aria-pressed') === 'true',
    )
    expect(activeStatus?.className).toContain('min-h-11')
    expect(Array.from(container.querySelectorAll('fieldset legend')).map((item) => item.textContent)).toEqual([
      'Estado de la reseña',
      'Calificación de la reseña',
    ])
  })

  it('uses touch geometry and connected help in the public review form', async () => {
    const { ReviewForm } = await import('@/app/review/[bookingId]/review-form')
    await act(async () => root.render(<ReviewForm bookingId="booking-1" token="token-1" />))

    const comment = container.querySelector<HTMLTextAreaElement>('#comment')
    expect(comment?.getAttribute('data-density')).toBe('touch')
    expect(comment?.getAttribute('aria-describedby')).toBe('comment-help')
    expect(container.querySelector('#comment-help')?.textContent).toContain('0/1000')

    const firstStar = container.querySelector<HTMLButtonElement>('button[aria-label="1 estrella"]')
    expect(firstStar?.getAttribute('aria-pressed')).toBe('false')
    expect(firstStar?.className).toContain('size-12')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.getAttribute('data-size')).toBe('touch')
  })

  it('recovers the public review form after a transport failure', async () => {
    vi.mocked(submitReview).mockRejectedValueOnce(new Error('network'))
    const { ReviewForm } = await import('@/app/review/[bookingId]/review-form')
    await act(async () => root.render(<ReviewForm bookingId="booking-1" token="token-1" />))
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="5 estrellas"]')!.click())
    await act(async () => {
      container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Intenta nuevamente')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
  })

  it('announces success and moves focus to the confirmation', async () => {
    vi.mocked(submitReview).mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'review-1',
        createdAt: new Date('2026-09-13T12:00:00Z'),
        isApproved: false,
        isHidden: false,
        businessId: 'business-1',
        bookingId: 'booking-1',
        customerId: 'customer-1',
        rating: 5,
        comment: null,
      },
    })
    const { ReviewForm } = await import('@/app/review/[bookingId]/review-form')
    await act(async () => root.render(<ReviewForm bookingId="booking-1" token="token-1" />))
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="5 estrellas"]')!.click())
    await act(async () => {
      container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    const status = container.querySelector('[role="status"]')
    const title = status?.querySelector('h2')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(title?.textContent).toContain('Gracias por tu reseña')
    expect(document.activeElement).toBe(title)
  })
})
