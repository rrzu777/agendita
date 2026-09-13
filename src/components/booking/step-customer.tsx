'use client'

import { useRef, useState } from 'react'
import { unstable_rethrow } from 'next/navigation'
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
  onLoginCta: (partial: Partial<BookingData>) => void | Promise<void>
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
  const [loginPending, setLoginPending] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const formRef = useRef<HTMLFormElement>(null)
  const showSession = sessionEmail !== null && !dismissedSession

  function handleNotMe() {
    setDismissedSession(true)
    setFormData({ customerName: '', customerPhone: '', customerEmail: '', customerBirthDate: '', customerNotes: formData.customerNotes, serviceAddress: formData.serviceAddress })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!formData.customerName.trim()) nextErrors.customerName = 'Ingresa tu nombre completo.'
    if (formData.customerPhone.trim().length < 8) nextErrors.customerPhone = 'Ingresa un teléfono válido con al menos 8 caracteres.'
    if (needsAddress && !formData.serviceAddress.trim()) nextErrors.serviceAddress = 'Ingresa la dirección donde será la atención.'
    if (formData.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.customerEmail)) nextErrors.customerEmail = 'Ingresa un email válido o deja el campo vacío.'
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) {
      const ids: Record<string, string> = { customerName: 'booking-customer-name', customerPhone: 'booking-customer-phone', customerEmail: 'booking-customer-email', serviceAddress: 'booking-service-address' }
      formRef.current?.querySelector<HTMLElement>(`#${ids[first]}`)?.focus()
      return
    }
    onSubmit(formData)
  }

  function update<K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) {
    setFormData((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      const key = field.replace(/^customer/, '')
      const normalized = key.charAt(0).toLowerCase() + key.slice(1)
      if (!(normalized in current) && !(field in current)) return current
      const next = { ...current }
      delete next[normalized]
      delete next[field]
      return next
    })
  }

  return (
    <div>
      <h2 className="mb-1.5 font-heading text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Tus datos</h2>
      <p className="mb-7 text-base text-muted-foreground">{needsAddress ? 'Necesitamos tu nombre, teléfono y dirección para atenderte a domicilio.' : 'Solo necesitamos tu nombre y teléfono.'} Los demás datos son opcionales.</p>

      {sessionEmail === null && (
        <div className="mb-6 space-y-3">
        <Button
          type="button"
          disabled={loginPending}
          aria-busy={loginPending}
          onClick={async () => {
            setLoginPending(true)
            setLoginError('')
            try { await onLoginCta(formData) }
            catch (error) {
              unstable_rethrow(error)
              setLoginError('No pudimos conectar con Google. Puedes reintentar o reservar sin cuenta.')
            }
            finally { setLoginPending(false) }
          }}
          variant="outline" size="touch" className="w-full rounded-full"
        >
          {loginPending ? 'Conectando con Google…' : 'Continuar con Google'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">O reserva sin cuenta completando estos datos.</p>
        {loginError && <p role="alert" className="text-sm text-destructive">{loginError}</p>}
        </div>
      )}
      {showSession && (
        <p className="mb-6 text-sm text-muted-foreground">
          Reservando como {sessionEmail} ·{' '}
          <button type="button" onClick={handleNotMe} className="inline-flex min-h-11 items-center px-2 font-semibold text-primary hover:underline">No soy yo</button>
        </p>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5">
        <FormField id="booking-customer-name" label="Nombre completo" required help="Obligatorio" error={errors.customerName}>
          {(a11y) => <div className="relative"><User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-name" autoComplete="name" className="pl-12" required maxLength={100} value={formData.customerName} onChange={e => update('customerName', e.target.value)} placeholder="Tu nombre" density="touch" {...a11y} /></div>}
        </FormField>
        <FormField id="booking-customer-phone" label="Teléfono" required help="Obligatorio · Para contactarte por tu reserva." error={errors.customerPhone}>
          {(a11y) => <div className="relative"><Phone className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-phone" autoComplete="tel" className="pl-12" required type="tel" value={formData.customerPhone} onChange={e => update('customerPhone', e.target.value)} placeholder="+569..." density="touch" {...a11y} /></div>}
        </FormField>
        <FormField id="booking-customer-email" label="Email" optional help="Para recibir los detalles de tu reserva por correo." error={errors.customerEmail}>
          {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-customer-email" autoComplete="email" className="pl-12" type="email" value={formData.customerEmail} onChange={e => update('customerEmail', e.target.value)} placeholder="tu@email.com" density="touch" {...a11y} /></div>}
        </FormField>
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-medium text-primary">Agregar fecha de nacimiento (opcional)</summary>
          <div className="mt-4">
        <FormField id="booking-customer-birthdate" label="Fecha de nacimiento" help="Opcional · Puedes reservar sin compartirla.">
          {(a11y) => <Input
            id="booking-customer-birthdate"
            type="date"
            autoComplete="bday"
            max={new Date().toISOString().slice(0, 10)}
            value={formData.customerBirthDate}
            onChange={e => update('customerBirthDate', e.target.value)}
            density="touch"
            {...a11y}
          />}
        </FormField>
          </div>
        </details>
        {needsAddress && (
          <FormField id="booking-service-address" label="Dirección" required help="Obligatorio para atención a domicilio." error={errors.serviceAddress}>
            {(a11y) => <div className="relative"><MapPin className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input id="booking-service-address" className="pl-12" required value={formData.serviceAddress} onChange={e => update('serviceAddress', e.target.value)} placeholder="Calle, número, depto, comuna" density="touch" {...a11y} /></div>}
          </FormField>
        )}
        <details className="rounded-2xl border border-border p-4">
          <summary className="cursor-pointer font-medium text-primary">Agregar una nota (opcional)</summary>
          <div className="mt-4">
        <FormField id="booking-customer-notes" label="Notas" help="Opcional">
          {(a11y) => <Textarea id="booking-customer-notes" value={formData.customerNotes} maxLength={1000} onChange={e => update('customerNotes', e.target.value)} placeholder="¿Algo que debamos saber?" density="touch" {...a11y} />}
        </FormField>
          </div>
        </details>

        <div className="mt-8 flex gap-3">
          <Button type="button" variant="outline" size="touch" className="rounded-full" onClick={onBack}>Atrás</Button>
          <Button type="submit" size="touch" className="flex-1 rounded-full font-semibold">
            Revisar mi reserva
          </Button>
        </div>
      </form>
    </div>
  )
}
