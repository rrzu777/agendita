import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuestPushLink, guestPushGrantSessionKey } from '@/components/push/guest-push-link'

describe('GuestPushLink', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('consumes only the matching booking grant and transfers it in a URL fragment', async () => {
    sessionStorage.setItem(guestPushGrantSessionKey('booking-1'), 'signed grant/+')
    sessionStorage.setItem(guestPushGrantSessionKey('booking-2'), 'other-grant')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<GuestPushLink bookingId="booking-1" canonicalOrigin="https://www.agendita.cl" />)
    })

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe(
      'https://www.agendita.cl/notificaciones#grant=signed%20grant%2F%2B',
    )
    expect(link?.getAttribute('href')).not.toContain('?grant=')
    expect(sessionStorage.getItem(guestPushGrantSessionKey('booking-1'))).toBeNull()
    expect(sessionStorage.getItem(guestPushGrantSessionKey('booking-2'))).toBe('other-grant')

    await act(async () => root.unmount())
  })

  it('renders a direct grant without putting it in a query string', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <GuestPushLink
          bookingId="booking-1"
          pushGrant="direct-grant"
          canonicalOrigin="https://www.agendita.cl/"
        />,
      )
    })

    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.agendita.cl/notificaciones#grant=direct-grant',
    )

    await act(async () => root.unmount())
  })

  it('renders nothing when neither the result nor sessionStorage has a grant', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<GuestPushLink bookingId="booking-1" canonicalOrigin="https://www.agendita.cl" />)
    })

    expect(container.textContent).toBe('')
    await act(async () => root.unmount())
  })

  it('drops the previous booking grant immediately when props change identity', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <GuestPushLink
          bookingId="booking-1"
          pushGrant="grant-for-booking-1"
          canonicalOrigin="https://www.agendita.cl"
        />,
      )
    })
    expect(container.querySelector('a')?.getAttribute('href')).toContain('grant-for-booking-1')

    await act(async () => {
      root.render(
        <GuestPushLink
          bookingId="booking-2"
          pushGrant={null}
          canonicalOrigin="https://www.agendita.cl"
        />,
      )
    })

    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('grant-for-booking-1')

    await act(async () => {
      root.render(
        <GuestPushLink
          bookingId="booking-2"
          pushGrant="grant-for-booking-2"
          canonicalOrigin="https://www.agendita.cl"
        />,
      )
    })
    expect(container.querySelector('a')?.getAttribute('href')).toContain('grant-for-booking-2')
    expect(container.innerHTML).not.toContain('grant-for-booking-1')

    await act(async () => root.unmount())
  })

  it('keeps a direct grant usable when sessionStorage is blocked', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError') },
      removeItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <GuestPushLink
          bookingId="booking-1"
          pushGrant="direct-under-security-error"
          canonicalOrigin="https://www.agendita.cl"
        />,
      )
    })

    expect(container.querySelector('a')?.getAttribute('href')).toContain('direct-under-security-error')
    await act(async () => root.unmount())
  })

  it('fails closed without leaking a stored grant when one-time removal is blocked', async () => {
    sessionStorage.setItem(guestPushGrantSessionKey('booking-1'), 'must-not-leak')
    vi.stubGlobal('sessionStorage', {
      getItem: () => 'must-not-leak',
      removeItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<GuestPushLink bookingId="booking-1" canonicalOrigin="https://www.agendita.cl" />)
    })

    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('must-not-leak')
    await act(async () => root.unmount())
  })
})
