'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { BookingData } from './wizard'
import { Mail, Phone, User } from 'lucide-react'

export function StepCustomer({ data, sessionEmail, onLoginCta, onSubmit, onBack }: {
  data: BookingData
  sessionEmail: string | null
  onLoginCta: (partial: Partial<BookingData>) => void
  onSubmit: (data: Partial<BookingData>) => void
  onBack: () => void
}) {
  const [formData, setFormData] = useState({
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail,
    customerNotes: data.customerNotes,
  })
  // "No soy yo": reserva para otra persona SIN cerrar sesión (signOut perdería el wizard).
  const [dismissedSession, setDismissedSession] = useState(false)
  const showSession = sessionEmail !== null && !dismissedSession

  function handleNotMe() {
    setDismissedSession(true)
    setFormData({ customerName: '', customerPhone: '', customerEmail: '', customerNotes: formData.customerNotes })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Tus datos</h2>
      <p className="mb-7 text-base text-muted-foreground">Ingresa tus datos para confirmar la reserva.</p>

      {sessionEmail === null && (
        <button
          type="button"
          onClick={() => onLoginCta(formData)}
          className="mb-6 w-full rounded-2xl border border-primary/25 bg-secondary/40 px-4 py-3 text-left text-sm text-primary transition hover:bg-secondary/60"
        >
          ¿Ya tienes cuenta? <span className="font-semibold underline">Ingresa</span> y completamos tus datos.
        </button>
      )}
      {showSession && (
        <p className="mb-6 text-sm text-muted-foreground">
          Reservando como {sessionEmail} ·{' '}
          <button type="button" onClick={handleNotMe} className="font-semibold text-primary hover:underline">No soy yo</button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label className="studio-eyebrow">Nombre completo *</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input className="studio-input pl-12" required minLength={2} value={formData.customerName}
              onChange={e => setFormData({ ...formData, customerName: e.target.value })}
              placeholder="Tu nombre" />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="studio-eyebrow">Teléfono *</Label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input className="studio-input pl-12" required type="tel" value={formData.customerPhone}
              onChange={e => setFormData({ ...formData, customerPhone: e.target.value })}
              placeholder="+569..." />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="studio-eyebrow">Email (opcional)</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input className="studio-input pl-12" type="email" value={formData.customerEmail}
              onChange={e => setFormData({ ...formData, customerEmail: e.target.value })}
              placeholder="tu@email.com" />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="studio-eyebrow">Notas (opcional)</Label>
          <Textarea className="min-h-28 rounded-lg border-border bg-card text-base focus-visible:border-primary focus-visible:ring-primary/20" value={formData.customerNotes}
            onChange={e => setFormData({ ...formData, customerNotes: e.target.value })}
            placeholder="¿Algo que debamos saber?" />
        </div>

        <div className="mt-8 flex gap-3">
          <Button type="button" variant="outline" className="h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
          <Button type="submit" className="h-12 flex-1 rounded-full text-base font-semibold">
            Continuar al pago
          </Button>
        </div>
      </form>
    </div>
  )
}
