'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  canonicalNotificationDestination,
  isCanonicalBrowserOrigin,
  replaceBrowserLocation,
} from '@/lib/push/canonical-client'

type ManagerStatus = 'checking' | 'available' | 'activating' | 'active' | 'denied' | 'unsupported' | 'disabled' | 'missing-scope' | 'update-required' | 'local-only' | 'verification-error' | 'association-error' | 'cleanup-error' | 'error'

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

function sameApplicationServerKey(
  existing: BufferSource | null | undefined,
  configured: Uint8Array<ArrayBuffer>,
): boolean {
  if (!existing) return false
  const bytes = ArrayBuffer.isView(existing)
    ? new Uint8Array(existing.buffer, existing.byteOffset, existing.byteLength)
    : new Uint8Array(existing)
  return bytes.length === configured.length
    && bytes.every((value, index) => value === configured[index])
}

const subscribeToBrowserReady = () => () => undefined

async function checkServerAssociation(
  subscription: PushSubscription,
  grant: string | null,
): Promise<'active' | 'inactive' | 'unavailable'> {
  try {
    const response = await fetch('/api/push/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        ...(grant ? { grant } : {}),
      }),
    })
    if (!response.ok) return 'unavailable'
    const result: unknown = await response.json()
    if (
      typeof result !== 'object'
      || result === null
      || !('associated' in result)
      || typeof (result as { associated: unknown }).associated !== 'boolean'
    ) {
      return 'unavailable'
    }
    return (result as { associated: boolean }).associated ? 'active' : 'inactive'
  } catch {
    return 'unavailable'
  }
}

