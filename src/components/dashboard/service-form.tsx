'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createService, updateService } from '@/server/actions/services'

const PASTEL_COLORS = [
  '#FFB3BA', '#E2B3FF', '#A3D8FF', '#B3F0C8', '#FFF4B3', '#FFD4B3', '#D4B3FF', '#B3FFF4'
]

export function ServiceForm({ service, onSuccess }: { service?: any, onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedColor, setSelectedColor] = useState(service?.pastelColor || PASTEL_COLORS[0])

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const data = {
      businessId: 'mock-business-1',
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
        <Button className={service ? "bg-gray-500 hover:bg-gray-600" : "bg-pink-500 hover:bg-pink-600"} size={service ? "sm" : "default"}>
          {service ? 'Editar' : 'Nuevo servicio'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label>Nombre</Label>
            <Input name="name" defaultValue={service?.name} required />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea name="description" defaultValue={service?.description || ''} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Precio (CLP)</Label>
              <Input name="price" type="number" defaultValue={service?.price} required />
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Input name="durationMinutes" type="number" defaultValue={service?.durationMinutes} required />
            </div>
            <div>
              <Label>Abono (CLP)</Label>
              <Input name="depositAmount" type="number" defaultValue={service?.depositAmount} required />
            </div>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-2">
              {PASTEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-full border-2 transition ${selectedColor === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full bg-pink-500 hover:bg-pink-600" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
