'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createTimeBlock, deleteTimeBlock } from '@/server/actions/time-blocks'

export function TimeBlockForm({ onSuccess }: { onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)

  async function handleSubmit(formData: FormData) {
    const startDate = formData.get('startDate') as string
    const startTime = formData.get('startTime') as string
    const endDate = formData.get('endDate') as string
    const endTime = formData.get('endTime') as string
    const reason = formData.get('reason') as string

    await createTimeBlock({
      businessId: 'mock-business-1',
      startDateTime: new Date(`${startDate}T${startTime}`),
      endDateTime: new Date(`${endDate}T${endTime}`),
      reason: reason || null,
    })

    setOpen(false)
    onSuccess?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Bloquear horario</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear horario</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha inicio</Label>
              <Input name="startDate" type="date" required />
            </div>
            <div>
              <Label>Hora inicio</Label>
              <Input name="startTime" type="time" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-y-4 gap-x-4">
            <div>
              <Label>Fecha fin</Label>
              <Input name="endDate" type="date" required />
            </div>
            <div>
              <Label>Hora fin</Label>
              <Input name="endTime" type="time" required />
            </div>
          </div>
          <div>
            <Label>Motivo (opcional)</Label>
            <Input name="reason" placeholder="Vacaciones, emergencia, etc." />
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600">
            Bloquear
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TimeBlockList({ blocks: initialBlocks }: { blocks: any[] }) {
  const [blocks, setBlocks] = useState(initialBlocks)

  async function handleDelete(id: string) {
    await deleteTimeBlock(id)
    setBlocks(blocks.filter(b => b.id !== id))
  }

  if (blocks.length === 0) {
    return <p className="text-gray-500">No hay horarios bloqueados</p>
  }

  return (
    <div className="space-y-2">
      {blocks.map((block) => (
        <div key={block.id} className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100">
          <div>
            <div className="font-medium">
              {new Date(block.startDateTime).toLocaleDateString('es-CL')} {new Date(block.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} - {new Date(block.endDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {block.reason && <div className="text-sm text-gray-600">{block.reason}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(block.id)}>
            Eliminar
          </Button>
        </div>
      ))}
    </div>
  )
}
