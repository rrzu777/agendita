import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: Record<string, unknown>) => void

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadWorker() {
  vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.cl')
  const { GET } = await import('@/app/sw.js/route')
  const response = await GET()
  const listeners = new Map<string, Listener>()
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const self = {
    registration: { showNotification },
    clients: { openWindow },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  }
  const source = await response.text()
  Function('self', 'URL', source)(self, URL)
  return { response, source, listeners, showNotification, openWindow }
}

describe('/sw.js', () => {
  it('serves a non-cached root-scoped worker with only push and click listeners', async () => {
    const { response, listeners } = await loadWorker()

    expect(response.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate')
    expect(response.headers.get('service-worker-allowed')).toBe('/')
    expect([...listeners.keys()].sort()).toEqual(['notificationclick', 'push'])
  })

  it('shows only the server-created title, body and destination payload', async () => {
    const { listeners, showNotification } = await loadWorker()
    const waitUntil = vi.fn()

    listeners.get('push')?.({
      data: {
        json: () => ({
          title: 'Peluquería Demo',
          body: 'Cancelá con anticipación',
          url: 'https://tenant.agendita.cl/book/confirmation?bookingId=booking-1',
          customerName: 'must not render',
          amount: 5000,
        }),
      },
      waitUntil,
    })

    expect(showNotification).toHaveBeenCalledWith('Peluquería Demo', {
      body: 'Cancelá con anticipación',
      data: { url: 'https://tenant.agendita.cl/book/confirmation?bookingId=booking-1' },
    })
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it.each([
    'http://www.agendita.cl/mi/demo',
    'https://agendita.cl.evil.test/mi/demo',
    'https://evil.test/mi/demo',
    'https://user:password@tenant.agendita.cl/mi/demo',
    'https://tenant.agendita.cl:444/mi/demo',
    'not-a-url',
  ])('refuses a non-HTTPS or out-of-apex click destination: %s', async (url) => {
    const { listeners, openWindow } = await loadWorker()
    const waitUntil = vi.fn()
    const close = vi.fn()

    listeners.get('notificationclick')?.({ notification: { data: { url }, close }, waitUntil })
    await Promise.resolve()

    expect(close).toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })

  it.each([
    'https://agendita.cl/mi/demo',
    'https://www.agendita.cl/mi/demo',
    'https://tenant.agendita.cl/book/confirmation?bookingId=booking-1',
  ])('opens an HTTPS apex or subdomain destination: %s', async (url) => {
    const { listeners, openWindow } = await loadWorker()
    const pending: Promise<unknown>[] = []

    listeners.get('notificationclick')?.({
      notification: { data: { url }, close: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    })
    await Promise.all(pending)

    expect(openWindow).toHaveBeenCalledWith(url)
  })
})
