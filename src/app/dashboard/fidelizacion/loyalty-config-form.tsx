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
      grantExpiryDays: fd.get('grantExpiryDays') ? Number(fd.get('grantExpiryDays')) : null,
      refundPointsOnExpiry: fd.get('refundPointsOnExpiry') === 'on',
      forfeitGrantOnNoShow: fd.get('forfeitGrantOnNoShow') === 'on',
      clawbackAutoRewardOnRefund: fd.get('clawbackAutoRewardOnRefund') === 'on',
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
      <PointsLabelField defaultValue={config?.pointsLabel ?? 'puntos'} />
      <Field name="pointsPerVisit" label="Puntos por visita" type="number" defaultValue={String(config?.pointsPerVisit ?? 0)} />
      <Field name="spendPerPoint" label="Pesos por punto (cada $X = 1 punto; vacío = off)" type="number" defaultValue={config?.spendPerPoint != null ? String(config.spendPerPoint) : ''} />
      <Field name="minSpendToEarn" label="Gasto mínimo para acreditar (vacío = sin mínimo)" type="number" defaultValue={config?.minSpendToEarn != null ? String(config.minSpendToEarn) : ''} />
      <Field name="cardMessage" label="Mensaje en la tarjeta (opcional)" defaultValue={config?.cardMessage ?? ''} />

      <Field
        name="grantExpiryDays"
        label="Días para vencer una recompensa (vacío = no vence)"
        type="number"
        defaultValue={config?.grantExpiryDays != null ? String(config.grantExpiryDays) : ''}
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="refundPointsOnExpiry"
          defaultChecked={config?.refundPointsOnExpiry ?? true}
          className="size-4"
        />
        <span className="text-sm text-foreground">Devolver puntos si la recompensa vence</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="forfeitGrantOnNoShow"
          defaultChecked={config?.forfeitGrantOnNoShow ?? false}
          className="size-4"
        />
        <span className="text-sm text-foreground">Quitar la recompensa si la clienta no asiste (no-show)</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="clawbackAutoRewardOnRefund"
          defaultChecked={config?.clawbackAutoRewardOnRefund ?? false}
          className="size-4"
        />
        <span className="text-sm text-foreground">Revertir recompensas automáticas al reembolsar</span>
      </label>

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

const POINTS_LABEL_OPTIONS = ['puntos', 'estrellas', 'sellos', 'visitas']

function PointsLabelField({ defaultValue }: { defaultValue: string }) {
  const isPreset = POINTS_LABEL_OPTIONS.includes(defaultValue)
  const [choice, setChoice] = useState(isPreset ? defaultValue : 'otro')

  return (
    <div className="space-y-1.5">
      <Label htmlFor="pointsLabel-choice">Nombre de la unidad</Label>
      <select
        id="pointsLabel-choice"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {POINTS_LABEL_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value="otro">Otro…</option>
      </select>
      {choice === 'otro' ? (
        <Input name="pointsLabel" defaultValue={isPreset ? '' : defaultValue} placeholder="Ej. corazones" required />
      ) : (
        <input type="hidden" name="pointsLabel" value={choice} />
      )}
    </div>
  )
}
