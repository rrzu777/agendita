'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createService, updateService } from '@/server/actions/services'
import { Pencil } from 'lucide-react'
import type { ReactNode } from 'react'

const PASTEL_COLORS = [
  '#FFB3BA', '#E2B3FF', '#A3D8FF', '#B3F0C8', '#FFF4B3', '#FFD4B3', '#D4B3FF', '#B3FFF4'
]

export function ServiceForm({
  service,
  onSuccess,
  triggerLabel,
  triggerIcon,
}: {
  service?: any
  onSuccess?: () => void
  triggerLabel?: string
  triggerIcon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedColor, setSelectedColor] = useState(service?.pastelColor || PASTEL_COLORS[0])

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const data = {
      name: formData.get('name') as string,
      description: formData.get('description') as string || null,
      durationMinutes: parseInt(formData.get('durationMinutes') as string),
      price: parseInt(formData.get('price') as string),
      depositAmount: parseInt(formData.get('depositAmount') as string),
      pastelColor: selectedColor,
      isActive: true,
      sortOrder: service?.sortOrder || 0,
    }

    try {
      if (service) {
        await updateService(service.id, data)
      } else {
        await createService(data)
      }
      setOpen(false)
      onSuccess?.()
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={service ? 'outline' : 'default'} size={service ? "sm" : "default"} className="font-semibold">
          {service ? <Pencil className="mr-2 size-4" /> : triggerIcon}
          {service ? 'Editar' : triggerLabel || 'Nuevo servicio'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-normal text-primary">{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow">Nombre</Label>
            <Input className="studio-input" name="name" defaultValue={service?.name} required />
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Descripción</Label>
            <Textarea className="min-h-24 rounded-lg border-border bg-card text-base focus-visible:border-primary focus-visible:ring-primary/20" name="description" defaultValue={service?.description || ''} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Precio</Label>
              <Input className="studio-input" name="price" type="number" defaultValue={service?.price} required />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Duración</Label>
              <Input className="studio-input" name="durationMinutes" type="number" defaultValue={service?.durationMinutes} required />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Abono</Label>
              <Input className="studio-input" name="depositAmount" type="number" defaultValue={service?.depositAmount} required />
            </div>
          </div>
          <div>
            <Label className="studio-eyebrow">Color</Label>
            <div className="flex gap-2 mt-2">
              {PASTEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`size-8 rounded-full border-2 transition ${selectedColor === color ? 'scale-110 border-primary' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <Button type="submit" className="h-12 w-full font-semibold" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
