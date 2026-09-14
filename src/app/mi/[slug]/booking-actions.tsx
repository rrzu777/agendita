'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cancelMyBooking } from '@/server/actions/my-bookings'
import { selfServiceBlockedMessage } from '@/lib/bookings/self-service'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'

export function BookingActions({
  bookingId,
  slug,
  serviceName,
  startsAtLabel,
  canManage,
  cutoffHours,
  rescheduleBlockedReason,
}: {
  bookingId: string
  slug: string
  serviceName: string
  startsAtLabel: string
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
  const cancelTriggerRef = useRef<HTMLButtonElement>(null)
  const keepBookingRef = useRef<HTMLButtonElement>(null)

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
      <>
          {!rescheduleBlockedReason && (
            <Link href={`/mi/${slug}/reservas/${bookingId}/reprogramar`} className="flex min-h-11 items-center rounded-lg px-3 font-semibold text-primary hover:bg-secondary">
              Reprogramar
            </Link>
          )}
          {/* Cancelar se queda: sobre una reserva condenada es lo único que
              hace lo que dice, y libera el horario sin esperar al cron. */}
          <AlertDialog open={confirming} onOpenChange={(open) => {
            if (pending) return
            setConfirming(open)
            if (!open) window.setTimeout(() => cancelTriggerRef.current?.focus(), 0)
          }}>
            <AlertDialogTrigger asChild>
              <button ref={cancelTriggerRef} type="button" className="min-h-11 rounded-lg px-3 text-muted-foreground hover:bg-secondary hover:text-primary">
                Cancelar reserva
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onOpenAutoFocus={(event) => { event.preventDefault(); keepBookingRef.current?.focus() }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar {serviceName}</AlertDialogTitle>
                <AlertDialogDescription>
                  La reserva del {startsAtLabel} se cancelará y ese horario volverá a quedar disponible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button ref={keepBookingRef} type="button" size="touch" variant="outline" disabled={pending}>Conservar reserva</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button type="button" size="touch" variant="destructive" disabled={pending} onClick={(event) => { event.preventDefault(); handleCancel() }}>
                    {pending ? 'Cancelando…' : 'Cancelar reserva'}
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {rescheduleBlockedReason && (
            <span className="w-full text-xs text-muted-foreground">{rescheduleBlockedReason}</span>
          )}
        </>
    </div>
  )
}
