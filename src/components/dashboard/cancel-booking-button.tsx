'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { cancelBooking } from '@/server/actions/bookings'
import { useVocabulary } from '@/components/vocabulary-provider'
import { XCircle } from 'lucide-react'

interface CancelBookingButtonProps {
  bookingId: string
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'xs'
  label?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** 'reject' = rechazar una solicitud que espera confirmación. Misma acción de
   *  fondo (cancelar con motivo), otro copy: la clienta todavía no tiene una
   *  reserva que "se cancele", tiene un pedido que se responde que no. */
  mode?: 'cancel' | 'reject'
}

/** Copy de las dos variantes. El motivo VIAJA EN EL EMAIL a la clienta (no es
 *  sólo una nota interna), así que el label lo dice explícitamente. */
const COPY = {
  cancel: {
    title: 'Confirmar cancelación',
    description: '¿Confirmas que quieres cancelar esta reserva? Esta acción no se puede deshacer.',
    confirm: 'Sí, cancelar reserva',
    loading: 'Cancelando...',
    errorText: 'Error al cancelar',
  },
  reject: {
    title: 'Rechazar solicitud',
    description: 'La solicitud se cancela y el horario vuelve a quedar libre. Esta acción no se puede deshacer.',
    confirm: 'Sí, rechazar',
    loading: 'Rechazando...',
    errorText: 'Error al rechazar',
  },
} as const

export function CancelBookingButton({
  bookingId,
  variant = 'destructive',
  size = 'sm',
  label = 'Cancelar',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  mode = 'cancel',
}: CancelBookingButtonProps) {
  const copy = COPY[mode]
  const vocabulary = useVocabulary()
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleConfirm() {
    setError('')
    setLoading(true)

    try {
      const res = await cancelBooking(bookingId, reason || undefined)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError(copy.errorText)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant={variant}
          size={size}
          onClick={() => setOpen(true)}
        >
          <XCircle className="mr-1 size-3" />
          {label}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-heading font-semibold tracking-tight text-primary">
              {copy.title}
            </DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="cancelReason" className="studio-eyebrow">
              Motivo (opcional, se lo mandamos por email)
            </Label>
            <Input
              id="cancelReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={`Ej: ${vocabulary.TheClient} canceló, reprogramar...`}
              className="studio-input"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Volver
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
              {loading ? copy.loading : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
