'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BookingData } from './wizard'
import { requiresServiceAddress } from '@/lib/services/modality'
import { Mail, MapPin, Phone, User } from 'lucide-react'

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
    customerBirthDate: data.customerBirthDate ?? '',
    customerNotes: data.customerNotes,
    serviceAddress: data.serviceAddress,
  })
  const needsAddress = data.serviceModality != null && requiresServiceAddress(data.serviceModality)
  // "No soy yo": reserva para otra persona SIN cerrar sesión (signOut perdería el wizard).
  const [dismissedSession, setDismissedSession] = useState(false)
  const showSession = sessionEmail !== null && !dismissedSession

  function handleNotMe() {
    setDismissedSession(true)
    setFormData({ customerName: '', customerPhone: '', customerEmail: '', customerBirthDate: '', customerNotes: formData.customerNotes, serviceAddress: formData.serviceAddress })
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
        <FormField id="booking-customer-name" label="Nombre completo" required>
          {(a11y) => <div className="relative"><User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-name" className="pl-12" required minLength={2} value={formData.customerName} onChange={e => setFormData({ ...formData, customerName: e.target.value })} placeholder="Tu nombre" density="touch" {...a11y} /></div>}
        </FormField>
        <FormField id="booking-customer-phone" label="Teléfono" required>
          {(a11y) => <div className="relative"><Phone className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-phone" className="pl-12" required type="tel" value={formData.customerPhone} onChange={e => setFormData({ ...formData, customerPhone: e.target.value })} placeholder="+569..." density="touch" {...a11y} /></div>}
        </FormField>
        <FormField id="booking-customer-email" label="Email" help="Opcional">
          {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-email" className="pl-12" type="email" value={formData.customerEmail} onChange={e => setFormData({ ...formData, customerEmail: e.target.value })} placeholder="tu@email.com" density="touch" {...a11y} /></div>}
        </FormField>
        <FormField id="booking-customer-birthdate" label="Cumpleaños" help="Opcional">
          {(a11y) => <Input
            id="booking-customer-birthdate"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={formData.customerBirthDate}
            onChange={e => setFormData({ ...formData, customerBirthDate: e.target.value })}
            density="touch"
            {...a11y}
          />}
        </FormField>
        {needsAddress && (
          <FormField id="booking-service-address" label="Dirección" required help="Vamos a tu domicilio: necesitamos saber a dónde.">
            {(a11y) => <div className="relative"><MapPin className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-service-address" className="pl-12" required value={formData.serviceAddress} onChange={e => setFormData({ ...formData, serviceAddress: e.target.value })} placeholder="Calle, número, depto, comuna" density="touch" {...a11y} /></div>}
          </FormField>
        )}
        <FormField id="booking-customer-notes" label="Notas" help="Opcional">
          {(a11y) => <Textarea id="booking-customer-notes" value={formData.customerNotes} onChange={e => setFormData({ ...formData, customerNotes: e.target.value })} placeholder="¿Algo que debamos saber?" density="touch" {...a11y} />}
        </FormField>

        <div className="mt-8 flex gap-3">
          <Button type="button" variant="outline" size="touch" className="rounded-full" onClick={onBack}>Atrás</Button>
          <Button type="submit" size="touch" className="flex-1 rounded-full font-semibold">
            Continuar al pago
          </Button>
        </div>
      </form>
    </div>
  )
}
