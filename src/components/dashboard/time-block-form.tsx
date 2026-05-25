'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'
import { Ban, Coffee, Moon, Plus, Trash2, Umbrella } from 'lucide-react'

const PRESETS = [
  { label: 'Almuerzo', icon: Coffee, startTime: '13:00', endTime: '14:00', color: 'bg-amber-100 text-amber-800' },
  { label: 'Tarde libre', icon: Moon, startTime: '14:00', endTime: '18:00', color: 'bg-indigo-100 text-indigo-800' },
  { label: 'Día completo', icon: Ban, startTime: '09:00', endTime: '18:00', color: 'bg-red-100 text-red-800' },
  { label: 'Vacaciones', icon: Umbrella, startTime: '09:00', endTime: '18:00', color: 'bg-emerald-100 text-emerald-800' },
]

export function TimeBlockForm() {
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const router = useRouter()

  function applyPreset(preset: typeof PRESETS[number]) {
    const today = new Date().toISOString().split('T')[0]
    setStartDate(today)
    setEndDate(today)
    setStartTime(preset.startTime)
    setEndTime(preset.endTime)
  }

  async function handleSubmit(formData: FormData) {
    const startDateVal = formData.get('startDate') as string
    const startTimeVal = formData.get('startTime') as string
    const endDateVal = formData.get('endDate') as string
    const endTimeVal = formData.get('endTime') as string
    const reason = formData.get('reason') as string

    await createTimeBlock({
      startDateTime: new Date(`${startDateVal}T${startTimeVal}`),
      endDateTime: new Date(`${endDateVal}T${endTimeVal}`),
      reason: reason || null,
    })

    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 font-semibold">
          <Plus className="mr-2 size-4" />
          Bloquear horario
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-normal text-primary">Bloquear horario</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const Icon = preset.icon
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors hover:opacity-80 ${preset.color}`}
                >
                  <Icon className="size-3" />
                  {preset.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Fecha inicio</Label>
              <Input className="studio-input" name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Hora inicio</Label>
              <Input className="studio-input" name="startTime" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Fecha fin</Label>
              <Input className="studio-input" name="endDate" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Hora fin</Label>
              <Input className="studio-input" name="endTime" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Motivo (opcional)</Label>
            <Input className="studio-input" name="reason" placeholder="Vacaciones, emergencia, etc." />
          </div>
          <Button type="submit" className="h-12 w-full font-semibold">
            Bloquear
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TimeBlockList({ blocks: initialBlocks }: { blocks: { id: string; startDateTime: Date | string; endDateTime: Date | string; reason: string | null }[] }) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const blocks = initialBlocks.filter((block) => !deletedIds.has(block.id))

  async function handleDelete(id: string) {
    await deleteTimeBlock(id)
    setDeletedIds((current) => new Set(current).add(id))
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <svg className="size-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">No hay horarios bloqueados. Usa bloqueos para indicar días de vacaciones o cuando no puedas atender.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div key={block.id} className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Ban className="size-4" />
            </div>
            <div>
            <div className="font-semibold text-primary">
              {new Date(block.startDateTime).toLocaleDateString('es-CL')} {new Date(block.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} - {new Date(block.endDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {block.reason && <div className="text-sm text-muted-foreground">{block.reason}</div>}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(block.id)} aria-label="Eliminar bloqueo">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
