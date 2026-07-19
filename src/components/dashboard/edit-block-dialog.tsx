'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { updateTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'
import { deriveBlockFormValues, parseTimeUTC } from '@/lib/calendar/block-form-values'
import { BlockFormFields } from './block-form-fields'
import type { CalendarTimeBlock } from './time-block-card'

interface EditBlockDialogProps {
  block: CalendarTimeBlock
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditBlockDialog({ block, timezone, open, onOpenChange }: EditBlockDialogProps) {
  const initial = deriveBlockFormValues(block, timezone)
  const [date, setDate] = useState(initial.date)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [reason, setReason] = useState(initial.reason)
  const [overlapTolerance, setOverlapTolerance] = useState(initial.overlapTolerance)
  const [confirmOverlap, setConfirmOverlap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setConfirmOverlap(false)
      setConfirmingDelete(false)
      setError(null)
    }
    onOpenChange(newOpen)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!date) {
      setError('Selecciona una fecha')
      return
    }
    if (!startTime || !endTime) {
      setError('Define hora de inicio y fin')
      return
    }

    startTransition(async () => {
      try {
        const start = parseTimeUTC(date, startTime, timezone)
        const end = parseTimeUTC(date, endTime, timezone)

        const result = await updateTimeBlock(block.id, {
          startDateTime: start,
          endDateTime: end,
          reason: reason || null,
          overlapToleranceMinutes: Number(overlapTolerance) || 0,
          confirmOverlap,
        })
        if (!result.ok) { setError(result.error); return }
        if ('requiresConfirmation' in result.data) {
          setError(result.data.message)
          return
        }
        router.refresh()
        handleOpenChange(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al guardar el bloqueo')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteTimeBlock(block.id)
      if (!res.ok) { setError(res.error); return }
      router.refresh()
      handleOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {confirmingDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Eliminar bloqueo</DialogTitle>
              <DialogDescription>
                ¿Eliminar este bloqueo? Esta acción no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmingDelete(false)
                  setError(null)
                }}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
                {isPending ? 'Eliminando...' : 'Eliminar definitivamente'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Editar bloqueo</DialogTitle>
              <DialogDescription>Modifica el horario o el motivo de este bloqueo.</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <BlockFormFields
                date={date}
                onDateChange={setDate}
                startTime={startTime}
                onStartTimeChange={setStartTime}
                endTime={endTime}
                onEndTimeChange={setEndTime}
                reason={reason}
                onReasonChange={setReason}
                overlapTolerance={overlapTolerance}
                onOverlapToleranceChange={setOverlapTolerance}
              />

              <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">
                  Si el nuevo horario se solapa con reservas existentes, el sistema requerirá
                  confirmación adicional. Las reservas no se cancelarán automáticamente.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="confirm-overlap-edit"
                    checked={confirmOverlap}
                    onChange={(e) => setConfirmOverlap(e.target.checked)}
                    className="size-3.5 rounded border-muted-foreground/50 accent-primary"
                  />
                  <label htmlFor="confirm-overlap-edit" className="text-xs text-muted-foreground">
                    Confirmar bloqueo aunque haya reservas en el horario
                  </label>
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive/80"
                  onClick={() => {
                    setConfirmingDelete(true)
                    setError(null)
                  }}
                  disabled={isPending}
                >
                  Eliminar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
