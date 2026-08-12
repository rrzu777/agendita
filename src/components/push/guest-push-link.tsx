'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function guestPushGrantSessionKey(bookingId: string): string {
  return `agendita:push-grant:${bookingId}`
}

export function GuestPushLink({
  bookingId,
  canonicalOrigin,
  pushGrant,
  className,
}: {
  bookingId: string
  canonicalOrigin: string
  pushGrant?: string | null
  className?: string
}) {
  const [storedGrant, setStoredGrant] = useState<{ bookingId: string; grant: string } | null>(null)

  useEffect(() => {
    const key = guestPushGrantSessionKey(bookingId)
    let stored: string | null = null
    try {
      stored = sessionStorage.getItem(key)
      sessionStorage.removeItem(key)
    } catch {
      // Some privacy modes expose sessionStorage but throw SecurityError on
      // access. Do not expose a value we could not consume one-time; a direct
      // action result remains usable without storage.
      stored = null
    }

    // `undefined` means this is the redirect confirmation surface and may
    // consume session state. Explicit `null` means push is disabled.
    const next = pushGrant === undefined && stored
      ? { bookingId, grant: stored }
      : null
    // The bookingId carried in state prevents an old identity from rendering
    // during a prop transition before this effect runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredGrant(next)
  }, [bookingId, pushGrant])

  const grant = typeof pushGrant === 'string'
    ? pushGrant
    : pushGrant === undefined && storedGrant?.bookingId === bookingId
      ? storedGrant.grant
      : null

  if (!grant) return null

  const origin = canonicalOrigin.replace(/\/$/, '')
  const href = `${origin}/notificaciones#grant=${encodeURIComponent(grant)}`

  return (
    <div className={className}>
      <Button asChild variant="outline" className="h-12 w-full text-base font-semibold">
        <a href={href}>Activar recordatorios</a>
      </Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Te avisaremos antes de que cierre el plazo para cancelar o reprogramar.
      </p>
    </div>
  )
}
