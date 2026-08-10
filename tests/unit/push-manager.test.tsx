import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickButton, flushPromises } from '../helpers/react-dom'
import {
  base64UrlBytes,
  OTHER_VAPID_PUBLIC_KEY,
  TEST_PUSH_AUTH,
  TEST_VAPID_PUBLIC_KEY,
} from '../helpers/push-fixtures'

const navigationMocks = vi.hoisted(() => ({ replaceBrowserLocation: vi.fn() }))

vi.mock('@/lib/push/canonical-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/canonical-client')>()),
  replaceBrowserLocation: navigationMocks.replaceBrowserLocation,
}))

const subscriptionJson = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
  keys: { p256dh: TEST_VAPID_PUBLIC_KEY, auth: TEST_PUSH_AUTH },
}

function managerProps() {
  return { vapidPublicKey: TEST_VAPID_PUBLIC_KEY, canonicalOrigin: window.location.origin }
}

describe('PushManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/notificaciones#grant=signed%20grant')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('clears the guest grant fragment without requesting permission on mount', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))

    expect(window.location.hash).toBe('')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/notificaciones')
    expect(requestPermission).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('signed grant')
    await act(async () => root.unmount())
  })

  it('clears a tenant fragment then redirects it to canonical without exposing permission or API actions', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const requestPermission = vi.fn()
    const register = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(
      <PushManager vapidPublicKey={TEST_VAPID_PUBLIC_KEY} canonicalOrigin="https://www.agendita.cl" />,
    ))

    expect(window.location.hash).toBe('')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/notificaciones')
    expect(navigationMocks.replaceBrowserLocation).toHaveBeenCalledWith(
      'https://www.agendita.cl/notificaciones#grant=signed%20grant',
    )
    expect(replaceState.mock.invocationCallOrder[0])
      .toBeLessThan(navigationMocks.replaceBrowserLocation.mock.invocationCallOrder[0])
    expect(container.querySelector('button')).toBeNull()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('waits for the explicit button click before registering and subscribing', async () => {
    const browserSubscription = {
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const subscribe = vi.fn().mockResolvedValue(browserSubscription)
    const register = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe },
    })
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscribed: 1 }),
    }))
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(
      <StrictMode><PushManager {...managerProps()} /></StrictMode>,
    ))
    expect(register).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()

    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY),
    })
    expect(fetch).toHaveBeenCalledWith('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscriptionJson, grant: 'signed grant' }),
    })
    expect(container.textContent).toContain('Recordatorios activos')
    await act(async () => root.unmount())
  })

  it('keeps a default permission result retryable without registering a worker', async () => {
    const register = vi.fn()
    const requestPermission = vi.fn().mockResolvedValue('default')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(container.textContent).not.toContain('permiso fue rechazado')
    expect(container.textContent).toContain('Activar recordatorios')
    expect(register).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('shows denial without registering a worker', async () => {
    const register = vi.fn()
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(container.textContent).toContain('permiso fue rechazado')
    expect(register).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('retries the failed unsubscribe action instead of silently resubscribing', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const register = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(browserSubscription),
        subscribe: vi.fn(),
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscribed: 1 }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'temporary' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unsubscribed: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()
    await clickButton(container, 'Desactivar recordatorios')
    await flushPromises()
    expect(container.textContent).toContain('intentá de nuevo')

    await clickButton(container, 'Reintentar')
    await flushPromises()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/push/subscribe',
      '/api/push/unsubscribe',
      '/api/push/unsubscribe',
    ])
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Activar recordatorios')
    await act(async () => root.unmount())
  })

  it.each([
    { label: 'mismatched', options: { applicationServerKey: base64UrlBytes(OTHER_VAPID_PUBLIC_KEY).buffer } },
    { label: 'missing', options: undefined },
  ])('replaces an existing subscription with $label VAPID options', async ({ options }) => {
    window.history.replaceState(null, '', '/notificaciones')
    const existing = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription',
      options,
      toJSON: () => ({ ...subscriptionJson, endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription' }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const replacement = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(),
    }
    const subscribe = vi.fn().mockResolvedValue(replacement)
    const register = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(existing), subscribe },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscribed: 1 }),
    }))
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY),
    })
    expect(fetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
      body: JSON.stringify({ subscription: subscriptionJson }),
    }))
    expect(container.textContent).toContain('Recordatorios activos')
    await act(async () => root.unmount())
  })

  it('shows iOS home-screen installation help when PushManager is unavailable', async () => {
    vi.stubGlobal('PushManager', undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps()} />))

    expect(container.textContent).toContain('pantalla de inicio')
    expect(container.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })

  it('stays unavailable when VAPID is intentionally disabled', async () => {
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(
      <PushManager vapidPublicKey={null} canonicalOrigin={window.location.origin} />,
    ))

    expect(container.textContent).toContain('no están disponibles')
    expect(container.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })
})
