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

function managerProps(isAuthenticated = false) {
  return { vapidPublicKey: TEST_VAPID_PUBLIC_KEY, canonicalOrigin: window.location.origin, isAuthenticated }
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

    await act(async () => root.render(<PushManager {...managerProps(true)} />))

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
      <StrictMode>
        <PushManager vapidPublicKey={TEST_VAPID_PUBLIC_KEY} canonicalOrigin="https://www.agendita.cl" isAuthenticated={false} />
      </StrictMode>,
    ))

    expect(window.location.hash).toBe('')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/notificaciones')
    expect(navigationMocks.replaceBrowserLocation).toHaveBeenCalledWith(
      'https://www.agendita.cl/notificaciones#grant=signed%20grant',
    )
    expect(navigationMocks.replaceBrowserLocation).toHaveBeenCalledTimes(1)
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

  it.each([
    {
      label: 'guest grant rejection',
      response: { ok: false, json: async () => ({ error: 'unauthorized' }) },
      isAuthenticated: false,
      hasGrant: true,
      finalCopy: 'iniciá sesión',
    },
    {
      label: 'zero eligible account targets',
      response: { ok: true, json: async () => ({ subscribed: 0 }) },
      isAuthenticated: true,
      hasGrant: false,
      finalCopy: 'Activar recordatorios',
    },
  ])('keeps a browser subscription removable after $label', async ({ response, isAuthenticated, hasGrant, finalCopy }) => {
    if (!hasGrant) window.history.replaceState(null, '', '/notificaciones')
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const register = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(browserSubscription),
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unsubscribed: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(isAuthenticated)} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(container.textContent).not.toContain('Recordatorios activos')
    expect(container.textContent).toContain('no pudimos completar la activación')
    expect(container.textContent).toContain('Desactivar suscripción')

    await clickButton(container, 'Desactivar suscripción')
    await flushPromises()

    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/push/subscribe',
      '/api/push/unsubscribe',
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ endpoint: subscriptionJson.endpoint })
    expect(container.textContent).toContain(finalCopy)
    await act(async () => root.unmount())
  })

  it('shows sign-in help without an activation button when there is no grant, session, or existing subscription', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const requestPermission = vi.fn()
    const register = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(undefined), register },
    })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()

    expect(container.textContent).toContain('iniciá sesión')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/ingresar?next=/notificaciones')
    expect(container.textContent).not.toContain('Activar recordatorios')
    expect(requestPermission).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('discovers an existing browser subscription after reload without asking permission', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const requestPermission = vi.fn()
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(),
    }
    const getRegistration = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
    })
    const register = vi.fn()
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration, register },
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ associated: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()

    expect(container.textContent).toContain('Recordatorios activos')
    expect(container.textContent).toContain('Desactivar recordatorios')
    expect(fetchMock).toHaveBeenCalledWith('/api/push/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscriptionJson.endpoint }),
    })
    expect(getRegistration).toHaveBeenCalledWith('/')
    expect(register).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('does not call an old VAPID subscription active and replaces it only after an allowed user gesture', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const requestPermission = vi.fn()
    const existing = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription',
      options: { applicationServerKey: base64UrlBytes(OTHER_VAPID_PUBLIC_KEY).buffer },
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
    const getRegistration = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(existing) },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration, register },
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscribed: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await flushPromises()

    expect(container.textContent).not.toContain('Recordatorios activos')
    expect(container.textContent).toContain('Actualizar recordatorios')
    expect(existing.unsubscribe).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    await clickButton(container, 'Actualizar recordatorios')
    await flushPromises()

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Recordatorios activos')
    await act(async () => root.unmount())
  })

  it.each(['a revoked server association', 'a prior failed association'])(
    'keeps a matching local subscription truthful after reload with %s',
    async () => {
      window.history.replaceState(null, '', '/notificaciones')
      const requestPermission = vi.fn()
      const browserSubscription = {
        endpoint: subscriptionJson.endpoint,
        options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
        toJSON: () => subscriptionJson,
        unsubscribe: vi.fn(),
      }
      const register = vi.fn()
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          getRegistration: vi.fn().mockResolvedValue({
            pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
          }),
          register,
        },
      })
      vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
      vi.stubGlobal('PushManager', class {})
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ associated: false }),
      })
      vi.stubGlobal('fetch', fetchMock)
      const { PushManager } = await import('@/components/push/push-manager')
      const container = document.createElement('div')
      const root = createRoot(container)

      await act(async () => root.render(<PushManager {...managerProps(true)} />))
      await flushPromises()

      expect(container.textContent).not.toContain('Recordatorios activos')
      expect(container.textContent).toContain('Actualizar recordatorios')
      expect(container.textContent).toContain('Desactivar suscripción')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(register).not.toHaveBeenCalled()
      expect(requestPermission).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )

  it('keeps a discovered subscription removable when server status is unavailable', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(),
    }
    const register = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
        }),
        register,
      },
    })
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ associated: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()

    expect(container.textContent).not.toContain('Recordatorios activos')
    expect(container.textContent).toContain('No pudimos verificar')
    expect(container.textContent).not.toContain('no está activa')
    expect(container.textContent).toContain('Desactivar suscripción')
    expect(container.textContent).toContain('Reintentar verificación')
    expect(register).not.toHaveBeenCalled()

    await clickButton(container, 'Reintentar verificación')
    await flushPromises()

    expect(container.textContent).toContain('Recordatorios activos')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(register).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('offers cleanup only when an old VAPID subscription has no activation scope', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const oldSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(OTHER_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(),
    }
    const register = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(oldSubscription) },
        }),
        register,
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()

    expect(container.textContent).not.toContain('Recordatorios activos')
    expect(container.textContent).not.toContain('Actualizar recordatorios')
    expect(container.textContent).toContain('Desactivar suscripción')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('best-effort cleans the old endpoint by possession before replacing a VAPID subscription', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const oldSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(OTHER_VAPID_PUBLIC_KEY).buffer },
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const freshSubscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-fresh',
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => ({ ...subscriptionJson, endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-fresh' }),
      unsubscribe: vi.fn(),
    }
    const subscribe = vi.fn().mockResolvedValue(freshSubscription)
    const register = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(oldSubscription), subscribe },
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(undefined), register },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscribed: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await flushPromises()
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      endpoint: oldSubscription.endpoint,
      endpointPossession: true,
    })
    expect(oldSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/push/subscribe')
    expect(container.textContent).toContain('Recordatorios activos')
    await act(async () => root.unmount())
  })

  it('retries an invalid guest grant once without it and unsubscribes locally exactly once', async () => {
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const register = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
        }),
        register,
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unsubscribed: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()
    expect(container.textContent).not.toContain('Recordatorios activos')
    expect(container.textContent).toContain('Desactivar suscripción')

    await clickButton(container, 'Desactivar suscripción')
    await flushPromises()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/push/status',
      '/api/push/unsubscribe',
      '/api/push/unsubscribe',
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      endpoint: subscriptionJson.endpoint,
      grant: 'signed grant',
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      endpoint: subscriptionJson.endpoint,
      endpointPossession: true,
    })
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(register).not.toHaveBeenCalled()
    expect(container.textContent).toContain('iniciá sesión')
    await act(async () => root.unmount())
  })

  it('forces stale guest cleanup to endpoint possession even with an authenticated session', async () => {
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    const register = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
        }),
        register,
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await flushPromises()
    await clickButton(container, 'Desactivar suscripción')
    await flushPromises()

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      endpoint: subscriptionJson.endpoint,
      grant: 'signed grant',
    })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      endpoint: subscriptionJson.endpoint,
      endpointPossession: true,
    })
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(register).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Activar recordatorios')
    await act(async () => root.unmount())
  })

  it('unsubscribes locally even when server cleanup fails and safely retries only cleanup', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const browserSubscription = {
      endpoint: subscriptionJson.endpoint,
      options: { applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(browserSubscription) },
        }),
        register: vi.fn(),
      },
    })
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('PushManager', class {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ associated: true }) })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))
    await flushPromises()
    await clickButton(container, 'Desactivar recordatorios')
    await flushPromises()

    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('desactivados en este navegador')
    expect(container.textContent).toContain('Reintentar limpieza')
    expect(container.textContent).not.toContain('Activar recordatorios')

    await clickButton(container, 'Reintentar limpieza')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][1]).toEqual(fetchMock.mock.calls[2][1])
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('iniciá sesión')
    expect(container.textContent).not.toContain('Activar recordatorios')
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

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
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

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(container.textContent).toContain('permiso fue rechazado')
    expect(register).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('retries failed server cleanup without locally resubscribing', async () => {
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

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()
    await clickButton(container, 'Desactivar recordatorios')
    await flushPromises()
    expect(container.textContent).toContain('desactivados en este navegador')
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1)

    await clickButton(container, 'Reintentar limpieza')
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

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(TEST_VAPID_PUBLIC_KEY),
    })
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/push/unsubscribe', expect.objectContaining({
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription',
        endpointPossession: true,
      }),
    }))
    expect(fetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
      body: JSON.stringify({ subscription: subscriptionJson }),
    }))
    expect(container.textContent).toContain('Recordatorios activos')
    await act(async () => root.unmount())
  })

  it('does not let best-effort VAPID cleanup failures block replacement', async () => {
    window.history.replaceState(null, '', '/notificaciones')
    const existing = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription',
      options: { applicationServerKey: base64UrlBytes(OTHER_VAPID_PUBLIC_KEY).buffer },
      toJSON: () => ({ ...subscriptionJson, endpoint: 'https://fcm.googleapis.com/fcm/send/old-subscription' }),
      unsubscribe: vi.fn().mockRejectedValue(new Error('browser cleanup unavailable')),
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ subscribed: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(true)} />))
    await clickButton(container, 'Activar recordatorios')
    await flushPromises()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/push/unsubscribe', expect.objectContaining({
      body: JSON.stringify({
        endpoint: existing.endpoint,
        endpointPossession: true,
      }),
    }))
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
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

  it('recognizes iPadOS desktop mode as iOS when PushManager is unavailable', async () => {
    vi.stubGlobal('PushManager', undefined)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    const { PushManager } = await import('@/components/push/push-manager')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<PushManager {...managerProps(false)} />))

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
      <PushManager vapidPublicKey={null} canonicalOrigin={window.location.origin} isAuthenticated={false} />,
    ))

    expect(container.textContent).toContain('no están disponibles')
    expect(container.querySelector('button')).toBeNull()
    await act(async () => root.unmount())
  })
})
