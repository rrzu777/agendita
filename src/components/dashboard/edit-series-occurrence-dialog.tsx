'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  skipSeriesOccurrence, overrideSeriesOccurrence, updateTimeBlockSeries, deleteTimeBlockSeries,
} from '@/server/actions/time-blocks'
import { deriveBlockFormValues, parseTimeUTC } from '@/lib/calendar/block-form-values'
import { BlockFormFields } from './block-form-fields'
import type { CalendarTimeBlock } from './time-block-card'

interface Props {
  block: CalendarTimeBlock
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Scope = 'occurrence' | 'series'

export function EditSeriesOccurrenceDialog({ block, timezone, open, onOpenChange }: Props) {
  const initial = deriveBlockFormValues(block, timezone)
  const [date, setDate] = useState(initial.date)
  const [startTime, setStartTime] = useState(initial.startTime)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [reason, setReason] = useState(initial.reason)
  const [error, setError] = useState<string | null>(null)
  const [pendingScope, setPendingScope] = useState<null | { action: 'save' | 'delete' }>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const seriesId = block.seriesId as string
  const occurrenceDate = new Date(block.occurrenceDate as string)

  function reset() {
    setPendingScope(null)
    setError(null)
  }
  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) reset()
    onOpenChange(newOpen)
  }

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn()
        router.refresh()
        handleOpenChange(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  function saveScope(scope: Scope) {
    if (scope === 'occurrence') {
      run(() => overrideSeriesOccurrence(seriesId, occurrenceDate, {
        startDateTime: parseTimeUTC(date, startTime, timezone),
        endDateTime: parseTimeUTC(date, endTime, timezone),
        reason: reason || null,
      }))
    } else {
      // Editar toda la serie = cambiar hora/motivo de toda la serie (conserva días y fin).
      run(async () => { await updateTimeBlockSeries(seriesId, { startTime, endTime, reason: reason || null }) })
    }
  }

  function deleteScope(scope: Scope) {
    if (scope === 'occurrence') {
      run(() => skipSeriesOccurrence(seriesId, occurrenceDate))
    } else {
      run(() => deleteTimeBlockSeries(seriesId))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {pendingScope ? (
          <>
            <DialogHeader>
              <DialogTitle>{pendingScope.action === 'delete' ? 'Eliminar' : 'Guardar cambios'}</DialogTitle>
              <DialogDescription>
                ¿Aplicar solo a este día o a toda la serie? Editar toda la serie
                restablecerá los días que hayas editado individualmente de hoy en adelante.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={reset} disabled={isPending}>Cancelar</Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => (pendingScope.action === 'delete' ? deleteScope('occurrence') : saveScope('occurrence'))} disabled={isPending}>
                  Solo este día
                </Button>
                <Button type="button" variant={pendingScope.action === 'delete' ? 'destructive' : 'default'} onClick={() => (pendingScope.action === 'delete' ? deleteScope('series') : saveScope('series'))} disabled={isPending}>
                  Toda la serie
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Editar bloqueo recurrente</DialogTitle>
              <DialogDescription>Modifica esta ocurrencia o toda la serie.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <BlockFormFields
                date={date} onDateChange={setDate}
                startTime={startTime} onStartTimeChange={setStartTime}
                endTime={endTime} onEndTimeChange={setEndTime}
                reason={reason} onReasonChange={setReason}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive/80" onClick={() => { setPendingScope({ action: 'delete' }); setError(null) }} disabled={isPending}>
                  Eliminar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancelar</Button>
                  <Button type="button" onClick={() => { setPendingScope({ action: 'save' }); setError(null) }} disabled={isPending}>Guardar cambios</Button>
                </div>
              </DialogFooter>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
