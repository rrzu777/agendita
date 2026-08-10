'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function guestPushGrantSessionKey(bookingId: string): string {
  return `agendita:push-grant:${bookingId}`
}

export function GuestPushLink({
  bookingId,
  canonicalOrigin,
  pushGrant = null,
  className,
}: {
  bookingId: string
  canonicalOrigin: string
  pushGrant?: string | null
  className?: string
}) {
  const [grant, setGrant] = useState<string | null>(pushGrant)

  useEffect(() => {
    const key = guestPushGrantSessionKey(bookingId)
    const stored = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    if (!pushGrant && stored) {
      // One-time hydration from the tenant origin after a payment redirect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGrant(stored)
    }
  }, [bookingId, pushGrant])

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
