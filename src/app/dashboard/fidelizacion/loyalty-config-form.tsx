'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { upsertLoyaltyConfig } from '@/server/actions/loyalty'
import type { LoyaltyConfig } from '@prisma/client'
import { useVocabulary } from '@/components/vocabulary-provider'

export function LoyaltyConfigForm({ config }: { config: LoyaltyConfig | null }) {
  const vocabulary = useVocabulary()
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
        const res = await upsertLoyaltyConfig(data)
        if (!res.ok) { setError(res.error); return }
        setSaved(true)
      } catch {
        setError('Error al guardar')
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
        <span className="text-sm text-foreground">Quitar la recompensa si {vocabulary.theClient} no asiste (no-show)</span>
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

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p aria-live="polite" className="text-sm text-green-600">Guardado.</p>}

      <Button type="submit" size="form" disabled={isPending}>
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
    <FormField id={name} label={label} required={required}>
      {(a11y) => (
        <Input
          {...a11y}
          id={name}
          name={name}
          type={type}
          density="form"
          defaultValue={defaultValue}
          required={required}
        />
      )}
    </FormField>
  )
}

const POINTS_LABEL_OPTIONS = ['puntos', 'estrellas', 'sellos', 'visitas']

function PointsLabelField({ defaultValue }: { defaultValue: string }) {
  const isPreset = POINTS_LABEL_OPTIONS.includes(defaultValue)
  const [choice, setChoice] = useState(isPreset ? defaultValue : 'otro')

  return (
    <div className="grid gap-3">
      <FormField id="pointsLabel-choice" label="Nombre de la unidad">
        {(a11y) => (
          <NativeSelect
            {...a11y}
            id="pointsLabel-choice"
            density="form"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            {POINTS_LABEL_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
            <option value="otro">Otro…</option>
          </NativeSelect>
        )}
      </FormField>
      {choice === 'otro' ? (
        <FormField id="pointsLabel" label="Unidad personalizada" required>
          {(a11y) => (
            <Input
              {...a11y}
              id="pointsLabel"
              name="pointsLabel"
              density="form"
              defaultValue={isPreset ? '' : defaultValue}
              placeholder="Ej. corazones"
              required
            />
          )}
        </FormField>
      ) : (
        <input type="hidden" name="pointsLabel" value={choice} />
      )}
    </div>
  )
}
