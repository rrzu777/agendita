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
import { XCircle } from 'lucide-react'

interface CancelBookingButtonProps {
  bookingId: string
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'xs'
  label?: string
}

export function CancelBookingButton({
  bookingId,
  variant = 'destructive',
  size = 'sm',
  label = 'Cancelar',
}: CancelBookingButtonProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleConfirm() {
    setError('')
    setLoading(true)

    try {
      await cancelBooking(bookingId, reason || undefined)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cancelar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        <XCircle className="mr-1 size-3" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold tracking-normal text-primary">
              Confirmar cancelación
            </DialogTitle>
            <DialogDescription>
              ¿Estás segura de cancelar esta reserva? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="cancelReason" className="studio-eyebrow">
              Motivo (opcional)
            </Label>
            <Input
              id="cancelReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: La clienta canceló, reprogramar..."
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
              {loading ? 'Cancelando...' : 'Sí, cancelar reserva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
