'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { upsertLoyaltyConfig } from '@/server/actions/loyalty'
import type { LoyaltyConfig } from '@prisma/client'

export function LoyaltyConfigForm({ config }: { config: LoyaltyConfig | null }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData(e.currentTarget)
    const data = {
      isActive: fd.get('isActive') === 'on',
      programName: String(fd.get('programName') ?? ''),
      pointsLabel: String(fd.get('pointsLabel') ?? 'puntos'),
      pointsPerVisit: Number(fd.get('pointsPerVisit') ?? 0),
      spendPerPoint: fd.get('spendPerPoint') ? Number(fd.get('spendPerPoint')) : null,
      minSpendToEarn: fd.get('minSpendToEarn') ? Number(fd.get('minSpendToEarn')) : null,
      cardMessage: String(fd.get('cardMessage') ?? '') || null,
    }
    startTransition(async () => {
      try {
        await upsertLoyaltyConfig(data)
        setSaved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="studio-card space-y-5 p-6">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isActive" defaultChecked={config?.isActive ?? false} className="size-4" />
        <span className="text-sm font-semibold text-foreground">Programa activo</span>
      </label>

      <Field name="programName" label="Nombre del programa" defaultValue={config?.programName ?? ''} required />
      <Field name="pointsLabel" label="Nombre de la unidad (ej. puntos, estrellas)" defaultValue={config?.pointsLabel ?? 'puntos'} />
      <Field name="pointsPerVisit" label="Puntos por visita" type="number" defaultValue={String(config?.pointsPerVisit ?? 0)} />
      <Field name="spendPerPoint" label="Pesos por punto (cada $X = 1 punto; vacío = off)" type="number" defaultValue={config?.spendPerPoint != null ? String(config.spendPerPoint) : ''} />
      <Field name="minSpendToEarn" label="Gasto mínimo para acreditar (vacío = sin mínimo)" type="number" defaultValue={config?.minSpendToEarn != null ? String(config.minSpendToEarn) : ''} />
      <Field name="cardMessage" label="Mensaje en la tarjeta (opcional)" defaultValue={config?.cardMessage ?? ''} />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-600">Guardado.</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Guardando…' : 'Guardar'}
      </Button>
    </form>
  )
}

function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  required = false,
}: {
  name: string
  label: string
  defaultValue: string
  type?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  )
}
