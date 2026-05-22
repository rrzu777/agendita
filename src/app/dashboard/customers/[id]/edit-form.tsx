'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateCustomer } from '@/server/actions/customers'
import type { CustomerDetail } from '@/server/actions/customers'
import { Pencil, Check, X } from 'lucide-react'

interface CustomerEditFormProps {
  customer: Pick<CustomerDetail, 'id' | 'name' | 'phone' | 'email'>
}

export function CustomerEditForm({ customer }: CustomerEditFormProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(customer.name)
  const [phone, setPhone] = useState(customer.phone)
  const [email, setEmail] = useState(customer.email || '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleCancel() {
    setName(customer.name)
    setPhone(customer.phone)
    setEmail(customer.email || '')
    setIsEditing(false)
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        await updateCustomer(customer.id, {
          name,
          phone,
          email: email || null,
        })
        router.refresh()
        setIsEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al actualizar')
      }
    })
  }

  if (!isEditing) {
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
      <div>
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          className="studio-input"
          disabled={isPending}
        />
      </div>
      <div>
        <Label htmlFor="phone">Telefono</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          minLength={8}
          maxLength={20}
          className="studio-input"
          disabled={isPending}
        />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="opcional@ejemplo.com"
          className="studio-input"
          disabled={isPending}
        />
        <p className="mt-1 text-xs text-muted-foreground">Opcional</p>
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          <Check className="mr-1 size-3" />
          {isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        <Button
          type="button"
          size="sm"
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
