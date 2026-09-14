'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cancelMyBooking } from '@/server/actions/my-bookings'
import { selfServiceBlockedMessage } from '@/lib/bookings/self-service'

export function BookingActions({
  bookingId,
  slug,
  canManage,
  cutoffHours,
  rescheduleBlockedReason,
}: {
  bookingId: string
  slug: string
  canManage: boolean
  cutoffHours: number
  /** Por qué no se puede reprogramar, o `null` si se puede. El plazo venció y el
   *  cron todavía no pasó: reprogramar no la salvaría —el sweep la barre igual— y
   *  hasta ahora la fila decía "Expirada" con un "Reprogramar" al lado que además
   *  FUNCIONABA: la reserva se movía y una hora después no estaba.
   *
   *  Viaja el TEXTO y no un booleano porque el motivo depende del status y acá no
   *  llega ninguno; que lo arme el server es además lo que garantiza que esta
   *  pantalla diga exactamente lo mismo que el error de la action. Requerido a
   *  propósito, como el resto de los gates de esta pantalla. */
  rescheduleBlockedReason: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  if (!canManage) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">{selfServiceBlockedMessage(cutoffHours)}</p>
    )
  }

  function handleCancel() {
    setError('')
    startTransition(async () => {
      try {
        const res = await cancelMyBooking(bookingId)
        if (!res.ok) {
          setError(res.error)
          return
        }
        setConfirming(false)
        router.refresh()
      } catch {
        setError('No se pudo cancelar')
      }
    })
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {confirming ? (
        <>
          <span className="w-full text-muted-foreground">¿Cancelar esta reserva?</span>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="min-h-11 rounded-lg px-3 font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {pending ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="min-h-11 rounded-lg px-3 text-muted-foreground hover:bg-secondary">
            No
          </button>
        </>
      ) : (
        <>
          {!rescheduleBlockedReason && (
            <Link href={`/mi/${slug}/reservas/${bookingId}/reprogramar`} className="flex min-h-11 items-center rounded-lg px-3 font-semibold text-primary hover:bg-secondary">
              Reprogramar
            </Link>
          )}
          {/* Cancelar se queda: sobre una reserva condenada es lo único que
              hace lo que dice, y libera el horario sin esperar al cron. */}
          <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg px-3 text-muted-foreground hover:bg-secondary hover:text-primary">
            Cancelar reserva
          </button>
          {rescheduleBlockedReason && (
            <span className="w-full text-xs text-muted-foreground">{rescheduleBlockedReason}</span>
          )}
        </>
      )}
      {error && <span role="alert" className="w-full text-xs text-destructive">{error}</span>}
    </div>
  )
}
