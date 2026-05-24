'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'
import { Ban, Plus, Trash2 } from 'lucide-react'

export function TimeBlockForm() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleSubmit(formData: FormData) {
    const startDate = formData.get('startDate') as string
    const startTime = formData.get('startTime') as string
    const endDate = formData.get('endDate') as string
    const endTime = formData.get('endTime') as string
    const reason = formData.get('reason') as string

    await createTimeBlock({
      startDateTime: new Date(`${startDate}T${startTime}`),
      endDateTime: new Date(`${endDate}T${endTime}`),
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Fecha inicio</Label>
              <Input className="studio-input" name="startDate" type="date" required />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Hora inicio</Label>
              <Input className="studio-input" name="startTime" type="time" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-y-4 gap-x-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Fecha fin</Label>
              <Input className="studio-input" name="endDate" type="date" required />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Hora fin</Label>
              <Input className="studio-input" name="endTime" type="time" required />
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
    return <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">No hay horarios bloqueados</p>
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
