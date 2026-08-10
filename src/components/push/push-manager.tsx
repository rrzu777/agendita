'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'

type ManagerStatus = 'checking' | 'available' | 'activating' | 'active' | 'denied' | 'unsupported' | 'disabled' | 'error'

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
}

const subscribeToBrowserReady = () => () => undefined

export function PushManager({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const browserReady = useSyncExternalStore(subscribeToBrowserReady, () => true, () => false)
  const [interactionStatus, setInteractionStatus] = useState<ManagerStatus | null>(null)
  const [retryAction, setRetryAction] = useState<'activate' | 'deactivate'>('activate')
  const grantRef = useRef<string | null>(null)
  const subscriptionRef = useRef<PushSubscription | null>(null)

  useEffect(() => {
    const hash = window.location.hash
    if (hash) {
      const grant = new URLSearchParams(hash.slice(1)).get('grant')
      if (grant && grant.length <= 4096) grantRef.current = grant
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }

  }, [])

  const availableStatus: ManagerStatus = !browserReady
    ? 'checking'
    : !vapidPublicKey
      ? 'disabled'
      : !('serviceWorker' in navigator) || !('Notification' in window) || typeof window.PushManager === 'undefined'
        ? 'unsupported'
        : Notification.permission === 'denied'
          ? 'denied'
          : 'available'
  const status = interactionStatus ?? availableStatus

  async function activate() {
    if (!vapidPublicKey) return
    setRetryAction('activate')
    setInteractionStatus('activating')
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      if (permission !== 'granted') {
        setInteractionStatus('denied')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(vapidPublicKey),
      })
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
      subscriptionRef.current = subscription
      setInteractionStatus('active')
    } catch {
      setInteractionStatus('error')
    }
  }

  async function deactivate() {
    const subscription = subscriptionRef.current
    if (!subscription) return
    setRetryAction('deactivate')
    setInteractionStatus('activating')
    try {
      const endpoint = subscription.endpoint
      const grant = grantRef.current
      const response = await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, ...(grant ? { grant } : {}) }),
      })
      if (!response.ok) throw new Error('Unsubscribe failed')
      await subscription.unsubscribe()
      subscriptionRef.current = null
      setInteractionStatus('available')
    } catch {
      setInteractionStatus('error')
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
