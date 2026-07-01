'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'
import { Lock, Trash2 } from 'lucide-react'
import { fromZonedTime } from 'date-fns-tz'
import { BlockFormFields } from './block-form-fields'

const PRESETS = [
  { label: 'Personalizado', value: 'custom' },
  { label: 'Almuerzo (13:00-14:00)', value: 'lunch' },
  { label: 'Tarde libre (tarde)', value: 'afternoon-off' },
  { label: 'Día completo', value: 'full-day' },
  { label: 'Vacaciones', value: 'vacation' },
  { label: 'Emergencia', value: 'emergency' },
]

interface BlockTimeModalProps {
  defaultDate: string | null
  timezone: string
}

function parseTimeUTC(dateStr: string, timeStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} ${timeStr}`, timezone)
}

export function BlockTimeModal({ defaultDate, timezone }: BlockTimeModalProps) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState('custom')
  const [date, setDate] = useState(defaultDate || '')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [reason, setReason] = useState('')
  const [confirmOverlap, setConfirmOverlap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function applyPreset(value: string) {
    setPreset(value)
    setConfirmOverlap(false)

    switch (value) {
      case 'lunch':
        setStartTime('13:00')
        setEndTime('14:00')
        setReason('Almuerzo')
        break
      case 'afternoon-off':
        setStartTime('14:00')
        setEndTime('20:00')
        setReason('Tarde libre')
        break
      case 'full-day':
        setStartTime('00:00')
        setEndTime('23:59')
        setReason('Día completo')
        break
      case 'vacation':
        setStartTime('00:00')
        setEndTime('23:59')
        setReason('Vacaciones')
        break
      case 'emergency':
        setStartTime('00:00')
        setEndTime('23:59')
        setReason('Emergencia')
        break
      default:
        break
    }
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setConfirmOverlap(false)
      setError(null)
    }
    setOpen(newOpen)
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

        const result = await createTimeBlock({
          startDateTime: start,
          endDateTime: end,
          reason: reason || null,
          confirmOverlap,
        })
        if (result && 'requiresConfirmation' in result) {
          setError(result.message)
          return
        }
        router.refresh()
        setOpen(false)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error al crear bloqueo')
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Lock className="size-3.5" />
        Bloquear horario
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear horario</DialogTitle>
            <DialogDescription>
              Crea un bloqueo para que los clientes no puedan reservar en este horario.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="preset">Tipo de bloqueo</Label>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger id="preset">
                  <SelectValue placeholder="Selecciona un tipo" />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <BlockFormFields
              date={date}
              onDateChange={setDate}
              startTime={startTime}
              onStartTimeChange={setStartTime}
              endTime={endTime}
              onEndTimeChange={setEndTime}
              reason={reason}
              onReasonChange={setReason}
            />

            <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Si el horario se solapa con reservas existentes,
                el sistema requerirá confirmación adicional.
                Las reservas no se cancelarán automáticamente.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="confirm-overlap"
                  checked={confirmOverlap}
                  onChange={(e) => setConfirmOverlap(e.target.checked)}
                  className="size-3.5 rounded border-muted-foreground/50 accent-primary"
                />
                <label htmlFor="confirm-overlap" className="text-xs text-muted-foreground">
                  Confirmar bloqueo aunque haya reservas en el horario
                </label>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creando...' : 'Bloquear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DeleteBlockButton({ blockId }: { blockId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTimeBlock(blockId)
        router.refresh()
      } catch {
        // ignore deletion errors
      }
    })
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive hover:text-destructive/80"
      onClick={handleDelete}
      disabled={isPending}
    >
      <Trash2 className="size-3" />
    </Button>
  )
}
