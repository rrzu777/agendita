'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BookingData } from './wizard'

export function StepCustomer({ data, onSubmit, onBack }: { data: BookingData; onSubmit: (data: Partial<BookingData>) => void; onBack: () => void }) {
  const [formData, setFormData] = useState({
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    customerNotes: data.customerNotes,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Tus datos</h2>
      <p className="text-gray-600 mb-6">Ingresa tus datos para la reserva</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Nombre completo *</Label>
          <Input required minLength={2} value={formData.customerName}
            onChange={e => setFormData({ ...formData, customerName: e.target.value })}
            placeholder="Tu nombre" />
        </div>
        <div>
          <Label>Teléfono *</Label>
          <Input required type="tel" value={formData.customerPhone}
            onChange={e => setFormData({ ...formData, customerPhone: e.target.value })}
            placeholder="+569..." />
        </div>
        <div>
          <Label>Email (opcional)</Label>
          <Input type="email" value={formData.customerEmail}
            onChange={e => setFormData({ ...formData, customerEmail: e.target.value })}
            placeholder="tu@email.com" />
        </div>
        <div>
          <Label>Notas (opcional)</Label>
          <Textarea value={formData.customerNotes}
            onChange={e => setFormData({ ...formData, customerNotes: e.target.value })}
            placeholder="¿Algo que debamos saber?" />
        </div>

        <div className="flex gap-3 mt-6">
          <Button type="button" variant="outline" onClick={onBack}>Atrás</Button>
          <Button type="submit" className="flex-1 bg-pink-500 hover:bg-pink-600">
            Continuar al pago
          </Button>
        </div>
      </form>
    </div>
  )
}
