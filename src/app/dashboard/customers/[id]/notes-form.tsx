'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Textarea } from '@/components/ui/textarea'
import { updateCustomerNotes } from '@/server/actions/customers'
import { Pencil, Check, X } from 'lucide-react'

interface CustomerNotesFormProps {
  customerId: string
  initialNotes: string | null
}

export function CustomerNotesForm({ customerId, initialNotes }: CustomerNotesFormProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes || '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleCancel() {
    setNotes(initialNotes || '')
    setIsEditing(false)
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const res = await updateCustomerNotes(customerId, {
          notes: notes || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        router.refresh()
        setIsEditing(false)
      } catch {
        setError('Error al guardar notas')
      }
    })
  }

  if (!isEditing) {
    return (
      <div>
        {initialNotes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{initialNotes}</p>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">Sin notas internas</p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
          className="mt-3"
        >
          <Pencil className="mr-1 size-3" />
          {initialNotes ? 'Editar notas' : 'Agregar notas'}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField id="customer-notes" label="Notas internas" help={`${notes.length}/2000 · Solo visibles para ti y tu equipo`}>
        {(a11y) => (
          <Textarea
            id="customer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Agrega contexto útil sobre esta clienta…"
            rows={5}
            maxLength={2000}
            density="form"
            className="resize-y"
            disabled={isPending}
            {...a11y}
          />
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
