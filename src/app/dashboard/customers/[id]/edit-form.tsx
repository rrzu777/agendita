'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { updateCustomer } from '@/server/actions/customers'
import type { CustomerDetail } from '@/server/actions/customers'
import { Pencil, Check, X, Cake } from 'lucide-react'

interface CustomerEditFormProps {
  customer: Pick<CustomerDetail, 'id' | 'name' | 'phone' | 'email' | 'birthDate'>
}

/** Date (UTC) almacenada como DATE -> 'YYYY-MM-DD' para el input date. */
function toInputDate(d: Date | null): string {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' -> "15 de mayo de 1990" (interpretado en UTC, sin corrimiento). */
function formatBirthDate(d: Date | null): string | null {
  if (!d) return null
  return new Date(d).toLocaleDateString('es-CL', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function CustomerEditForm({ customer }: CustomerEditFormProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(customer.name)
  const [phone, setPhone] = useState(customer.phone)
  const [email, setEmail] = useState(customer.email || '')
  const [birthDate, setBirthDate] = useState(toInputDate(customer.birthDate))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleCancel() {
    setName(customer.name)
    setPhone(customer.phone)
    setEmail(customer.email || '')
    setBirthDate(toInputDate(customer.birthDate))
    setIsEditing(false)
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const res = await updateCustomer(customer.id, {
          name,
          phone,
          email: email || null,
          birthDate: birthDate || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
        setIsEditing(false)
      } catch {
        setError('Error al actualizar')
      }
    })
  }

  if (!isEditing) {
    const birthLabel = formatBirthDate(customer.birthDate)
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">Telefono</p>
          <p className="font-medium text-primary">{customer.phone}</p>
        </div>
        {customer.email && (
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-medium text-primary">{customer.email}</p>
          </div>
        )}
        {birthLabel && (
          <div>
            <p className="text-xs text-muted-foreground">Cumpleaños</p>
            <p className="flex items-center gap-1.5 font-medium text-primary">
              <Cake className="size-4 text-secondary-foreground" />
              {birthLabel}
            </p>
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
          className="mt-2"
        >
          <Pencil className="mr-1 size-3" />
          Editar datos
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField id="name" label="Nombre" required>
        {(a11y) => (
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} density="form" disabled={isPending} {...a11y} />
        )}
      </FormField>
      <FormField id="phone" label="Telefono" required>
        {(a11y) => (
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required minLength={8} maxLength={20} density="form" disabled={isPending} {...a11y} />
        )}
      </FormField>
      <FormField id="email" label="Email" help="Opcional">
        {(a11y) => (
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional@ejemplo.com" density="form" disabled={isPending} {...a11y} />
        )}
      </FormField>
      <FormField id="birthDate" label="Fecha de nacimiento" help="Opcional — para saludar en su cumpleaños">
        {(a11y) => (
          <Input id="birthDate" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} density="form" disabled={isPending} {...a11y} />
        )}
      </FormField>
      {error && (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="form" disabled={isPending}>
          <Check className="mr-1 size-3" />
          {isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button
          type="button"
          size="form"
          variant="ghost"
          onClick={handleCancel}
          disabled={isPending}
        >
          <X className="mr-1 size-3" />
          Cancelar
        </Button>
      </div>
    </form>
  )
}