export function PushManager({
  vapidPublicKey,
  canonicalOrigin,
  isAuthenticated,
}: {
  vapidPublicKey: string | null
  canonicalOrigin: string
  isAuthenticated: boolean
}) {
  const browserReady = useSyncExternalStore(subscribeToBrowserReady, () => true, () => false)
  const [interactionStatus, setInteractionStatus] = useState<ManagerStatus | null>(null)
  const [scopeStatus, setScopeStatus] = useState<'checking' | 'allowed' | 'missing'>('checking')
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [retryAction, setRetryAction] = useState<'activate' | 'deactivate'>('activate')
  const grantRef = useRef<string | null>(null)
  const redirectStartedRef = useRef(false)
  const subscriptionRef = useRef<PushSubscription | null>(null)
  const cleanupEndpointRef = useRef<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash
    let grant: string | null = null
    if (hash) {
      const candidate = new URLSearchParams(hash.slice(1)).get('grant')
      if (candidate && candidate.length <= 4096) grant = candidate
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }

    // Preserve the fragment value before the tenant redirect branch. Strict
    // Mode replays this effect after the fragment has already been cleared.
    if (grant !== null) grantRef.current = grant

    if (!isCanonicalBrowserOrigin(canonicalOrigin)) {
      if (redirectStartedRef.current) return
      redirectStartedRef.current = true
      replaceBrowserLocation(canonicalNotificationDestination(canonicalOrigin, grantRef.current))
      return
    }

    setScopeStatus(isAuthenticated || grantRef.current !== null ? 'allowed' : 'missing')

    let cancelled = false
    async function discoverExistingSubscription() {
      if (
        !('serviceWorker' in navigator)
        || !('Notification' in window)
        || typeof window.PushManager === 'undefined'
      ) {
        if (!cancelled) setDiscoveryComplete(true)
        return
      }

      try {
        const serviceWorker = navigator.serviceWorker
        const registration = typeof serviceWorker.getRegistration === 'function'
          ? await serviceWorker.getRegistration('/')
          : undefined
        const existing = await registration?.pushManager.getSubscription()
        if (!cancelled && existing) {
          subscriptionRef.current = existing
          const canActivate = isAuthenticated || grantRef.current !== null
          if (!vapidPublicKey) {
            setInteractionStatus('local-only')
            return
          }

          const configuredApplicationServerKey = applicationServerKey(vapidPublicKey)
          if (!sameApplicationServerKey(
            existing.options?.applicationServerKey,
            configuredApplicationServerKey,
          )) {
            setInteractionStatus(canActivate ? 'update-required' : 'local-only')
            return
          }

          const association = await checkServerAssociation(existing, grantRef.current)
          if (!cancelled) {
            setInteractionStatus(association === 'active'
              ? 'active'
              : association === 'inactive'
                ? canActivate ? 'update-required' : 'local-only'
                : 'verification-error')
          }
        }
      } catch {
        // Discovery is best effort. It never registers a worker or asks for
        // permission. A local subscription must remain removable even when
        // the authoritative server check is temporarily unavailable.
        if (!cancelled && subscriptionRef.current) {
          setInteractionStatus('verification-error')
        }
      } finally {
        if (!cancelled) setDiscoveryComplete(true)
      }
    }
    void discoverExistingSubscription()

    return () => { cancelled = true }
  }, [canonicalOrigin, isAuthenticated, vapidPublicKey])

  const availableStatus: ManagerStatus = !browserReady || !discoveryComplete || scopeStatus === 'checking'
    ? 'checking'
    : !isCanonicalBrowserOrigin(canonicalOrigin)
      ? 'checking'
    : !vapidPublicKey
      ? 'disabled'
      : !('serviceWorker' in navigator) || !('Notification' in window) || typeof window.PushManager === 'undefined'
        ? 'unsupported'
        : Notification.permission === 'denied'
          ? 'denied'
          : scopeStatus === 'missing'
            ? 'missing-scope'
            : 'available'
  const status = interactionStatus ?? availableStatus

  async function activate() {
    if (!vapidPublicKey || scopeStatus !== 'allowed' || !isCanonicalBrowserOrigin(canonicalOrigin)) return
    setRetryAction('activate')
    setInteractionStatus('activating')
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission === 'denied') {
        setInteractionStatus('denied')
        return
      }
      if (permission !== 'granted') {
        setInteractionStatus('available')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      const existing = await registration.pushManager.getSubscription()
      const configuredApplicationServerKey = applicationServerKey(vapidPublicKey)
      let subscription: PushSubscription
      if (existing && sameApplicationServerKey(existing.options?.applicationServerKey, configuredApplicationServerKey)) {
        subscription = existing
      } else {
        if (existing) {
          // A VAPID rotation produces a new browser endpoint/key capability.
          // Retire every server scope carried by the old endpoint first so its
          // rows cannot keep consuming device caps. Cleanup is deliberately
          // best effort: a transient server failure must not block replacement.
          await cleanupEndpointPossession(existing.endpoint)
          try {
            await existing.unsubscribe()
          } catch {
            // The replacement attempt remains authoritative. If the browser
            // cannot retire the stale local generation, subscribe will either
            // replace it or fail with the normal retryable activation state.
          }
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: configuredApplicationServerKey,
        })
      }
      // Browser subscription creation is an external effect. Keep possession
      // immediately so a failed/zero-target server association can still be
      // cleaned up without forcing a page reload.
      subscriptionRef.current = subscription
      const serialized = subscription.toJSON()
      const grant = grantRef.current
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: serialized, ...(grant ? { grant } : {}) }),
      })
      const result: unknown = await response.json()
      if (!response.ok
        || typeof result !== 'object'
        || result === null
        || !('subscribed' in result)
        || typeof (result as { subscribed: unknown }).subscribed !== 'number'
        || (result as { subscribed: number }).subscribed < 1) {
        throw new Error('Subscription was not associated')
      }
      setInteractionStatus('active')
    } catch {
      if (subscriptionRef.current) {
        // A rejected/expired grant would make every cleanup retry return 401.
        // Once association failed, cleanup falls back to endpoint possession;
        // an authenticated session remains independently eligible to retry.
        grantRef.current = null
        setScopeStatus(isAuthenticated ? 'allowed' : 'missing')
        setRetryAction('deactivate')
        setInteractionStatus('association-error')
      } else {
        setInteractionStatus('error')
      }
    }
  }

  async function deactivate() {
    const subscription = subscriptionRef.current
    if (!subscription) return
    setRetryAction('deactivate')
    setInteractionStatus('activating')
    const endpoint = subscription.endpoint
    let serverCleaned = false
    let locallyUnsubscribed = false
    serverCleaned = await cleanupServerAssociation(endpoint)

    try {
      locallyUnsubscribed = await subscription.unsubscribe()
    } catch {
      locallyUnsubscribed = false
    }

    if (locallyUnsubscribed) {
      subscriptionRef.current = null
    }
    if (!locallyUnsubscribed) {
      setInteractionStatus('error')
      return
    }
    if (!serverCleaned) {
      cleanupEndpointRef.current = endpoint
      setInteractionStatus('cleanup-error')
      return
    }

    cleanupEndpointRef.current = null
    setInteractionStatus(isAuthenticated || grantRef.current !== null
      ? 'available'
      : 'missing-scope')
  }

  async function retryCleanup() {
    const endpoint = cleanupEndpointRef.current
    if (!endpoint) return
    setInteractionStatus('activating')
    try {
      if (!await cleanupServerAssociation(endpoint)) throw new Error('Cleanup failed')
      cleanupEndpointRef.current = null
      setInteractionStatus(isAuthenticated || grantRef.current !== null
        ? 'available'
        : 'missing-scope')
    } catch {
      setInteractionStatus('cleanup-error')
    }
  }

  async function retryVerification() {
    const subscription = subscriptionRef.current
    if (!subscription || !vapidPublicKey) return
    setInteractionStatus('checking')
    const configuredApplicationServerKey = applicationServerKey(vapidPublicKey)
    if (!sameApplicationServerKey(
      subscription.options?.applicationServerKey,
      configuredApplicationServerKey,
    )) {
      setInteractionStatus(isAuthenticated || grantRef.current !== null
        ? 'update-required'
        : 'local-only')
      return
    }

    const association = await checkServerAssociation(subscription, grantRef.current)
    setInteractionStatus(association === 'active'
      ? 'active'
      : association === 'inactive'
        ? isAuthenticated || grantRef.current !== null ? 'update-required' : 'local-only'
        : 'verification-error')
  }

  async function cleanupServerAssociation(endpoint: string): Promise<boolean> {
    const cleanup = async (grant: string | null, endpointPossession = false) => {
      try {
        return await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint,
            ...(grant ? { grant } : {}),
            ...(endpointPossession ? { endpointPossession: true } : {}),
          }),
        })
      } catch {
        return null
      }
    }

    const grant = grantRef.current
    const response = await cleanup(grant)
    if (response?.ok) return true
    if (!grant || response === null) return false

    // An explicit guest capability takes precedence on the server. If it is
    // stale, discard it and retry once without it so the endpoint-possession
    // cleanup path remains reachable. This never recreates a subscription.
    grantRef.current = null
    setScopeStatus(isAuthenticated ? 'allowed' : 'missing')
    return (await cleanup(null, true))?.ok === true
  }

  async function cleanupEndpointPossession(endpoint: string): Promise<void> {
    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, endpointPossession: true }),
      })
    } catch {
      // Best effort by design; the new browser subscription can still be
      // associated and later endpoint cleanup remains possession-scoped.
    }
  }

  if (status === 'checking') return <p>Comprobando compatibilidad…</p>
  if (status === 'disabled') return <p>Los recordatorios push no están disponibles por ahora.</p>
  if (status === 'unsupported') {
    return isIos()
      ? <p>En iPhone o iPad, primero instalá Agendita en la pantalla de inicio y abrila desde ahí para activar recordatorios.</p>
      : <p>Este navegador no admite recordatorios push.</p>
  }
  if (status === 'denied') {
    return <p>El permiso fue rechazado. Podés habilitar las notificaciones desde la configuración del navegador.</p>
  }
  if (status === 'missing-scope') {
    return (
      <div className="space-y-3">
        <p>Para activar recordatorios, iniciá sesión o volvé desde la confirmación de una reserva elegible.</p>
        <Link href="/ingresar?next=/notificaciones" className="font-semibold text-primary underline">
          Iniciar sesión
        </Link>
      </div>
    )
  }
  if (status === 'association-error') {
    return (
      <div className="space-y-3">
        <p>El navegador creó la suscripción, pero no pudimos completar la activación en el servidor. Desactivala para limpiar el intento antes de volver a probar.</p>
        <Button type="button" variant="outline" onClick={deactivate}>Desactivar suscripción</Button>
      </div>
    )
  }
  if (status === 'update-required') {
    return (
      <div className="space-y-3">
        <p>La suscripción de este navegador no está activa en el servidor. Podés actualizarla o eliminarla.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={activate}>Actualizar recordatorios</Button>
          <Button type="button" variant="outline" onClick={deactivate}>Desactivar suscripción</Button>
        </div>
      </div>
    )
  }
  if (status === 'local-only') {
    return (
      <div className="space-y-3">
        <p>Hay una suscripción en este navegador, pero no está activa con la configuración actual.</p>
        <Button type="button" variant="outline" onClick={deactivate}>Desactivar suscripción</Button>
      </div>
    )
  }
  if (status === 'verification-error') {
    return (
      <div className="space-y-3">
        <p>No pudimos verificar si los recordatorios de este navegador siguen activos.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={retryVerification}>Reintentar verificación</Button>
          <Button type="button" variant="outline" onClick={deactivate}>Desactivar suscripción</Button>
        </div>
      </div>
    )
  }
  if (status === 'cleanup-error') {
    return (
      <div className="space-y-3">
        <p>Los recordatorios quedaron desactivados en este navegador, pero no pudimos limpiar el registro del servidor.</p>
        <Button type="button" variant="outline" onClick={retryCleanup}>Reintentar limpieza</Button>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="space-y-3">
        <p>No pudimos cambiar tus recordatorios. Revisá la conexión e intentá de nuevo.</p>
        <Button type="button" onClick={retryAction === 'deactivate' ? deactivate : activate}>
          Reintentar
        </Button>
      </div>
    )
  }
  if (status === 'active') {
    return (
      <div className="space-y-3">
        <p>Recordatorios activos</p>
        <Button type="button" variant="outline" onClick={deactivate}>Desactivar recordatorios</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p>Activá un aviso antes de que cierre el plazo para cancelar o reprogramar.</p>
      <Button type="button" disabled={status === 'activating'} onClick={activate}>
        {status === 'activating' ? 'Activando…' : 'Activar recordatorios'}
      </Button>
    </div>
  )
}
