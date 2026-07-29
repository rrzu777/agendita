'use client'

import { useState, useTransition } from 'react'
import type { BookingStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { updateBookingStatus } from '@/server/actions/bookings'

/**
 * Botón de transición directa de estado de una reserva.
 *
 * Cubre "Completar" (confirmed → completed) y "Aceptar" (pending_confirmation →
 * confirmed): misma action, mismo manejo de error inline, sólo cambia el copy.
 * Vive en su propio archivo porque lo usan la tabla de reservas y el cajón del
 * calendario.
 */
export function BookingStatusButton({
  bookingId,
  status,
  label,
  pendingLabel,
  errorLabel,
  variant = 'outline',
  className,
  align = 'end',
}: {
  bookingId: string
  status: BookingStatus
  label: string
  pendingLabel: string
  errorLabel: string
  variant?: 'default' | 'outline'
  className?: string
  align?: 'start' | 'end'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={`flex flex-col ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <Button
        type="button"
        size="sm"
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            try {
              const res = await updateBookingStatus(bookingId, status)
              if (!res.ok) setError(res.error)
            } catch {
              setError(errorLabel)
            }
          })
        }}
      >
        {pending ? pendingLabel : label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
